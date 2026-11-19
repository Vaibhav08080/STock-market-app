// ─────────────────────────────────────────────────────────────────────────────
// Typed Intermediate Representation (IR)  — QuantForge Pro §IV.B
// The LLM is only allowed to emit this JSON. Everything after the validator is
// deterministic (codegen → guard → behavioural check → backtest).
// ─────────────────────────────────────────────────────────────────────────────

export type IndicatorType =
  | 'SMA' | 'EMA' | 'RSI'
  | 'MACD' | 'MACD_SIGNAL' | 'MACD_HIST'
  | 'BB_UPPER' | 'BB_MIDDLE' | 'BB_LOWER';

export interface IndicatorParams {
  period?: number;   // SMA / EMA / RSI / BB
  fast?: number;     // MACD*
  slow?: number;     // MACD*
  signal?: number;   // MACD*
  std?: number;      // BB*
}

export interface IndicatorDef {
  name: string;              // identifier used in conditions, e.g. "r", "ema200"
  type: IndicatorType;
  params: IndicatorParams;
}

export type PriceRef = 'close' | 'open' | 'high' | 'low';

export type Operand =
  | { kind: 'ref'; ref: string }      // price field or indicator name
  | { kind: 'const'; value: number };

export type CmpOp = 'lt' | 'gt' | 'le' | 'ge';
export type CrossOp = 'cross_above' | 'cross_below';

export type LogicCond = { op: 'and' | 'or'; args: Cond[] };
export type AtomCond = { op: CmpOp | CrossOp; left: Operand; right: Operand };
export type Cond = LogicCond | AtomCond;
export const isLogic = (c: Cond): c is LogicCond => c.op === 'and' || c.op === 'or';

export interface StrategyIR {
  indicators: IndicatorDef[];
  entry: Cond;
  exit: Cond | null;
  stop_loss_pct: number | null;    // e.g. 5 → exit if close ≤ fill × 0.95
  take_profit_pct: number | null;  // extension (not in paper): exit if close ≥ fill × (1+tp)
  assumptions: string[];           // defaults the parser had to pick ("oversold" → RSI(14) < 30)
}

export const PRICE_REFS: PriceRef[] = ['close', 'open', 'high', 'low'];
export const INDICATOR_TYPES: IndicatorType[] = [
  'SMA', 'EMA', 'RSI', 'MACD', 'MACD_SIGNAL', 'MACD_HIST', 'BB_UPPER', 'BB_MIDDLE', 'BB_LOWER',
];

// Ranges enforced by the validator (out-of-range → actionable error)
export const PARAM_RANGES: Record<string, [number, number]> = {
  period: [2, 400],
  fast: [2, 100],
  slow: [3, 300],
  signal: [2, 100],
  std: [0.5, 5],
};

export const DEFAULT_PARAMS: Record<IndicatorType, IndicatorParams> = {
  SMA: { period: 50 },
  EMA: { period: 50 },
  RSI: { period: 14 },
  MACD: { fast: 12, slow: 26, signal: 9 },
  MACD_SIGNAL: { fast: 12, slow: 26, signal: 9 },
  MACD_HIST: { fast: 12, slow: 26, signal: 9 },
  BB_UPPER: { period: 20, std: 2 },
  BB_MIDDLE: { period: 20, std: 2 },
  BB_LOWER: { period: 20, std: 2 },
};

const NAME_RE = /^[a-z][a-z0-9_]{0,23}$/;

// ─── Validator ───────────────────────────────────────────────────────────────
export interface ValidationResult { ok: boolean; errors: string[]; ir?: StrategyIR }

