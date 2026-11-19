// End-to-end pipeline (runs inside a Web Worker):
// IR → validate → codegen → guard → coverage-guided probes → behavioural check
//    → backtest (textbook params) → walk-forward TPE → full-sample search + DSR
//    → regime attribution → (optional) mutation self-test
import type { StrategyIR } from './ir';
import { validateIR } from './ir';
import { makeLib, type Bars } from './indicators';
import { generateCode, guard } from './codegen';
import { syntheticPool, selectProbes, type ProbeSeries } from './probes';
import { behaviouralCheck, mutationSelfTest, type ProbeOutcome, type MutationReport } from './verify';
import { interpret } from './interpreter';
import { buyHoldReturns, computeMetrics, equityCurve, extractTrades, type BTTrade, type Metrics } from './engine';
import { Evaluator, fullSampleSearch, regimeAttribution, walkForward, type WFWindow } from './optimize';

export interface PipelineInput {
  ir: StrategyIR;
  bars: Bars;
  symbol: string;
  interval: string;
  ppy: number;
  costBps: number;
  initialCapital: number;
  runWalkForward: boolean;
  runMutation: boolean;
}

export type StageId = 'validate' | 'codegen' | 'guard' | 'probes' | 'verify' | 'backtest' | 'walkforward' | 'dsr' | 'regime' | 'mutation';
export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface StageEvent { stage: StageId; status: StageStatus; detail?: string }

export interface PipelineResult {
  ok: boolean;
  failedAt?: StageId;
  error?: string;
  code: string;
  probes: { outcomes: ProbeOutcome[]; covered: string[]; possible: string[] };
  backtest?: {
    metrics: Metrics; bh: Metrics;
    trades: BTTrade[];
    times: number[]; equity: number[]; bhEquity: number[];
    closes: number[]; warmup: number;
  };
  walkForward?: {
    windows: WFWindow[]; meanIS: number; oosSharpe: number; textbookOosSharpe: number;
    bhOosSharpe: number; wfe: number; isLen: number; oosLen: number;
    oosMetrics: Metrics; bhOosMetrics: Metrics;
    oosTimes: number[]; oosEquity: number[]; bhOosEquity: number[]; textbookOosEquity: number[];
  };
  dsr?: { bestSharpe: number; dsr: number; dsrVsZero: number; SR0: number; trials: number; params: Record<string, number> };
  regimes?: { regime: string; share: number; strategySharpe: number; bhSharpe: number }[];
  mutation?: MutationReport;
  elapsedMs: number;
}

export function warmupBars(ir: StrategyIR): number {
  let w = 1;
  for (const d of ir.indicators) {
    const p = d.params;
    const lb = d.type.startsWith('MACD') ? (p.slow ?? 26) + (p.signal ?? 9) : (p.period ?? 14);
    w = Math.max(w, d.type === 'EMA' || d.type.startsWith('MACD') || d.type === 'RSI' ? lb * 2 : lb);
  }
  return Math.max(20, w);
}

