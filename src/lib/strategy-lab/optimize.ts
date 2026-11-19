// ─────────────────────────────────────────────────────────────────────────────
// Bayesian optimisation (TPE) nested in walk-forward windows + Deflated Sharpe
// — QuantForge Pro §IV.F, §IV.G
// The paper uses Optuna's TPE in Python; this is a compact TPE written for the
// browser (Parzen estimators over good / bad trials, independent dimensions).
// ─────────────────────────────────────────────────────────────────────────────
import type { AtomCond, Cond, StrategyIR } from './ir';
import { cloneIR, validateIR, isLogic } from './ir';
import type { Bars, IndicatorLib } from './indicators';
import { compile, generateCode, runCompiled, type CompiledStrategy } from './codegen';
import { strategyReturns, sharpe, buyHoldReturns, equityCurve } from './engine';
import { mulberry32 } from './probes';
import { rollingStd } from './indicators';

// ─── Parameter space derived from the IR ───────────────────────────────────
export interface Param {
  label: string;
  min: number; max: number; int: boolean;
  get: (ir: StrategyIR) => number;
  set: (ir: StrategyIR, v: number) => void;
}

function constNodes(c: Cond | null, out: { node: AtomCond; side: 'left' | 'right'; against: string }[] = []) {
  if (!c) return out;
  if (isLogic(c)) { c.args.forEach(a => constNodes(a, out)); return out; }
  if (c.right.kind === 'const') out.push({ node: c, side: 'right', against: c.left.kind === 'ref' ? c.left.ref : '' });
  else if (c.left.kind === 'const') out.push({ node: c, side: 'left', against: c.right.kind === 'ref' ? c.right.ref : '' });
  return out;
}

export function paramSpace(ir: StrategyIR): Param[] {
  const ps: Param[] = [];
  ir.indicators.forEach((d, di) => {
    (['period', 'fast', 'slow', 'signal'] as const).forEach(k => {
      const v = d.params[k];
      if (v === undefined) return;
      const lo = Math.max(2, Math.round(v * 0.5)), hi = Math.min(k === 'fast' || k === 'signal' ? 100 : 300, Math.max(lo + 2, Math.round(v * 1.5)));
      ps.push({
        label: `${d.name}.${k}`, min: lo, max: hi, int: true,
        get: x => x.indicators[di].params[k]!, set: (x, val) => { x.indicators[di].params[k] = Math.round(val); },
      });
    });
    if (d.params.std !== undefined) {
      ps.push({
        label: `${d.name}.std`, min: 1, max: 3, int: false,
        get: x => x.indicators[di].params.std!, set: (x, val) => { x.indicators[di].params.std = Math.round(val * 10) / 10; },
      });
    }
  });
  const addConsts = (which: 'entry' | 'exit') => {
    const root = ir[which];
    constNodes(root).forEach((cn, ci) => {
      const op = cn.node[cn.side] as { kind: 'const'; value: number };
      const v = op.value;
      if (v === 0) return; // zero lines stay zero
      const ind = ir.indicators.find(i => i.name === cn.against);
      const isOsc = ind?.type === 'RSI';
      const lo = isOsc ? Math.max(5, v - 20) : v - Math.abs(v) * 0.5;
      const hi = isOsc ? Math.min(95, v + 20) : v + Math.abs(v) * 0.5;
      const path = (x: StrategyIR) => {
        const nodes = constNodes(x[which]);
        return nodes[ci].node[nodes[ci].side] as { kind: 'const'; value: number };
      };
      ps.push({
        label: `${which}.const${ci}${ind ? `(${ind.name})` : ''}`, min: lo, max: hi, int: isOsc,
        get: x => path(x).value, set: (x, val) => { path(x).value = isOsc ? Math.round(val) : +val.toFixed(4); },
      });
    });
  };
  addConsts('entry'); addConsts('exit');
  if (ir.stop_loss_pct !== null) {
    const v = ir.stop_loss_pct;
    ps.push({ label: 'stop_loss_pct', min: Math.max(0.5, v * 0.5), max: Math.min(50, v * 2), int: false, get: x => x.stop_loss_pct!, set: (x, val) => { x.stop_loss_pct = +val.toFixed(2); } });
  }
  if (ir.take_profit_pct !== null) {
    const v = ir.take_profit_pct;
    ps.push({ label: 'take_profit_pct', min: Math.max(0.5, v * 0.5), max: Math.min(90, v * 2), int: false, get: x => x.take_profit_pct!, set: (x, val) => { x.take_profit_pct = +val.toFixed(2); } });
  }
  return ps;
}