/** Normalises loose LLM output into a StrategyIR and validates it. */
export function validateIR(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['IR must be a JSON object.'] };
  const r = raw as Record<string, unknown>;

  // indicators
  const indicators: IndicatorDef[] = [];
  const names = new Set<string>();
  const rawInds = Array.isArray(r.indicators) ? r.indicators : [];
  for (const it of rawInds) {
    if (!it || typeof it !== 'object') { errors.push('Indicator entries must be objects.'); continue; }
    const o = it as Record<string, unknown>;
    const name = String(o.name ?? '').toLowerCase();
    const type = String(o.type ?? '').toUpperCase() as IndicatorType;
    if (!NAME_RE.test(name)) { errors.push(`Indicator name "${o.name}" is invalid (use lowercase letters/digits/_).`); continue; }
    if ((PRICE_REFS as string[]).includes(name)) { errors.push(`Indicator name "${name}" clashes with a price field.`); continue; }
    if (names.has(name)) { errors.push(`Indicator "${name}" is defined twice.`); continue; }
    if (!INDICATOR_TYPES.includes(type)) {
      errors.push(`Unknown indicator type "${o.type}". Supported: ${INDICATOR_TYPES.join(', ')}.`);
      continue;
    }
    const p = (o.params && typeof o.params === 'object' ? o.params : {}) as Record<string, unknown>;
    const def = DEFAULT_PARAMS[type];
    const params: IndicatorParams = {};
    for (const k of Object.keys(def) as (keyof IndicatorParams)[]) {
      const v = p[k] === undefined || p[k] === null ? def[k] : Number(p[k]);
      if (v === undefined || !Number.isFinite(v)) { errors.push(`${name}: parameter "${k}" must be a number.`); continue; }
      const [lo, hi] = PARAM_RANGES[k];
      if (v < lo || v > hi) { errors.push(`${name}: ${k}=${v} is out of range [${lo}, ${hi}].`); continue; }
      params[k] = k === 'std' ? v : Math.round(v);
    }
    if (params.fast !== undefined && params.slow !== undefined && params.fast >= params.slow) {
      errors.push(`${name}: fast period (${params.fast}) must be shorter than slow period (${params.slow}).`);
    }
    names.add(name);
    indicators.push({ name, type, params });
  }

  const known = new Set<string>([...PRICE_REFS, ...names]);

  const normOperand = (x: unknown, where: string): Operand | null => {
    if (typeof x === 'number') return { kind: 'const', value: x };
    if (typeof x === 'string') {
      const n = Number(x);
      if (x.trim() !== '' && Number.isFinite(n)) return { kind: 'const', value: n };
      const ref = x.toLowerCase();
      if (!known.has(ref)) { errors.push(`${where}: "${x}" is not defined (define it in indicators or use close/open/high/low).`); return null; }
      return { kind: 'ref', ref };
    }
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (o.kind === 'const' || ('value' in o && o.value !== null && o.value !== undefined && !('ref' in o && o.ref))) {
        const v = Number(o.value);
        if (!Number.isFinite(v)) { errors.push(`${where}: constant must be a number.`); return null; }
        return { kind: 'const', value: v };
      }
      if (typeof o.ref === 'string') return normOperand(o.ref, where);
    }
    errors.push(`${where}: operand is malformed.`);
    return null;
  };

  const normCond = (x: unknown, where: string, depth = 0): Cond | null => {
    if (depth > 8) { errors.push(`${where}: condition is nested too deeply.`); return null; }
    if (!x || typeof x !== 'object') { errors.push(`${where}: condition missing.`); return null; }
    const o = x as Record<string, unknown>;
    const op = String(o.op ?? '').toLowerCase();
    if (op === 'and' || op === 'or') {
      const args = Array.isArray(o.args) ? o.args : [];
      if (args.length < 1) { errors.push(`${where}: "${op}" needs at least one argument.`); return null; }
      const out = args.map((a, i) => normCond(a, `${where}.${op}[${i}]`, depth + 1)).filter(Boolean) as Cond[];
      if (out.length !== args.length) return null;
      return out.length === 1 ? out[0] : { op, args: out };
    }
    const alias: Record<string, string> = { '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge', crosses_above: 'cross_above', crosses_below: 'cross_below' };
    const op2 = (alias[op] ?? op) as CmpOp | CrossOp;
    if (!['lt', 'gt', 'le', 'ge', 'cross_above', 'cross_below'].includes(op2)) {
      errors.push(`${where}: unknown operator "${o.op}".`); return null;
    }
    const left = normOperand(o.left, `${where}.left`);
    const right = normOperand(o.right, `${where}.right`);
    if (!left || !right) return null;
    if (left.kind === 'const' && right.kind === 'const') {
      errors.push(`${where}: comparing two constants (${left.value} vs ${right.value}) is meaningless.`); return null;
    }
    if ((op2 === 'cross_above' || op2 === 'cross_below') && left.kind === 'const') {
      errors.push(`${where}: the left side of a crossover must be a series, not a constant.`); return null;
    }
    return { op: op2, left, right };
  };

  const entry = normCond(r.entry, 'entry');
  const exit = r.exit === null || r.exit === undefined ? null : normCond(r.exit, 'exit');

  const pct = (v: unknown, label: string): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n >= 100) { errors.push(`${label} must be between 0 and 100 (percent).`); return null; }
    return n;
  };
  const stop = pct(r.stop_loss_pct, 'stop_loss_pct');
  const tp = pct(r.take_profit_pct, 'take_profit_pct');

  if (!exit && stop === null && tp === null) {
    errors.push('No exit rule: add an exit condition, a stop-loss or a take-profit.');
  }

  // unused indicators are allowed but trimmed
  const used = new Set<string>();
  const walk = (c: Cond | null) => {
    if (!c) return;
    if (isLogic(c)) { c.args.forEach(walk); return; }
    for (const s of [c.left, c.right]) if (s.kind === 'ref') used.add(s.ref);
  };
  walk(entry); walk(exit);

  const assumptions = Array.isArray(r.assumptions) ? r.assumptions.map(String).slice(0, 10) : [];

  if (errors.length || !entry) return { ok: false, errors: errors.length ? errors : ['Entry condition missing.'] };
  return {
    ok: true, errors: [],
    ir: {
      indicators: indicators.filter(i => used.has(i.name)),
      entry, exit, stop_loss_pct: stop, take_profit_pct: tp, assumptions,
    },
  };
}

