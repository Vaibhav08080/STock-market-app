// ─────────────────────────────────────────────────────────────────────────────
// Behavioural consistency check  — QuantForge Pro §IV.D
// The generated program is admitted only if its position series equals the
// independent interpreter's on EVERY bar of EVERY probe series.
// Also: a small in-browser mutation self-test (paper §V.C) that seeds faults
// into the generated source and reports how many the check catches.
// ─────────────────────────────────────────────────────────────────────────────
import type { StrategyIR } from './ir';
import { makeLib } from './indicators';
import { interpret } from './interpreter';
import { compile, generateCode, guard, runCompiled } from './codegen';
import type { ProbeSeries } from './probes';

export interface ProbeOutcome { id: string; kind: string; bars: number; match: boolean; firstDivergence?: { index: number; time: number; expected: number; got: number }; entries: number }

export interface VerifyResult { ok: boolean; outcomes: ProbeOutcome[]; firstFailure?: ProbeOutcome }

export function behaviouralCheck(ir: StrategyIR, code: string, probes: ProbeSeries[]): VerifyResult {
  const fn = compile(code);
  const outcomes: ProbeOutcome[] = probes.map(p => {
    const L = makeLib(p.bars);
    const ref = interpret(ir, p.bars, makeLib(p.bars)).pos;
    let got: Uint8Array;
    try { got = runCompiled(fn, p.bars, L); }
    catch { return { id: p.id, kind: p.kind, bars: ref.length, match: false, firstDivergence: { index: 0, time: p.bars.time[0], expected: ref[0], got: -1 }, entries: 0 }; }
    let entries = 0;
    for (let t = 0; t < ref.length; t++) {
      if ((t === 0 ? 0 : ref[t - 1]) === 0 && ref[t] === 1) entries++;
      if (ref[t] !== got[t]) {
        return { id: p.id, kind: p.kind, bars: ref.length, match: false, firstDivergence: { index: t, time: p.bars.time[t], expected: ref[t], got: got[t] }, entries };
      }
    }
    return { id: p.id, kind: p.kind, bars: ref.length, match: true, entries };
  });
  const firstFailure = outcomes.find(o => !o.match);
  return { ok: !firstFailure, outcomes, firstFailure };
}

// ─── Mutation self-test ──────────────────────────────────────────────────────
export type MutOp = 'CONST' | 'ROR-invert' | 'ROR-boundary' | 'LCR' | 'LOOKAHEAD' | 'WINDOW' | 'STOP-SIGN' | 'CROSS→LEVEL';

function mutants(code: string): { op: MutOp; code: string }[] {
  const out: { op: MutOp; code: string }[] = [];
  const loopStart = code.indexOf('for (let t');
  const head = code.slice(0, loopStart), body = code.slice(loopStart);
  const entryLine = body.split('\n').find(l => l.trim().startsWith('if (') && !l.includes('p === 0')) ?? '';
  const replaceNth = (s: string, re: RegExp, n: number, f: (m: string) => string) => {
    let i = 0;
    return s.replace(re, m => (i++ === n ? f(m) : m));
  };
  const count = (s: string, re: RegExp) => (s.match(re) || []).length;

  // CONST: perturb numeric literals in conditions by ±10%
  const condRe = /(?<=[<>]=? )\d+(\.\d+)?/g;
  for (let k = 0; k < Math.min(4, count(body, condRe)); k++) {
    out.push({ op: 'CONST', code: head + replaceNth(body, condRe, k, m => String(+(Number(m) * 1.1).toFixed(4))) });
  }
  // ROR-invert / ROR-boundary on comparison operators inside conditions
  const rorRe = / (<=|>=|<|>) /g;
  const nRor = count(body.replace('t < n', ''), rorRe);
  for (let k = 1; k <= Math.min(6, nRor); k++) {
    out.push({ op: 'ROR-invert', code: head + replaceNth(body, rorRe, k, m => ({ ' < ': ' > ', ' > ': ' < ', ' <= ': ' >= ', ' >= ': ' <= ' } as Record<string, string>)[m]) });
    out.push({ op: 'ROR-boundary', code: head + replaceNth(body, rorRe, k, m => ({ ' < ': ' <= ', ' > ': ' >= ', ' <= ': ' < ', ' >= ': ' > ' } as Record<string, string>)[m]) });
  }
  // LCR: swap && / || (skip the t > 0 guard of crossovers)
  const lcrRe = /\) (&&|\|\|) \(/g;
  for (let k = 0; k < Math.min(3, count(body, lcrRe)); k++) {
    out.push({ op: 'LCR', code: head + replaceNth(body, lcrRe, k, m => (m.includes('&&') ? ') || (' : ') && (')) });
  }
  // LOOKAHEAD: i_x[t] → i_x[t + 1]  /  close[t] → close[t + 1] inside conditions
  const laRe = /(i_[a-z0-9_]+|close)\[t\]/g;
  for (let k = 0; k < Math.min(4, count(entryLine, laRe)); k++) {
    const newLine = replaceNth(entryLine, laRe, k, m => m.replace('[t]', '[t + 1]'));
    out.push({ op: 'LOOKAHEAD', code: head + body.replace(entryLine, newLine) });
  }
  // WINDOW: indicator period off by one
  const winRe = /L\.(sma|ema|rsi|bbUpper|bbMiddle|bbLower)\((\d+)/g;
  for (let k = 0; k < Math.min(3, count(head, winRe)); k++) {
    out.push({ op: 'WINDOW', code: replaceNth(head, winRe, k, m => m.replace(/\((\d+)/, (_, d) => `(${Number(d) + 1}`)) + body });
  }
  // STOP-SIGN: stop applied on the wrong side of the fill price
  if (/fill \* 0\.\d+/.test(body)) {
    out.push({ op: 'STOP-SIGN', code: head + body.replace(/fill \* (0\.\d+)/, (_, d) => `fill * ${+(2 - Number(d)).toFixed(6)}`) });
  }
  // CROSS→LEVEL: drop the previous-bar half of a crossover
  if (/t > 0 && /.test(body)) {
    out.push({ op: 'CROSS→LEVEL', code: head + body.replace(/t > 0 && [^&]+&& /, '') });
  }
  return out.filter(m => m.code !== code && guard(m.code).ok);
}

export interface MutationReport { total: number; killed: number; byOp: Record<string, { total: number; killed: number }> }

export function mutationSelfTest(ir: StrategyIR, probes: ProbeSeries[]): MutationReport {
  const code = generateCode(ir);
  const ms = mutants(code);
  const byOp: MutationReport['byOp'] = {};
  let killed = 0;
  const refs = probes.map(p => interpret(ir, p.bars).pos);
  for (const m of ms) {
    byOp[m.op] ??= { total: 0, killed: 0 };
    byOp[m.op].total++;
    let caught = false;
    try {
      const fn = compile(m.code);
      for (let i = 0; i < probes.length && !caught; i++) {
        const got = runCompiled(fn, probes[i].bars, makeLib(probes[i].bars));
        const ref = refs[i];
        for (let t = 0; t < ref.length; t++) if (ref[t] !== got[t]) { caught = true; break; }
      }
    } catch { caught = true; }
    if (caught) { killed++; byOp[m.op].killed++; }
  }
  return { total: ms.length, killed, byOp };
}
