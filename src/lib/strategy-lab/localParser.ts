// Offline fallback parser (used when no OpenAI key is configured).
// Rule-based: covers the common retail phrasings for RSI / SMA / EMA / MACD /
// Bollinger rules + stop-loss / take-profit. It emits the SAME typed IR the LLM
// would, so everything downstream (validator → codegen → verification) is identical.
import type { Cond, IndicatorDef, IndicatorType, Operand } from './ir';
import { isLogic } from './ir';
import type { SymbolHint } from './data';

export interface ParseOutput {
  reply: string;
  ir: unknown | null;
  symbol: SymbolHint | null;
  interval: string | null;
}

interface Ctx { inds: IndicatorDef[]; assumptions: string[] }

function ind(ctx: Ctx, type: IndicatorType, params: IndicatorDef['params']): Operand {
  const key = JSON.stringify([type, params]);
  const found = ctx.inds.find(d => JSON.stringify([d.type, d.params]) === key);
  if (found) return { kind: 'ref', ref: found.name };
  const base: Record<IndicatorType, string> = {
    SMA: 'sma', EMA: 'ema', RSI: 'rsi', MACD: 'macd', MACD_SIGNAL: 'macd_sig', MACD_HIST: 'macd_hist',
    BB_UPPER: 'bb_up', BB_MIDDLE: 'bb_mid', BB_LOWER: 'bb_low',
  };
  const name = `${base[type]}${params.period ?? ''}`.replace(/[^a-z0-9_]/g, '') + (ctx.inds.some(d => d.name.startsWith(base[type])) ? `_${ctx.inds.length}` : '');
  ctx.inds.push({ name, type, params });
  return { kind: 'ref', ref: name };
}

const C = (v: number): Operand => ({ kind: 'const', value: v });
const CLOSE: Operand = { kind: 'ref', ref: 'close' };

const maType = (s: string): IndicatorType => (/ema|exponential/.test(s) ? 'EMA' : 'SMA');
const dir = (s: string): 'up' | 'down' => (/above|over|>|greater|rise|rises|up/.test(s) ? 'up' : 'down');

const NUM = '(\\d+(?:\\.\\d+)?)';
const MA = '(ema|sma|ma|dma|moving average|exponential moving average|simple moving average)';
const PER = '(?:[- ]?(?:day|period|bar|d))?';