export function runPipeline(input: PipelineInput, emit: (e: StageEvent) => void): PipelineResult {
  const t0 = performance.now();
  const res: PipelineResult = { ok: false, code: '', probes: { outcomes: [], covered: [], possible: [] }, elapsedMs: 0 };
  const fail = (stage: StageId, msg: string): PipelineResult => {
    emit({ stage, status: 'failed', detail: msg });
    return { ...res, ok: false, failedAt: stage, error: msg, elapsedMs: performance.now() - t0 };
  };

  // 1 ─ validate
  emit({ stage: 'validate', status: 'running' });
  const v = validateIR(input.ir);
  if (!v.ok) return fail('validate', v.errors.join(' '));
  const ir = v.ir!;
  emit({ stage: 'validate', status: 'done', detail: `${ir.indicators.length} indicator(s)` });

  // 2 ─ deterministic codegen
  emit({ stage: 'codegen', status: 'running' });
  res.code = generateCode(ir);
  emit({ stage: 'codegen', status: 'done', detail: `${res.code.split('\n').length} lines` });

  // 3 ─ guard
  emit({ stage: 'guard', status: 'running' });
  const g = guard(res.code);
  if (!g.ok) return fail('guard', g.reason!);
  emit({ stage: 'guard', status: 'done', detail: 'all tokens whitelisted' });

  // 4 ─ coverage-guided probes (8 synthetic) + historical series
  emit({ stage: 'probes', status: 'running' });
  const pool = syntheticPool(48);
  const sel = selectProbes(ir, pool, 8);
  const hist: ProbeSeries = { id: `${input.symbol} (historical)`, kind: 'historical', bars: input.bars };
  const probes = [...sel.probes, hist];
  res.probes.covered = [...sel.covered];
  res.probes.possible = sel.possible;
  emit({ stage: 'probes', status: 'done', detail: `${sel.covered.size}/${sel.possible.length} coverage goals` });

  // 5 ─ behavioural consistency check
  emit({ stage: 'verify', status: 'running' });
  const chk = behaviouralCheck(ir, res.code, probes);
  res.probes.outcomes = chk.outcomes;
  if (!chk.ok) {
    const f = chk.firstFailure!;
    return fail('verify', `Generated program disagrees with the IR interpreter on ${f.id} at bar ${f.firstDivergence?.index} (${new Date((f.firstDivergence?.time ?? 0) * 1000).toISOString().slice(0, 10)}). Backtest blocked.`);
  }
  emit({ stage: 'verify', status: 'done', detail: `${probes.length}/${probes.length} series identical bar-by-bar` });

  // 6 ─ backtest with the user's own parameters
  emit({ stage: 'backtest', status: 'running' });
  const bars = input.bars;
  const n = bars.close.length;
  const warmup = Math.min(warmupBars(ir), Math.floor(n / 3));
  const L = makeLib(bars);
  const ev = new Evaluator(bars, L, input.costBps);
  const { pos, r } = ev.returns(ir);
  const tr = interpret(ir, bars, L);
  const trades = extractTrades(pos, bars, input.costBps, tr).filter(t => t.entryIdx >= warmup);
  const bhR = buyHoldReturns(bars);
  const rs = Array.from(r.slice(warmup)), bs = Array.from(bhR.slice(warmup));
  const eq = equityCurve(rs, input.initialCapital), beq = equityCurve(bs, input.initialCapital);
  const posW = pos.slice(warmup);
  const bwarm: Bars = { time: bars.time.slice(warmup), open: bars.open.slice(warmup), high: bars.high.slice(warmup), low: bars.low.slice(warmup), close: bars.close.slice(warmup) };
  res.backtest = {
    metrics: computeMetrics(rs, bwarm, input.ppy, posW, trades),
    bh: computeMetrics(bs, bwarm, input.ppy),
    trades,
    times: bwarm.time, equity: Array.from(eq), bhEquity: Array.from(beq),
    closes: Array.from(bwarm.close), warmup,
  };
  emit({ stage: 'backtest', status: 'done', detail: `${trades.length} trades, Sharpe ${res.backtest.metrics.sharpe.toFixed(2)}` });

  // 7 ─ walk-forward with TPE inside each IS window
  if (input.runWalkForward) {
    emit({ stage: 'walkforward', status: 'running' });
    const wf = walkForward(ir, bars, ev, input.ppy, warmup, 40, (k, K) => emit({ stage: 'walkforward', status: 'running', detail: `window ${k}/${K}` }));
    if (!wf) emit({ stage: 'walkforward', status: 'skipped', detail: 'not enough history for ≥ 2 windows' });
    else {
      const oosBars: Bars = { time: wf.oosTimes, open: new Float64Array(0), high: new Float64Array(0), low: new Float64Array(0), close: new Float64Array(0) };
      res.walkForward = {
        windows: wf.windows, meanIS: wf.meanIS, oosSharpe: wf.oosSharpe, textbookOosSharpe: wf.textbookOosSharpe,
        bhOosSharpe: wf.bhOosSharpe, wfe: wf.wfe, isLen: wf.isLen, oosLen: wf.oosLen,
        oosMetrics: computeMetrics(wf.oosReturns, oosBars, input.ppy),
        bhOosMetrics: computeMetrics(wf.bhOosReturns, oosBars, input.ppy),
        oosTimes: wf.oosTimes,
        oosEquity: Array.from(equityCurve(wf.oosReturns, input.initialCapital)),
        bhOosEquity: Array.from(equityCurve(wf.bhOosReturns, input.initialCapital)),
        textbookOosEquity: Array.from(equityCurve(wf.textbookOosReturns, input.initialCapital)),
      };
      emit({ stage: 'walkforward', status: 'done', detail: `${wf.windows.length} windows, OOS Sharpe ${wf.oosSharpe.toFixed(2)}, WFE ${wf.wfe.toFixed(2)}` });
    }

    // 8 ─ full-sample search + deflated Sharpe
    emit({ stage: 'dsr', status: 'running' });
    const fs = fullSampleSearch(ir, bars, ev, input.ppy, warmup, 100);
    res.dsr = { bestSharpe: fs.bestSharpe, dsr: fs.dsr.dsr, dsrVsZero: fs.dsr.dsrVsZero, SR0: fs.dsr.SR0 * Math.sqrt(input.ppy), trials: fs.trials, params: fs.params };
    emit({ stage: 'dsr', status: 'done', detail: `best IS Sharpe ${fs.bestSharpe.toFixed(2)} → DSR ${(fs.dsr.dsr * 100).toFixed(1)}%` });
  } else {
    emit({ stage: 'walkforward', status: 'skipped' });
    emit({ stage: 'dsr', status: 'skipped' });
  }

  // 9 ─ regime attribution (OOS if available, else full sample)
  emit({ stage: 'regime', status: 'running' });
  let idx: number[], sr: number[];
  if (res.walkForward) {
    const tIndex = new Map(bars.time.map((t, i) => [t, i]));
    idx = res.walkForward.oosTimes.map(t => tIndex.get(t)!);
    const st = equityToReturns(res.walkForward.oosEquity, input.initialCapital);
    sr = st;
  } else {
    idx = Array.from({ length: n - warmup }, (_, k) => k + warmup);
    sr = rs;
  }
  const reg = regimeAttribution(bars, idx, sr, input.ppy);
  if (reg) { res.regimes = reg; emit({ stage: 'regime', status: 'done' }); }
  else emit({ stage: 'regime', status: 'skipped', detail: 'too few bars' });

  // 10 ─ mutation self-test
  if (input.runMutation) {
    emit({ stage: 'mutation', status: 'running' });
    res.mutation = mutationSelfTest(ir, probes);
    emit({ stage: 'mutation', status: 'done', detail: `${res.mutation.killed}/${res.mutation.total} mutants caught` });
  } else emit({ stage: 'mutation', status: 'skipped' });

  res.ok = true;
  res.elapsedMs = performance.now() - t0;
  return res;
}

function equityToReturns(eq: number[], start: number): number[] {
  const out: number[] = [];
  let prev = start;
  for (const v of eq) { out.push(v / prev - 1); prev = v; }
  return out;
}
