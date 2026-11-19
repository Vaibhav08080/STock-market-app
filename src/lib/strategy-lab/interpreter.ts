// ─────────────────────────────────────────────────────────────────────────────
// Independent, vectorised IR interpreter  — QuantForge Pro §IV.D
// Evaluates the IR directly (no generated code). The generated program is only
// admitted if its bar-by-bar position series equals this one on every probe.
// ─────────────────────────────────────────────────────────────────────────────
import type { Cond, Operand, StrategyIR, IndicatorDef } from './ir';
import { isLogic } from './ir';
import { makeLib, type Bars, type IndicatorLib } from './indicators';

export function indicatorSeries(L: IndicatorLib, d: IndicatorDef): Float64Array {
  const p = d.params;
  switch (d.type) {
    case 'SMA': return L.sma(p.period!);
    case 'EMA': return L.ema(p.period!);
    case 'RSI': return L.rsi(p.period!);
    case 'MACD': return L.macd(p.fast!, p.slow!);
    case 'MACD_SIGNAL': return L.macdSignal(p.fast!, p.slow!, p.signal!);
    case 'MACD_HIST': return L.macdHist(p.fast!, p.slow!, p.signal!);
    case 'BB_UPPER': return L.bbUpper(p.period!, p.std!);
    case 'BB_MIDDLE': return L.bbMiddle(p.period!);
    case 'BB_LOWER': return L.bbLower(p.period!, p.std!);
  }
}

type Env = Map<string, ArrayLike<number>>;

function operandArr(o: Operand, env: Env, n: number): Float64Array {
  if (o.kind === 'const') return new Float64Array(n).fill(o.value);
  const a = env.get(o.ref);
  if (!a) throw new Error(`undefined ref ${o.ref}`);
  return Float64Array.from(a);
}

/** Vectorised condition evaluation. `force` lets the MC/DC analysis pin one atomic predicate to T/F. */
export function evalCond(c: Cond, env: Env, n: number, force?: { node: Cond; value: boolean }): Uint8Array {
  const out = new Uint8Array(n);
  if (force && force.node === c) { out.fill(force.value ? 1 : 0); return out; }
  if (isLogic(c)) {
    const parts = c.args.map(a => evalCond(a, env, n, force));
    for (let t = 0; t < n; t++) {
      let v = c.op === 'and' ? 1 : 0;
      for (const pr of parts) v = c.op === 'and' ? (v & pr[t]) : (v | pr[t]);
      out[t] = v;
    }
    return out;
  }
  const A = operandArr(c.left, env, n), B = operandArr(c.right, env, n);
  switch (c.op) {
    case 'lt': for (let t = 0; t < n; t++) out[t] = A[t] < B[t] ? 1 : 0; break;
    case 'le': for (let t = 0; t < n; t++) out[t] = A[t] <= B[t] ? 1 : 0; break;
    case 'gt': for (let t = 0; t < n; t++) out[t] = A[t] > B[t] ? 1 : 0; break;
    case 'ge': for (let t = 0; t < n; t++) out[t] = A[t] >= B[t] ? 1 : 0; break;
    case 'cross_above':
      for (let t = 1; t < n; t++) out[t] = A[t - 1] <= B[t - 1] && A[t] > B[t] ? 1 : 0; break;
    case 'cross_below':
      for (let t = 1; t < n; t++) out[t] = A[t - 1] >= B[t - 1] && A[t] < B[t] ? 1 : 0; break;
  }
  return out;
}

export function buildEnv(ir: StrategyIR, bars: Bars, L?: IndicatorLib): Env {
  const lib = L ?? makeLib(bars);
  const env: Env = new Map();
  env.set('close', bars.close); env.set('open', bars.open);
  env.set('high', bars.high); env.set('low', bars.low);
  for (const d of ir.indicators) env.set(d.name, indicatorSeries(lib, d));
  return env;
}

export interface StateTrace {
  pos: Uint8Array;               // target position at close of bar t
  entryEvt: Uint8Array;          // 1 where an entry happened
  exitEvt: Uint8Array;           // 1 where the exit condition closed the trade
  stopEvt: Uint8Array;           // 1 where the stop-loss closed the trade
  tpEvt: Uint8Array;             // 1 where the take-profit closed the trade
}

/** State machine: long-only, signal at close t, fill at open t+1. */
export function runStateMachine(
  ir: StrategyIR, bars: Bars, entry: Uint8Array, exit: Uint8Array | null,
): StateTrace {
  const n = bars.close.length;
  const pos = new Uint8Array(n), entryEvt = new Uint8Array(n), exitEvt = new Uint8Array(n);
  const stopEvt = new Uint8Array(n), tpEvt = new Uint8Array(n);
  const slMul = ir.stop_loss_pct !== null ? 1 - ir.stop_loss_pct / 100 : null;
  const tpMul = ir.take_profit_pct !== null ? 1 + ir.take_profit_pct / 100 : null;
  let p = 0, fill = 0;
  const { open, close } = bars;
  for (let t = 0; t < n; t++) {
    if (p === 0) {
      if (entry[t]) { p = 1; fill = t + 1 < n ? open[t + 1] : close[t]; entryEvt[t] = 1; }
    } else {
      const ex = exit ? exit[t] === 1 : false;
      const sl = slMul !== null && close[t] <= fill * slMul;
      const tp = tpMul !== null && close[t] >= fill * tpMul;
      if (ex || sl || tp) {
        p = 0;
        if (ex) exitEvt[t] = 1; else if (sl) stopEvt[t] = 1; else tpEvt[t] = 1;
      }
    }
    pos[t] = p;
  }
  return { pos, entryEvt, exitEvt, stopEvt, tpEvt };
}

export function interpret(ir: StrategyIR, bars: Bars, L?: IndicatorLib): StateTrace {
  const n = bars.close.length;
  const env = buildEnv(ir, bars, L);
  const entry = evalCond(ir.entry, env, n);
  const exit = ir.exit ? evalCond(ir.exit, env, n) : null;
  return runStateMachine(ir, bars, entry, exit);
}