export function applyParams(ir: StrategyIR, space: Param[], x: number[]): StrategyIR | null {
  const c = cloneIR(ir);
  space.forEach((p, i) => p.set(c, x[i]));
  const v = validateIR(c);
  return v.ok ? v.ir! : null;
}

// ─── Strategy evaluator with a compiled-program cache ──────────────────────
export class Evaluator {
  private cache = new Map<string, CompiledStrategy>();
  private retCache = new Map<string, Float64Array>();
  private bars: Bars;
  private L: IndicatorLib;
  private costBps: number;
  constructor(bars: Bars, L: IndicatorLib, costBps: number) { this.bars = bars; this.L = L; this.costBps = costBps; }
  returns(ir: StrategyIR): { code: string; pos: Uint8Array; r: Float64Array } {
    const code = generateCode(ir);
    let fn = this.cache.get(code);
    if (!fn) { fn = compile(code); this.cache.set(code, fn); }
    const pos = runCompiled(fn, this.bars, this.L);
    let r = this.retCache.get(code);
    if (!r) { r = strategyReturns(pos, this.bars, this.costBps); this.retCache.set(code, r); }
    return { code, pos, r };
  }
}

// ─── TPE ─────────────────────────────────────────────────────────────────────
interface Trial { x: number[]; y: number }

function normPdf(x: number, m: number, s: number) { const z = (x - m) / s; return Math.exp(-0.5 * z * z) / (s * 2.5066282746); }

export function tpe(space: Param[], objective: (x: number[]) => number, nTrials: number, seed: number, x0?: number[], nStartup = 10, gamma = 0.25): Trial[] {
  const rng = mulberry32(seed);
  const trials: Trial[] = [];
  const rand = () => space.map(p => p.min + rng() * (p.max - p.min));
  const clampRound = (x: number[]) => x.map((v, d) => {
    const p = space[d];
    let w = Math.min(p.max, Math.max(p.min, v));
    if (p.int) w = Math.round(w);
    return w;
  });
  const seen = new Set<string>();
  const evalX = (x: number[]) => {
    const key = x.join(',');
    const y = objective(x);
    seen.add(key);
    trials.push({ x, y: Number.isFinite(y) ? y : -10 });
  };
  // the user's own (textbook) parameters are always trial #1
  if (x0 && x0.length === space.length) evalX(clampRound(x0));
  for (let i = trials.length; i < nTrials; i++) {
    let x: number[];
    if (i < nStartup || space.length === 0) x = clampRound(rand());
    else {
      const sorted = [...trials].sort((a, b) => b.y - a.y);
      const nGood = Math.max(1, Math.ceil(gamma * sorted.length));
      const good = sorted.slice(0, nGood), bad = sorted.slice(nGood);
      let bestX: number[] = clampRound(rand()), bestScore = -Infinity;
      for (let c = 0; c < 24; c++) {
        const g = good[Math.floor(rng() * good.length)];
        const cand = clampRound(g.x.map((v, d) => {
          const p = space[d]; const bw = Math.max((p.max - p.min) * 0.12, p.int ? 1 : 1e-6);
          const u1 = rng() || 1e-9, u2 = rng();
          return v + bw * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        }));
        let score = 0;
        cand.forEach((v, d) => {
          const p = space[d]; const bw = Math.max((p.max - p.min) * 0.12, p.int ? 1 : 1e-6);
          const prior = 1 / Math.max(1e-9, p.max - p.min);
          const l = (good.reduce((s, t) => s + normPdf(v, t.x[d], bw), 0) + prior) / (good.length + 1);
          const gg = (bad.reduce((s, t) => s + normPdf(v, t.x[d], bw), 0) + prior) / (bad.length + 1);
          score += Math.log(l) - Math.log(gg);
        });
        if (score > bestScore && !seen.has(cand.join(','))) { bestScore = score; bestX = cand; }
      }
      x = bestX;
    }
    evalX(x);
  }
  return trials;
}