function parseClause(text: string, ctx: Ctx): Cond[] {
  const out: Cond[] = [];
  let s = ` ${text} `;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => Cond | null) => {
    let m: RegExpMatchArray | null;
    while ((m = s.match(re))) {
      const c = f(m);
      if (c) out.push(c);
      s = s.replace(m[0], ' ');
    }
  };

  // golden / death cross
  take(/golden cross/, () => ({ op: 'cross_above', left: ind(ctx, 'SMA', { period: 50 }), right: ind(ctx, 'SMA', { period: 200 }) }));
  take(/death cross/, () => ({ op: 'cross_below', left: ind(ctx, 'SMA', { period: 50 }), right: ind(ctx, 'SMA', { period: 200 }) }));

  // MA crosses MA:  "50 ema crosses above 200 ema", "ema 9 crosses below ema 21"
  take(new RegExp(`(?:(\\d+)${PER}\\s*${MA}|${MA}\\s*\\(?(\\d+)\\)?)\\s+(?:line\\s+)?cross(?:es|ed)?\\s+(above|over|below|under)\\s+(?:the\\s+)?(?:(\\d+)${PER}\\s*${MA}|${MA}\\s*\\(?(\\d+)\\)?)`), m => {
    const p1 = Number(m[1] ?? m[4]), t1 = maType(m[2] ?? m[3]);
    const p2 = Number(m[6] ?? m[9]), t2 = maType(m[7] ?? m[8]);
    const op = dir(m[5]) === 'up' ? 'cross_above' : 'cross_below';
    return { op, left: ind(ctx, t1, { period: p1 }), right: ind(ctx, t2, { period: p2 }) };
  });

  // price crosses MA
  take(new RegExp(`(?:price|close|it|stock)\\s+cross(?:es|ed)?\\s+(above|over|below|under)\\s+(?:the\\s+)?(?:(\\d+)${PER}\\s*${MA}|${MA}\\s*\\(?(\\d+)\\)?)`), m => ({
    op: dir(m[1]) === 'up' ? 'cross_above' : 'cross_below', left: CLOSE,
    right: ind(ctx, maType(m[3] ?? m[4]), { period: Number(m[2] ?? m[5]) }),
  }));

  // price above / below MA
  take(new RegExp(`(?:price|close|it|stock)?\\s*(?:is\\s+|stays\\s+|trades\\s+|closes\\s+)?(above|over|below|under)\\s+(?:the\\s+|its\\s+)?(?:(\\d+)${PER}\\s*${MA}|${MA}\\s*\\(?(\\d+)\\)?)`), m => ({
    op: dir(m[1]) === 'up' ? 'gt' : 'lt', left: CLOSE,
    right: ind(ctx, maType(m[3] ?? m[4]), { period: Number(m[2] ?? m[5]) }),
  }));

  // MACD
  take(/macd(?: line)?\s+cross(?:es|ed)?\s+(above|over|below|under)\s+(?:the\s+)?(?:signal|signal line)/, m => ({
    op: dir(m[1]) === 'up' ? 'cross_above' : 'cross_below',
    left: ind(ctx, 'MACD', { fast: 12, slow: 26 }), right: ind(ctx, 'MACD_SIGNAL', { fast: 12, slow: 26, signal: 9 }),
  }));
  take(/macd(?: line)?\s+(?:is\s+)?(above|over|below|under|greater than|less than)\s+(?:the\s+)?(?:zero|0)(?:\s+line)?/, m => ({
    op: dir(m[1]) === 'up' ? 'gt' : 'lt', left: ind(ctx, 'MACD', { fast: 12, slow: 26 }), right: C(0),
  }));
  take(/macd(?: line)?\s+(?:is\s+)?(above|over|below|under)\s+(?:the\s+)?signal/, m => ({
    op: dir(m[1]) === 'up' ? 'gt' : 'lt',
    left: ind(ctx, 'MACD', { fast: 12, slow: 26 }), right: ind(ctx, 'MACD_SIGNAL', { fast: 12, slow: 26, signal: 9 }),
  }));
  take(/macd histogram\s+(?:turns|is|goes)\s+(positive|negative)/, m => ({
    op: m[1] === 'positive' ? 'gt' : 'lt', left: ind(ctx, 'MACD_HIST', { fast: 12, slow: 26, signal: 9 }), right: C(0),
  }));

  // Bollinger
  take(/(?:price|close|it)?\s*(?:falls|drops|is|goes|closes|trades)?\s*(below|under|beneath|touches|hits)\s+(?:the\s+)?lower\s+(?:bollinger\s+)?band/, () => ({
    op: 'lt', left: CLOSE, right: ind(ctx, 'BB_LOWER', { period: 20, std: 2 }),
  }));
  take(/(?:price|close|it)?\s*(?:rises|goes|is|closes|trades)?\s*(above|over|touches|hits)\s+(?:the\s+)?upper\s+(?:bollinger\s+)?band/, () => ({
    op: 'gt', left: CLOSE, right: ind(ctx, 'BB_UPPER', { period: 20, std: 2 }),
  }));
  take(/(?:price|close|it)?\s*(?:crosses|reaches|returns to|touches|hits|goes|at|to)\s+(?:above\s+)?(?:the\s+)?(?:middle|mid|center)\s+(?:bollinger\s+)?band/, () => ({
    op: 'gt', left: CLOSE, right: ind(ctx, 'BB_MIDDLE', { period: 20, std: 2 }),
  }));

  // RSI with explicit period before: "14-day rsi drops below 30"
  take(new RegExp(`(\\d+)${PER}\\s*rsi\\s*(?:is\\s+|goes\\s+|drops\\s+|falls\\s+|rises\\s+|moves\\s+)?(crosses above|crosses below|cross above|cross below|crossed above|crossed below|crosses|crossed|cross|below|under|less than|above|over|greater than|<|>)\\s*${NUM}`), m => rsiCond(ctx, Number(m[1]), m[2], Number(m[3])));
  // "rsi(14) < 30", "rsi below 30"
  take(new RegExp(`rsi\\s*(?:\\(?(\\d+)\\)?)?\\s*(?:is\\s+|goes\\s+|drops\\s+|falls\\s+|rises\\s+|moves\\s+)?(crosses above|crosses below|cross above|cross below|crossed above|crossed below|crosses|crossed|cross|below|under|less than|above|over|greater than|<|>)\\s*${NUM}`), m => rsiCond(ctx, m[1] ? Number(m[1]) : 14, m[2], Number(m[3])));

  // vague words → documented defaults (paper §IV.B)
  take(/\boversold\b/, () => { ctx.assumptions.push('"oversold" interpreted as RSI(14) < 30'); return { op: 'lt', left: ind(ctx, 'RSI', { period: 14 }), right: C(30) }; });
  take(/\boverbought\b/, () => { ctx.assumptions.push('"overbought" interpreted as RSI(14) > 70'); return { op: 'gt', left: ind(ctx, 'RSI', { period: 14 }), right: C(70) }; });
  take(/\buptrend\b/, () => { ctx.assumptions.push('"uptrend" interpreted as close > EMA(200)'); return { op: 'gt', left: CLOSE, right: ind(ctx, 'EMA', { period: 200 }) }; });
  take(/\bdowntrend\b/, () => { ctx.assumptions.push('"downtrend" interpreted as close < EMA(200)'); return { op: 'lt', left: CLOSE, right: ind(ctx, 'EMA', { period: 200 }) }; });
  return out;
}

