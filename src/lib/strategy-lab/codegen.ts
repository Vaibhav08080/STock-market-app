// ─────────────────────────────────────────────────────────────────────────────
// Deterministic code generation + guard  — QuantForge Pro §IV.C
// One IR → exactly one program (fixed templates, no LLM involved).
// The guard is the browser analogue of the paper's AST whitelist: every token
// of the program is checked before it is ever compiled.
// ─────────────────────────────────────────────────────────────────────────────
import type { Cond, Operand, StrategyIR, IndicatorDef } from './ir';
import type { Bars, IndicatorLib } from './indicators';

const LIB_CALL: Record<IndicatorDef['type'], (p: IndicatorDef['params']) => string> = {
  SMA: p => `L.sma(${p.period})`,
  EMA: p => `L.ema(${p.period})`,
  RSI: p => `L.rsi(${p.period})`,
  MACD: p => `L.macd(${p.fast}, ${p.slow})`,
  MACD_SIGNAL: p => `L.macdSignal(${p.fast}, ${p.slow}, ${p.signal})`,
  MACD_HIST: p => `L.macdHist(${p.fast}, ${p.slow}, ${p.signal})`,
  BB_UPPER: p => `L.bbUpper(${p.period}, ${p.std})`,
  BB_MIDDLE: p => `L.bbMiddle(${p.period})`,
  BB_LOWER: p => `L.bbLower(${p.period}, ${p.std})`,
};

const num = (v: number) => {
  const s = String(v);
  return v < 0 ? `(${s})` : s;
};

function opnd(o: Operand, idx: string): string {
  if (o.kind === 'const') return num(o.value);
  if (['close', 'open', 'high', 'low'].includes(o.ref)) return `${o.ref}[${idx}]`;
  return `i_${o.ref}[${idx}]`;
}

function condExpr(c: Cond): string {
  switch (c.op) {
    case 'and': return '(' + c.args.map(condExpr).join(' && ') + ')';
    case 'or': return '(' + c.args.map(condExpr).join(' || ') + ')';
    case 'lt': return `(${opnd(c.left, 't')} < ${opnd(c.right, 't')})`;
    case 'le': return `(${opnd(c.left, 't')} <= ${opnd(c.right, 't')})`;
    case 'gt': return `(${opnd(c.left, 't')} > ${opnd(c.right, 't')})`;
    case 'ge': return `(${opnd(c.left, 't')} >= ${opnd(c.right, 't')})`;
    case 'cross_above':
      return `(t > 0 && ${opnd(c.left, 't - 1')} <= ${opnd(c.right, 't - 1')} && ${opnd(c.left, 't')} > ${opnd(c.right, 't')})`;
    case 'cross_below':
      return `(t > 0 && ${opnd(c.left, 't - 1')} >= ${opnd(c.right, 't - 1')} && ${opnd(c.left, 't')} < ${opnd(c.right, 't')})`;
  }
}

/** Fixed template: a single bar loop that returns the target position per bar. */
export function generateCode(ir: StrategyIR): string {
  const lines: string[] = [];
  lines.push('const n = close.length;');
  for (const d of ir.indicators) lines.push(`const i_${d.name} = ${LIB_CALL[d.type](d.params)};`);
  lines.push('const pos = new Uint8Array(n);');
  lines.push('let p = 0;');
  lines.push('let fill = 0;');
  lines.push('for (let t = 0; t < n; t++) {');
  lines.push('  if (p === 0) {');
  lines.push(`    if (${condExpr(ir.entry)}) {`);
  lines.push('      p = 1;');
  lines.push('      fill = t + 1 < n ? open[t + 1] : close[t];');
  lines.push('    }');
  lines.push('  } else {');
  const exits: string[] = [];
  if (ir.exit) exits.push(condExpr(ir.exit));
  if (ir.stop_loss_pct !== null) exits.push(`(close[t] <= fill * ${num(1 - ir.stop_loss_pct / 100)})`);
  if (ir.take_profit_pct !== null) exits.push(`(close[t] >= fill * ${num(1 + ir.take_profit_pct / 100)})`);
  lines.push(`    if (${exits.join(' || ') || 'false'}) {`);
  lines.push('      p = 0;');
  lines.push('    }');
  lines.push('  }');
  lines.push('  pos[t] = p;');
  lines.push('}');
  lines.push('return pos;');
  return lines.join('\n');
}