// ─── Statistics helpers ─────────────────────────────────────────────────────
export function normCdf(x: number): number {
  // W. J. Cody-style rational approximation via erf
  const t = 1 / (1 + 0.5 * Math.abs(x) / Math.SQRT2);
  const y = 1 - t * Math.exp(-((x / Math.SQRT2) ** 2) - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function normInv(p: number): number {
  // Acklam's algorithm
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function moments(r: ArrayLike<number>, from: number, to: number) {
  const n = to - from; let m = 0;
  for (let i = from; i < to; i++) m += r[i]; m /= n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (let i = from; i < to; i++) { const d = r[i] - m; m2 += d * d; m3 += d ** 3; m4 += d ** 4; }
  m2 /= n; m3 /= n; m4 /= n;
  const sd = Math.sqrt(m2);
  return { mean: m, sd, skew: sd > 0 ? m3 / sd ** 3 : 0, kurt: sd > 0 ? m4 / sd ** 4 : 3, n };
}

/** Deflated Sharpe Ratio (Bailey & López de Prado), eq. (6)–(7) of the paper. */
export function deflatedSharpe(bestR: ArrayLike<number>, from: number, to: number, trialSRs: number[]) {
  const EG = 0.5772156649015329;
  const N = Math.max(2, trialSRs.length);
  const mean = trialSRs.reduce((s, x) => s + x, 0) / trialSRs.length;
  const V = trialSRs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, trialSRs.length - 1);
  const SR0 = Math.sqrt(V) * ((1 - EG) * normInv(1 - 1 / N) + EG * normInv(1 - 1 / (N * Math.E)));
  const mo = moments(bestR, from, to);
  const SR = mo.sd > 0 ? mo.mean / mo.sd : 0;
  const denom = Math.sqrt(Math.max(1e-12, 1 - mo.skew * SR + ((mo.kurt - 1) / 4) * SR * SR));
  const dsr = normCdf(((SR - SR0) * Math.sqrt(mo.n - 1)) / denom);
  const dsrVsZero = normCdf((SR * Math.sqrt(mo.n - 1)) / denom); // probabilistic Sharpe vs 0
  return { dsr, dsrVsZero, SR0, SR, N, V, skew: mo.skew, kurt: mo.kurt, T: mo.n };
}

// ─── Walk-forward with TPE inside each IS window ──────────────────────────
export interface WFWindow {
  isStart: number; isEnd: number; oosStart: number; oosEnd: number; // [start, end)
  isFrom: number; isTo: number; oosFrom: number; oosTo: number; // unix times
  params: Record<string, number>;
  isSharpe: number; oosSharpe: number;
}

export interface WFResult {
  windows: WFWindow[];
  meanIS: number;
  oosSharpe: number;            // stitched OOS Sharpe (tuned)
  textbookOosSharpe: number;    // user's own parameters on the same OOS dates
  bhOosSharpe: number;
  wfe: number;
  oosReturns: number[];         // stitched
  oosTimes: number[];
  bhOosReturns: number[];
  textbookOosReturns: number[];
  isLen: number; oosLen: number;
}

export function windowPlan(n: number, warmup: number) {
  let isLen = 504, oosLen = 126;
  const usable = n - warmup;
  if (usable < isLen + oosLen * 2) {
    isLen = Math.max(60, Math.floor(usable * 0.45));
    oosLen = Math.max(20, Math.floor(isLen / 4));
  }
  const wins: { isStart: number; isEnd: number; oosStart: number; oosEnd: number }[] = [];
  for (let s = warmup; s + isLen + oosLen <= n; s += oosLen) {
    wins.push({ isStart: s, isEnd: s + isLen, oosStart: s + isLen, oosEnd: s + isLen + oosLen });
  }
  return { isLen, oosLen, wins };
}

export function walkForward(
  ir: StrategyIR, bars: Bars, ev: Evaluator, ppy: number, warmup: number,
  trialsPerWindow = 40, onProgress?: (k: number, K: number) => void,
): WFResult | null {
  const space = paramSpace(ir);
  const { isLen, oosLen, wins } = windowPlan(bars.close.length, warmup);
  if (wins.length < 2) return null;
  const bh = buyHoldReturns(bars);
  const textbook = ev.returns(ir).r;
  const x0 = space.map(p => p.get(ir));
  const windows: WFWindow[] = [];
  const oosR: number[] = [], oosT: number[] = [], bhR: number[] = [], tbR: number[] = [];
  wins.forEach((w, k) => {
    const obj = (x: number[]) => {
      const ir2 = applyParams(ir, space, x);
      if (!ir2) return -10;
      return sharpe(ev.returns(ir2).r, ppy, w.isStart, w.isEnd);
    };
    const trials = space.length ? tpe(space, obj, trialsPerWindow, 7 + k * 101, x0) : [{ x: [], y: obj([]) }];
    const best = trials.reduce((a, b) => (b.y > a.y ? b : a));
    const irBest = applyParams(ir, space, best.x) ?? ir;
    const r = ev.returns(irBest).r;
    for (let t = w.oosStart; t < w.oosEnd; t++) { oosR.push(r[t]); oosT.push(bars.time[t]); bhR.push(bh[t]); tbR.push(textbook[t]); }
    const params: Record<string, number> = {};
    space.forEach((p, i) => (params[p.label] = best.x[i]));
    windows.push({ ...w, isFrom: bars.time[w.isStart], isTo: bars.time[w.isEnd - 1], oosFrom: bars.time[w.oosStart], oosTo: bars.time[w.oosEnd - 1], params, isSharpe: best.y, oosSharpe: sharpe(r, ppy, w.oosStart, w.oosEnd) });
    onProgress?.(k + 1, wins.length);
  });
  const meanIS = windows.reduce((s, w) => s + w.isSharpe, 0) / windows.length;
  const oosSharpe = sharpe(oosR, ppy);
  return {
    windows, meanIS, oosSharpe,
    textbookOosSharpe: sharpe(tbR, ppy),
    bhOosSharpe: sharpe(bhR, ppy),
    wfe: Math.abs(meanIS) > 1e-9 ? oosSharpe / meanIS : 0,
    oosReturns: oosR, oosTimes: oosT, bhOosReturns: bhR, textbookOosReturns: tbR, isLen, oosLen,
  };
}

/** Full-sample search (100 trials) → best IS Sharpe and its DSR. */
export function fullSampleSearch(ir: StrategyIR, bars: Bars, ev: Evaluator, ppy: number, warmup: number, nTrials = 100) {
  const space = paramSpace(ir);
  const n = bars.close.length;
  const perPeriod: number[] = [];
  const obj = (x: number[]) => {
    const ir2 = applyParams(ir, space, x);
    if (!ir2) return -10;
    const r = ev.returns(ir2).r;
    const s = sharpe(r, ppy, warmup, n);
    perPeriod.push(s / Math.sqrt(ppy));
    return s;
  };
  const x0 = space.map(p => p.get(ir));
  const trials = space.length ? tpe(space, obj, nTrials, 99, x0) : [{ x: [], y: obj([]) }];
  const best = trials.reduce((a, b) => (b.y > a.y ? b : a));
  const irBest = applyParams(ir, space, best.x) ?? ir;
  const rBest = ev.returns(irBest).r;
  const params: Record<string, number> = {};
  space.forEach((p, i) => (params[p.label] = best.x[i]));
  return { bestSharpe: best.y, params, irBest, dsr: deflatedSharpe(rBest, warmup, n, perPeriod), trials: trials.length };
}

// ─── Regime attribution (simplified: volatility terciles) ──────────────────
// The paper fits a 3-state Gaussian HMM; here we bucket days by 20-bar realised
// volatility terciles — same purpose (after-the-fact attribution, never a trading input).
export function regimeAttribution(bars: Bars, idx: number[], stratR: number[], ppy: number) {
  const bh = buyHoldReturns(bars);
  const vol = rollingStd(bh, 20);
  const v = idx.map(i => vol[i]).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 30) return null;
  const q1 = v[Math.floor(v.length / 3)], q2 = v[Math.floor((2 * v.length) / 3)];
  const buckets: Record<'low' | 'medium' | 'high', { s: number[]; b: number[] }> = { low: { s: [], b: [] }, medium: { s: [], b: [] }, high: { s: [], b: [] } };
  idx.forEach((i, k) => {
    const x = vol[i];
    if (!Number.isFinite(x)) return;
    const key = x <= q1 ? 'low' : x <= q2 ? 'medium' : 'high';
    buckets[key].s.push(stratR[k]); buckets[key].b.push(bh[i]);
  });
  return (['low', 'medium', 'high'] as const).map(k => ({
    regime: k, share: (buckets[k].s.length / idx.length) * 100,
    strategySharpe: sharpe(buckets[k].s, ppy), bhSharpe: sharpe(buckets[k].b, ppy),
    annVolPct: Math.sqrt(ppy) * (k === 'low' ? q1 : k === 'medium' ? q2 : v[v.length - 1]) * 100,
  }));
}

export { equityCurve };