// ─── Paraphrase (paper §VII: the system paraphrases the IR back to the user) ─
export function describeIndicator(d: IndicatorDef): string {
  const p = d.params;
  switch (d.type) {
    case 'SMA': case 'EMA': case 'RSI': return `${d.type}(${p.period})`;
    case 'MACD': return `MACD(${p.fast},${p.slow})`;
    case 'MACD_SIGNAL': return `MACD signal(${p.fast},${p.slow},${p.signal})`;
    case 'MACD_HIST': return `MACD histogram(${p.fast},${p.slow},${p.signal})`;
    case 'BB_UPPER': return `upper Bollinger(${p.period},${p.std})`;
    case 'BB_MIDDLE': return `middle Bollinger(${p.period})`;
    case 'BB_LOWER': return `lower Bollinger(${p.period},${p.std})`;
  }
}

export function paraphraseCond(c: Cond, ir: StrategyIR): string {
  const opnd = (o: Operand) => {
    if (o.kind === 'const') return String(+o.value.toFixed(4));
    const d = ir.indicators.find(i => i.name === o.ref);
    return d ? describeIndicator(d) : o.ref;
  };
  switch (c.op) {
    case 'and': return c.args.map(a => paraphraseCond(a, ir)).join(' AND ');
    case 'or': return '(' + c.args.map(a => paraphraseCond(a, ir)).join(' OR ') + ')';
    case 'lt': return `${opnd(c.left)} < ${opnd(c.right)}`;
    case 'le': return `${opnd(c.left)} ≤ ${opnd(c.right)}`;
    case 'gt': return `${opnd(c.left)} > ${opnd(c.right)}`;
    case 'ge': return `${opnd(c.left)} ≥ ${opnd(c.right)}`;
    case 'cross_above': return `${opnd(c.left)} crosses above ${opnd(c.right)}`;
    case 'cross_below': return `${opnd(c.left)} crosses below ${opnd(c.right)}`;
  }
}

export function paraphraseIR(ir: StrategyIR): string[] {
  const lines = [`BUY (long) when ${paraphraseCond(ir.entry, ir)}`];
  if (ir.exit) lines.push(`SELL when ${paraphraseCond(ir.exit, ir)}`);
  if (ir.stop_loss_pct !== null) lines.push(`Stop-loss: close ≤ ${ir.stop_loss_pct}% below entry fill`);
  if (ir.take_profit_pct !== null) lines.push(`Take-profit: close ≥ ${ir.take_profit_pct}% above entry fill`);
  return lines;
}

// ─── Atomic predicates (used for MC/DC probe coverage) ──────────────────────
export function atomicPredicates(c: Cond | null, out: Cond[] = []): Cond[] {
  if (!c) return out;
  if (isLogic(c)) c.args.forEach(a => atomicPredicates(a, out));
  else out.push(c);
  return out;
}

export const cloneIR = (ir: StrategyIR): StrategyIR => JSON.parse(JSON.stringify(ir));