// ─── Guard (token whitelist) ────────────────────────────────────────────────
const KEYWORDS = new Set(['const', 'let', 'for', 'if', 'else', 'return', 'new', 'false', 'true']);
const GLOBALS = new Set(['Uint8Array', 'n', 't', 'p', 'fill', 'pos', 'L', 'open', 'high', 'low', 'close']);
const LIB_METHODS = new Set(['sma', 'ema', 'rsi', 'macd', 'macdSignal', 'macdHist', 'bbUpper', 'bbMiddle', 'bbLower']);
const ALLOWED_INDEX = new Set(['t', 't - 1', 't + 1']);
const OPS = new Set(['=', '==', '===', '<', '>', '<=', '>=', '&&', '||', '+', '-', '*', '++', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}']);

export interface GuardResult { ok: boolean; reason?: string }

export function guard(src: string): GuardResult {
  if (/["'`\\]/.test(src)) return { ok: false, reason: 'string literals / escapes are not allowed' };
  if (/\/\/|\/\*/.test(src)) return { ok: false, reason: 'comments are not allowed' };
  if (/=>/.test(src)) return { ok: false, reason: 'nested functions are not allowed' };
  if (src.length > 20000) return { ok: false, reason: 'program too large' };

  const tokenRe = /\s*([A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?(?:e[-+]?\d+)?|===|==|<=|>=|&&|\|\||\+\+|[=<>+\-*?:;,.()[\]{}])/gy;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = tokenRe.exec(src)) !== null) { tokens.push(m[1]); last = tokenRe.lastIndex; }
  if (src.slice(last).trim() !== '') return { ok: false, reason: `unexpected character near "${src.slice(last, last + 12)}"` };

  let forCount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (/^\d/.test(tk)) continue;
    if (OPS.has(tk)) {
      if (tk === '.') {
        const prev = tokens[i - 1], next = tokens[i + 1];
        if (/^\d/.test(prev ?? '')) continue; // shouldn't happen (numbers tokenised whole)
        const okLen = next === 'length' && ['close', 'open', 'high', 'low'].includes(prev);
        const okLib = prev === 'L' && LIB_METHODS.has(next);
        if (!okLen && !okLib) return { ok: false, reason: `attribute access "${prev}.${next}" is not allowed` };
        i++; // skip attribute name
      }
      continue;
    }
    if (KEYWORDS.has(tk)) { if (tk === 'for') forCount++; continue; }
    if (GLOBALS.has(tk)) continue;
    if (/^i_[a-z][a-z0-9_]*$/.test(tk)) continue;
    return { ok: false, reason: `identifier "${tk}" is not whitelisted` };
  }
  if (forCount !== 1 || !src.includes('for (let t = 0; t < n; t++)')) return { ok: false, reason: 'only the single bar loop over range is allowed' };

  // every subscript must be [t], [t - 1] or [t + 1] (no computed indices)
  const subRe = /\[([^\]]*)\]/g;
  while ((m = subRe.exec(src)) !== null) {
    if (!ALLOWED_INDEX.has(m[1].trim())) return { ok: false, reason: `subscript [${m[1]}] is not allowed` };
  }
  return { ok: true };
}

export type CompiledStrategy = (L: IndicatorLib, open: Float64Array, high: Float64Array, low: Float64Array, close: Float64Array) => Uint8Array;

export function compile(src: string): CompiledStrategy {
  const g = guard(src);
  if (!g.ok) throw new Error(`Guard rejected program: ${g.reason}`);
  return new Function('L', 'open', 'high', 'low', 'close', src) as CompiledStrategy;
}

export function runCompiled(fn: CompiledStrategy, bars: Bars, L: IndicatorLib): Uint8Array {
  return fn(L, bars.open, bars.high, bars.low, bars.close);
}
