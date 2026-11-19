// ─────────────────────────────────────────────────────────────────────────────
// Backtest engine  — QuantForge Pro §IV.E
// Signal at close of bar t, fill at open of bar t+1 (no look-ahead).
// Flat cost per side (default 15 bps). Long-only, single asset.
// ─────────────────────────────────────────────────────────────────────────────
import type { Bars } from './indicators';

export interface BTTrade {
  entryIdx: number;  // bar of the fill
  exitIdx: number;   // bar of the exit fill (or last bar if still open)
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  retPct: number;    // net of costs
  bars: number;
  reason: 'signal' | 'stop' | 'take_profit' | 'open';
}

export interface Metrics {
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  volPct: number;
  exposurePct: number;
  trades: number;
  winRatePct: number;
  profitFactor: number;
  avgTradePct: number;
}

/** Per-bar strategy returns, r[0] = 0. */
export function strategyReturns(pos: Uint8Array, bars: Bars, costBps: number): Float64Array {
  const { open, close } = bars;
  const n = close.length, r = new Float64Array(n);
  const c = costBps / 10000;
  for (let t = 1; t < n; t++) {
    const held = t >= 2 ? pos[t - 2] : 0; // position carried into bar t
    const tgt = pos[t - 1];               // position after the open of bar t
    if (held === 0 && tgt === 1) r[t] = close[t] / open[t] - 1 - c;
    else if (held === 1 && tgt === 1) r[t] = close[t] / close[t - 1] - 1;
    else if (held === 1 && tgt === 0) r[t] = open[t] / close[t - 1] - 1 - c;
  }
  return r;
}

export function buyHoldReturns(bars: Bars): Float64Array {
  const n = bars.close.length, r = new Float64Array(n);
  for (let t = 1; t < n; t++) r[t] = bars.close[t] / bars.close[t - 1] - 1;
  return r;
}

export function sharpe(r: ArrayLike<number>, ppy: number, from = 0, to = r.length): number {
  const len = to - from;
  if (len < 3) return 0;
  let m = 0;
  for (let i = from; i < to; i++) m += r[i];
  m /= len;
  let v = 0;
  for (let i = from; i < to; i++) v += (r[i] - m) ** 2;
  v /= len - 1;
  const sd = Math.sqrt(v);
  return sd > 1e-12 ? Math.sqrt(ppy) * m / sd : 0;
}

export function equityCurve(r: ArrayLike<number>, start = 1): Float64Array {
  const e = new Float64Array(r.length);
  let v = start;
  for (let i = 0; i < r.length; i++) { v *= 1 + r[i]; e[i] = v; }
  return e;
}

export function maxDrawdown(eq: ArrayLike<number>): number {
  let peak = -Infinity, mdd = 0;
  for (let i = 0; i < eq.length; i++) {
    if (eq[i] > peak) peak = eq[i];
    const dd = (peak - eq[i]) / peak;
    if (dd > mdd) mdd = dd;
  }
  return mdd;
}

export function extractTrades(pos: Uint8Array, bars: Bars, costBps: number, reasons?: { stopEvt: Uint8Array; tpEvt: Uint8Array }): BTTrade[] {
  const n = pos.length, c = costBps / 10000;
  const out: BTTrade[] = [];
  let open: { idx: number; px: number } | null = null;
  for (let t = 0; t < n; t++) {
    const prev = t > 0 ? pos[t - 1] : 0;
    if (prev === 0 && pos[t] === 1 && t + 1 < n) open = { idx: t + 1, px: bars.open[t + 1] };
    if (prev === 1 && pos[t] === 0 && open) {
      const xi = t + 1 < n ? t + 1 : t;
      const xp = t + 1 < n ? bars.open[t + 1] : bars.close[t];
      const reason: BTTrade['reason'] = reasons?.stopEvt[t] ? 'stop' : reasons?.tpEvt[t] ? 'take_profit' : 'signal';
      out.push(mk(open.idx, open.px, xi, xp, reason));
      open = null;
    }
  }
  if (open) out.push(mk(open.idx, open.px, n - 1, bars.close[n - 1], 'open'));
  return out;

  function mk(ei: number, ep: number, xi: number, xp: number, reason: BTTrade['reason']): BTTrade {
    return {
      entryIdx: ei, exitIdx: xi, entryTime: bars.time[ei], exitTime: bars.time[xi],
      entryPrice: ep, exitPrice: xp,
      retPct: ((xp * (1 - c)) / (ep * (1 + c)) - 1) * 100,
      bars: xi - ei, reason,
    };
  }
}

export function computeMetrics(r: ArrayLike<number>, bars: Bars, ppy: number, pos?: Uint8Array, trades?: BTTrade[], from = 0, to = r.length): Metrics {
  const slice = Array.prototype.slice.call(r, from, to) as number[];
  const eq = equityCurve(slice);
  const total = eq.length ? eq[eq.length - 1] - 1 : 0;
  const years = Math.max(1e-9, (bars.time[to - 1] - bars.time[from]) / (365.25 * 86400));
  const cagr = eq.length ? Math.pow(Math.max(1e-12, 1 + total), 1 / years) - 1 : 0;
  let m = 0; slice.forEach(x => (m += x)); m /= Math.max(1, slice.length);
  let v = 0; slice.forEach(x => (v += (x - m) ** 2)); v /= Math.max(1, slice.length - 1);
  let exposure = 0;
  if (pos) { for (let t = Math.max(1, from); t < to; t++) exposure += pos[t - 1]; exposure /= Math.max(1, to - Math.max(1, from)); }
  const tr = trades ?? [];
  const wins = tr.filter(t => t.retPct > 0);
  const gp = wins.reduce((s, t) => s + t.retPct, 0);
  const gl = -tr.filter(t => t.retPct <= 0).reduce((s, t) => s + t.retPct, 0);
  return {
    totalReturnPct: total * 100,
    cagrPct: cagr * 100,
    sharpe: sharpe(r, ppy, from, to),
    maxDrawdownPct: maxDrawdown(eq) * 100,
    volPct: Math.sqrt(v * ppy) * 100,
    exposurePct: exposure * 100,
    trades: tr.length,
    winRatePct: tr.length ? (wins.length / tr.length) * 100 : 0,
    profitFactor: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
    avgTradePct: tr.length ? tr.reduce((s, t) => s + t.retPct, 0) / tr.length : 0,
  };
}
