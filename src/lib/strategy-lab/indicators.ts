// Small indicator library (paper §IV.C: "indicators come from a small library object").
// All functions are causal: value at t uses only data up to t. Warm-up bars are NaN.

export function sma(x: ArrayLike<number>, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  let sum = 0, cnt = 0;
  for (let t = 0; t < n; t++) {
    const v = x[t];
    if (!Number.isFinite(v)) { sum = 0; cnt = 0; continue; }
    sum += v; cnt++;
    if (cnt > p) { sum -= x[t - p]; cnt = p; }
    if (cnt === p) out[t] = sum / p;
  }
  return out;
}

export function ema(x: ArrayLike<number>, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  const a = 2 / (p + 1);
  let start = 0;
  while (start < n && !Number.isFinite(x[start])) start++;
  if (start + p > n) return out;
  let s = 0;
  for (let t = start; t < start + p; t++) s += x[t];
  let prev = s / p;
  out[start + p - 1] = prev;
  for (let t = start + p; t < n; t++) {
    prev = a * x[t] + (1 - a) * prev;
    out[t] = prev;
  }
  return out;
}

/** Wilder RSI */
export function rsi(x: ArrayLike<number>, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  if (n <= p) return out;
  let g = 0, l = 0;
  for (let t = 1; t <= p; t++) {
    const d = x[t] - x[t - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= p; l /= p;
  const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[p] = val();
  for (let t = p + 1; t < n; t++) {
    const d = x[t] - x[t - 1];
    g = (g * (p - 1) + (d > 0 ? d : 0)) / p;
    l = (l * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[t] = val();
  }
  return out;
}

export function macdLine(x: ArrayLike<number>, f: number, s: number): Float64Array {
  const a = ema(x, f), b = ema(x, s), out = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) out[t] = a[t] - b[t];
  return out;
}

export function macdSignal(x: ArrayLike<number>, f: number, s: number, g: number): Float64Array {
  return ema(macdLine(x, f, s), g);
}

export function macdHist(x: ArrayLike<number>, f: number, s: number, g: number): Float64Array {
  const m = macdLine(x, f, s), sg = ema(m, g), out = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) out[t] = m[t] - sg[t];
  return out;
}

export function rollingStd(x: ArrayLike<number>, p: number): Float64Array {
  const n = x.length, out = new Float64Array(n).fill(NaN);
  for (let t = p - 1; t < n; t++) {
    let s = 0, s2 = 0;
    for (let k = t - p + 1; k <= t; k++) { s += x[k]; s2 += x[k] * x[k]; }
    const m = s / p;
    out[t] = Math.sqrt(Math.max(0, s2 / p - m * m));
  }
  return out;
}

export function bb(x: ArrayLike<number>, p: number, k: number, side: -1 | 0 | 1): Float64Array {
  const m = sma(x, p);
  if (side === 0) return m;
  const sd = rollingStd(x, p), out = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) out[t] = m[t] + side * k * sd[t];
  return out;
}

export interface Bars {
  time: number[];   // unix seconds
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
}

/** The library object `L` handed to generated code. Cached per bar-set. */
export interface IndicatorLib {
  sma(p: number): Float64Array;
  ema(p: number): Float64Array;
  rsi(p: number): Float64Array;
  macd(f: number, s: number): Float64Array;
  macdSignal(f: number, s: number, g: number): Float64Array;
  macdHist(f: number, s: number, g: number): Float64Array;
  bbUpper(p: number, k: number): Float64Array;
  bbMiddle(p: number): Float64Array;
  bbLower(p: number, k: number): Float64Array;
}

export function makeLib(bars: Bars): IndicatorLib {
  const cache = new Map<string, Float64Array>();
  const c = bars.close;
  const memo = (key: string, fn: () => Float64Array) => {
    let v = cache.get(key);
    if (!v) { v = fn(); cache.set(key, v); }
    return v;
  };
  return Object.freeze({
    sma: (p: number) => memo(`sma${p}`, () => sma(c, p)),
    ema: (p: number) => memo(`ema${p}`, () => ema(c, p)),
    rsi: (p: number) => memo(`rsi${p}`, () => rsi(c, p)),
    macd: (f: number, s: number) => memo(`macd${f},${s}`, () => macdLine(c, f, s)),
    macdSignal: (f: number, s: number, g: number) => memo(`macds${f},${s},${g}`, () => macdSignal(c, f, s, g)),
    macdHist: (f: number, s: number, g: number) => memo(`macdh${f},${s},${g}`, () => macdHist(c, f, s, g)),
    bbUpper: (p: number, k: number) => memo(`bbu${p},${k}`, () => bb(c, p, k, 1)),
    bbMiddle: (p: number) => memo(`bbm${p}`, () => bb(c, p, 2, 0)),
    bbLower: (p: number, k: number) => memo(`bbl${p},${k}`, () => bb(c, p, k, -1)),
  });
}