function rsiCond(ctx: Ctx, period: number, word: string, v: number): Cond {
  const r = ind(ctx, 'RSI', { period });
  if (/cross/.test(word)) {
    const up = /above|over/.test(word) ? true : /below|under/.test(word) ? false : v >= 50;
    return { op: up ? 'cross_above' : 'cross_below', left: r, right: C(v) };
  }
  return { op: dir(word) === 'up' ? 'gt' : 'lt', left: r, right: C(v) };
}

function combine(conds: Cond[], text: string): Cond | null {
  if (!conds.length) return null;
  if (conds.length === 1) return conds[0];
  return { op: /\bor\b/.test(text) && !/\band\b/.test(text) ? 'or' : 'and', args: conds };
}

function defaultExit(entry: Cond, ctx: Ctx): Cond | null {
  const first = isLogic(entry) ? entry.args[0] : entry;
  if (isLogic(first)) return null;
  const refType = (o: Operand) => (o.kind === 'ref' ? ctx.inds.find(d => d.name === o.ref)?.type : undefined);
  const lt = refType(first.left);
  if (lt === 'RSI') { ctx.assumptions.push('no exit given → sell when RSI crosses above 70'); return { op: 'cross_above', left: first.left, right: C(70) }; }
  if (first.op === 'cross_above') { ctx.assumptions.push('no exit given → sell on the opposite crossover'); return { op: 'cross_below', left: first.left, right: first.right }; }
  if (first.op === 'cross_below') { ctx.assumptions.push('no exit given → sell on the opposite crossover'); return { op: 'cross_above', left: first.left, right: first.right }; }
  if (refType(first.right) === 'BB_LOWER') { ctx.assumptions.push('no exit given → sell when price reaches the middle band'); return { op: 'gt', left: CLOSE, right: ind(ctx, 'BB_MIDDLE', { period: 20, std: 2 }) }; }
  if (first.op === 'gt') { ctx.assumptions.push('no exit given → sell when the entry condition flips'); return { op: 'lt', left: first.left, right: first.right }; }
  if (first.op === 'lt') { ctx.assumptions.push('no exit given → sell when the entry condition flips'); return { op: 'gt', left: first.left, right: first.right }; }
  return null;
}

