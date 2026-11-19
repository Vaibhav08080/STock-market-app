// Historical data loaders for the Strategy Lab.
//  • Crypto  → Binance public klines (CORS-enabled, paginated)
//  • Stocks  → Yahoo Finance chart API through a same-origin proxy (/api/yahoo)
//              (vite.config.ts proxy in dev, vercel.json rewrite in prod)
//  • CSV     → any OHLC file, e.g. the Kaggle NIFTY-50 dataset used in the paper
import type { Bars } from './indicators';

export type DataSource = 'binance' | 'yahoo' | 'csv';

export interface Dataset { bars: Bars; symbol: string; source: DataSource; interval: string; ppy: number; note?: string }

export function periodsPerYear(source: DataSource, interval: string): number {
  const crypto = source === 'binance';
  switch (interval) {
    case '1h': return crypto ? 24 * 365 : 252 * 6.5;
    case '4h': return crypto ? 6 * 365 : 252 * 2;
    case '1w': return 52;
    default: return crypto ? 365 : 252;
  }
}

function toBars(rows: { time: number; open: number; high: number; low: number; close: number }[]): Bars {
  rows.sort((a, b) => a.time - b.time);
  const clean = rows.filter((r, i) =>
    [r.open, r.high, r.low, r.close].every(v => Number.isFinite(v) && v > 0) && (i === 0 || r.time !== rows[i - 1].time));
  return {
    time: clean.map(r => r.time),
    open: Float64Array.from(clean.map(r => r.open)),
    high: Float64Array.from(clean.map(r => r.high)),
    low: Float64Array.from(clean.map(r => r.low)),
    close: Float64Array.from(clean.map(r => r.close)),
  };
}

const BINANCE_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];

export async function loadBinance(symbol: string, interval: string, maxBars = 4000): Promise<Dataset> {
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let lastErr: unknown = null;
  for (const host of BINANCE_HOSTS) {
    try {
      const rows: { time: number; open: number; high: number; low: number; close: number }[] = [];
      let start = 0;
      for (let page = 0; page < 10 && rows.length < maxBars; page++) {
        const url = `${host}/api/v3/klines?symbol=${sym}&interval=${interval}&limit=1000&startTime=${start}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Binance ${res.status} for ${sym}`);
        const data = (await res.json()) as unknown[][];
        if (!data.length) break;
        for (const d of data) rows.push({ time: Math.floor(Number(d[0]) / 1000), open: +String(d[1]), high: +String(d[2]), low: +String(d[3]), close: +String(d[4]) });
        if (data.length < 1000) break;
        start = Number(data[data.length - 1][0]) + 1;
      }
      // drop the still-forming last candle
      if (rows.length > 1) rows.pop();
      if (rows.length < 100) throw new Error(`Only ${rows.length} bars returned for ${sym}`);
      return { bars: toBars(rows), symbol: sym, source: 'binance', interval, ppy: periodsPerYear('binance', interval) };
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Binance request failed');
}

export async function loadYahoo(symbol: string, interval = '1d'): Promise<Dataset> {
  const sym = symbol.trim().toUpperCase();
  // NB: `range=max` silently downgrades to MONTHLY bars — always pass explicit period1/period2.
  const yInterval = interval === '1w' ? '1wk' : '1d';
  const now = Math.floor(Date.now() / 1000);
  const url = `/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?period1=0&period2=${now}&interval=${yInterval}&includeAdjustedClose=true&events=split`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${sym} — is the /api/yahoo proxy running? (see vite.config.ts / vercel.json)`);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || `No data for ${sym}`);
  const ts: number[] = r.timestamp ?? [];
  const q = r.indicators?.quote?.[0] ?? {};
  const rows = ts.map((t, i) => ({ time: t, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i] }));
  const bars = toBars(rows);
  if (bars.close.length < 100) throw new Error(`Only ${bars.close.length} bars for ${sym}`);
  const gran = r.meta?.dataGranularity;
  if (gran && gran !== yInterval) throw new Error(`Yahoo returned ${gran} bars instead of ${yInterval} for ${sym}`);
  // Yahoo adjusts splits but not always bonus issues → same >25% gap heuristic as the paper
  const k = adjustCorporateActions(bars);
  const note = k ? `${k} overnight gap(s) > 25% back-adjusted as corporate actions` : undefined;
  return { bars, symbol: sym, source: 'yahoo', interval, ppy: periodsPerYear('yahoo', interval), note };
}

/** Parses an OHLC CSV (columns: date/time, open, high, low, close — case-insensitive). */
export function parseCSV(text: string, name: string, adjustGaps = true): Dataset {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 50) throw new Error('CSV has too few rows (need ≥ 50).');
  const split = (l: string) => l.split(/,|;|\t/).map(s => s.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map(h => h.toLowerCase());
  const find = (...names: string[]) => head.findIndex(h => names.includes(h));
  const iT = find('date', 'time', 'timestamp', 'datetime', 'open time');
  const iO = find('open'), iH = find('high'), iL = find('low'), iC = find('close', 'adj close', 'close price');
  if ([iT, iO, iH, iL, iC].some(i => i < 0)) throw new Error('CSV needs date, open, high, low, close columns.');
  const rows = lines.slice(1).map(l => {
    const c = split(l);
    const raw = c[iT];
    let t = Number(raw);
    if (!Number.isFinite(t)) t = Date.parse(raw) / 1000;
    else if (t > 1e11) t = Math.floor(t / 1000);
    return { time: Math.floor(t), open: +c[iO], high: +c[iH], low: +c[iL], close: +c[iC] };
  }).filter(r => Number.isFinite(r.time));
  const bars = toBars(rows);
  let note: string | undefined;
  if (adjustGaps) {
    const k = adjustCorporateActions(bars);
    if (k) note = `${k} overnight gap(s) > 25% treated as corporate actions and back-adjusted.`;
  }
  return { bars, symbol: name.replace(/\.csv$/i, ''), source: 'csv', interval: '1d', ppy: 252, note };
}

/** Paper §V.A: an overnight gap > 25% is treated as a split/bonus and earlier prices are rescaled. */
export function adjustCorporateActions(b: Bars): number {
  let count = 0;
  for (let i = b.close.length - 1; i >= 1; i--) {
    const ratio = b.open[i] / b.close[i - 1];
    if (ratio < 0.75 || ratio > 1.25) {
      count++;
      for (let k = 0; k < i; k++) { b.open[k] *= ratio; b.high[k] *= ratio; b.low[k] *= ratio; b.close[k] *= ratio; }
    }
  }
  return count;
}

export interface SymbolHint { symbol: string; market: 'crypto' | 'us_stock' | 'india_stock' }

/** Maps an LLM / user symbol hint onto a concrete data source + ticker. */
export function resolveSymbol(h: SymbolHint): { source: DataSource; symbol: string } {
  const s = h.symbol.trim().toUpperCase();
  if (h.market === 'crypto') return { source: 'binance', symbol: s.endsWith('USDT') ? s : `${s.replace(/USD$/, '')}USDT` };
  if (h.market === 'india_stock') return { source: 'yahoo', symbol: /\.(NS|BO)$/.test(s) ? s : `${s}.NS` };
  return { source: 'yahoo', symbol: s };
}