const CRYPTO: Record<string, string> = { bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', solana: 'SOL', sol: 'SOL', bnb: 'BNB', xrp: 'XRP', ripple: 'XRP', doge: 'DOGE', dogecoin: 'DOGE', cardano: 'ADA', ada: 'ADA' };
const INDIA: Record<string, string> = { reliance: 'RELIANCE', tcs: 'TCS', infosys: 'INFY', infy: 'INFY', hdfc: 'HDFCBANK', hdfcbank: 'HDFCBANK', icici: 'ICICIBANK', icicibank: 'ICICIBANK', sbi: 'SBIN', sbin: 'SBIN', itc: 'ITC', 'tata motors': 'TATAMOTORS', tatamotors: 'TATAMOTORS', wipro: 'WIPRO', nifty: '^NSEI', 'nifty 50': '^NSEI', 'bank nifty': '^NSEBANK', banknifty: '^NSEBANK', airtel: 'BHARTIARTL', lt: 'LT', maruti: 'MARUTI', asianpaint: 'ASIANPAINT', bajfinance: 'BAJFINANCE' };
const US: Record<string, string> = { apple: 'AAPL', aapl: 'AAPL', microsoft: 'MSFT', msft: 'MSFT', nvidia: 'NVDA', nvda: 'NVDA', tesla: 'TSLA', tsla: 'TSLA', google: 'GOOGL', googl: 'GOOGL', amazon: 'AMZN', amzn: 'AMZN', meta: 'META', spy: 'SPY', qqq: 'QQQ', 's&p 500': 'SPY', 'sp500': 'SPY' };

export function detectSymbol(text: string): SymbolHint | null {
  const t = ` ${text.toLowerCase()} `;
  const hit = (map: Record<string, string>) => Object.keys(map).sort((a, b) => b.length - a.length).find(k => new RegExp(`[^a-z]${k.replace(/[&^]/g, '\\$&')}[^a-z]`).test(t));
  let k: string | undefined;
  if ((k = hit(CRYPTO))) return { symbol: CRYPTO[k], market: 'crypto' };
  if ((k = hit(INDIA))) return { symbol: INDIA[k], market: 'india_stock' };
  if ((k = hit(US))) return { symbol: US[k], market: 'us_stock' };
  const nse = text.match(/\b([A-Z]{2,15})\.(NS|BO)\b/);
  if (nse) return { symbol: nse[1], market: 'india_stock' };
  return null;
}

export function localParse(text: string): ParseOutput {
  const t = text.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
  const ctx: Ctx = { inds: [], assumptions: [] };

  // stop / take-profit (global)
  const sl = t.match(new RegExp(`(?:stop[- ]?loss|stoploss|\\bsl\\b|stop)(?:\\s+(?:of|at|is))?\\s*(?:-)?${NUM}\\s*%`)) || t.match(new RegExp(`${NUM}\\s*%\\s*(?:stop|stop[- ]?loss|loss|sl)\\b`));
  const tp = t.match(new RegExp(`(?:take[- ]?profit|target|profit target|\\btp\\b)(?:\\s+(?:of|at|is))?\\s*${NUM}\\s*%`)) || t.match(new RegExp(`${NUM}\\s*%\\s*(?:profit|gain|target|tp)\\b`));
  let body = t;
  if (sl) body = body.replace(sl[0], ' ');
  if (tp) body = body.replace(tp[0], ' ');

  // split entry / exit
  const exitIdx = body.search(/\b(sell|exit|close (?:the )?(?:position|trade)|get out|square off|book profit)\b/);
  const entryText = exitIdx >= 0 ? body.slice(0, exitIdx) : body;
  const exitText = exitIdx >= 0 ? body.slice(exitIdx) : '';

  const entry = combine(parseClause(entryText, ctx), entryText);
  if (!entry) {
    return {
      reply: "I couldn't find a rule I understand yet. Try something like: \"Buy BTC when RSI(14) drops below 30 and price is above the 200 EMA; sell when RSI crosses 70 or after a 5% loss.\" (Offline parser — add an OpenAI key for free-form language.)",
      ir: null, symbol: detectSymbol(text), interval: null,
    };
  }
  let exit = exitText ? combine(parseClause(exitText, ctx), exitText) : null;
  if (!exit && !sl && !tp) exit = defaultExit(entry, ctx);

  const interval = /\b(1h|hourly|1 hour)\b/.test(t) ? '1h' : /\b(4h|4 hour)\b/.test(t) ? '4h' : /\b(weekly|1w)\b/.test(t) ? '1w' : /\b(daily|1d)\b/.test(t) ? '1d' : null;
  return {
    reply: 'Here is how I read your strategy (offline rule parser):',
    ir: {
      indicators: ctx.inds, entry, exit,
      stop_loss_pct: sl ? Number(sl[1]) : null,
      take_profit_pct: tp ? Number(tp[1]) : null,
      assumptions: ctx.assumptions,
    },
    symbol: detectSymbol(text), interval,
  };
}
