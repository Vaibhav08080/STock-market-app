// ─────────────────────────────────────────────────────────────────────────────
// Coverage-guided probe series  — QuantForge Pro §IV.D (MC/DC-style selection)
// Pool of 48 synthetic series from six generators; greedy pick of the 8 that
// cover the most goals (entry/exit/stop events + each decisive predicate T/F).
// ─────────────────────────────────────────────────────────────────────────────
import type { Cond, StrategyIR } from './ir';
import { atomicPredicates } from './ir';
import type { Bars } from './indicators';
import { buildEnv, evalCond, interpret } from './interpreter';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export type GenName = 'random_walk' | 'mean_reverting' | 'regime_switching' | 'cyclical' | 'jump' | 'piecewise_trend';
export const GENERATORS: GenName[] = ['random_walk', 'mean_reverting', 'regime_switching', 'cyclical', 'jump', 'piecewise_trend'];

export interface ProbeSeries { id: string; kind: 'synthetic' | 'historical'; gen?: GenName; bars: Bars }

/** Generates log-returns for a given process, then builds OHLC bars. */
export function synth(gen: GenName, seed: number, n = 700): Bars {
  const r = mulberry32(seed);
  const rets: number[] = [];
  const mu = 0.0004, sig = 0.015;
  let regime = 0, level = 0;
  const period = 40 + Math.floor(r() * 120), amp = 0.08 + r() * 0.2;
  let trend = (r() - 0.5) * 0.004, nextBreak = 60 + Math.floor(r() * 150);
  for (let t = 0; t < n; t++) {
    let x = 0;
    switch (gen) {
      case 'random_walk': x = mu + sig * gauss(r); break;
      case 'mean_reverting': { // OU on log price
        const th = 0.05 + r() * 0.02;
        x = -th * level + sig * gauss(r); level += x; break;
      }
      case 'regime_switching': {
        if (r() < 0.02) regime = 1 - regime;
        x = regime === 0 ? 0.001 + 0.009 * gauss(r) : -0.0015 + 0.03 * gauss(r); break;
      }
      case 'cyclical': {
        const target = amp * Math.sin((2 * Math.PI * t) / period);
        x = (target - level) + 0.006 * gauss(r); level += x; break;
      }
      case 'jump': {
        x = 0.0003 + 0.01 * gauss(r);
        if (r() < 0.015) x += (r() < 0.5 ? -1 : 1) * (0.06 + r() * 0.12);
        break;
      }
      case 'piecewise_trend': {
        if (t >= nextBreak) { trend = (r() - 0.5) * 0.008; nextBreak = t + 40 + Math.floor(r() * 160); }
        x = trend + 0.012 * gauss(r); break;
      }
    }
    rets.push(Math.max(-0.4, Math.min(0.4, x)));
  }
  const time: number[] = [], open = new Float64Array(n), high = new Float64Array(n), low = new Float64Array(n), close = new Float64Array(n);
  let c = 100;
  const t0 = Date.UTC(2010, 0, 1) / 1000;
  for (let t = 0; t < n; t++) {
    const o = c * Math.exp(0.002 * gauss(r));
    c = c * Math.exp(rets[t]);
    const hi = Math.max(o, c) * (1 + Math.abs(0.006 * gauss(r)));
    const lo = Math.min(o, c) * (1 - Math.abs(0.006 * gauss(r)));
    time.push(t0 + t * 86400); open[t] = o; high[t] = hi; low[t] = lo; close[t] = c;
  }
  return { time, open, high, low, close };
}

// ─── Coverage goals ─────────────────────────────────────────────────────────
export function coverageGoals(ir: StrategyIR, bars: Bars): Set<string> {
  const goals = new Set<string>();
  const n = bars.close.length;
  const tr = interpret(ir, bars);
  if (tr.entryEvt.some(v => v)) goals.add('event:entry');
  if (tr.exitEvt.some(v => v)) goals.add('event:exit');
  if (tr.stopEvt.some(v => v)) goals.add('event:stop');
  if (tr.tpEvt.some(v => v)) goals.add('event:take_profit');

  const env = buildEnv(ir, bars);
  const scan = (root: Cond, tag: 'E' | 'X', stateWanted: number) => {
    atomicPredicates(root).forEach((a, i) => {
      const forcedT = evalCond(root, env, n, { node: a, value: true });
      const forcedF = evalCond(root, env, n, { node: a, value: false });
      const actual = evalCond(a, env, n);
      for (let t = 1; t < n; t++) {
        const state = tr.pos[t - 1];
        if (state !== stateWanted) continue;
        if (forcedT[t] !== forcedF[t]) goals.add(`${tag}${i}:${actual[t] ? 'T' : 'F'}`);
      }
    });
  };
  scan(ir.entry, 'E', 0);
  if (ir.exit) scan(ir.exit, 'X', 1);
  return goals;
}

export function allPossibleGoals(ir: StrategyIR): string[] {
  const g = ['event:entry'];
  if (ir.exit) g.push('event:exit');
  if (ir.stop_loss_pct !== null) g.push('event:stop');
  if (ir.take_profit_pct !== null) g.push('event:take_profit');
  atomicPredicates(ir.entry).forEach((_, i) => g.push(`E${i}:T`, `E${i}:F`));
  if (ir.exit) atomicPredicates(ir.exit).forEach((_, i) => g.push(`X${i}:T`, `X${i}:F`));
  return g;
}

export function syntheticPool(size = 48, seedBase = 1234): ProbeSeries[] {
  const pool: ProbeSeries[] = [];
  for (let i = 0; i < size; i++) {
    const gen = GENERATORS[i % GENERATORS.length];
    pool.push({ id: `${gen}#${Math.floor(i / GENERATORS.length)}`, kind: 'synthetic', gen, bars: synth(gen, seedBase + i * 7919) });
  }
  return pool;
}

/** Greedy max-coverage selection of k probes from the pool. */
export function selectProbes(ir: StrategyIR, pool: ProbeSeries[], k = 8) {
  const covs = pool.map(p => coverageGoals(ir, p.bars));
  const chosen: number[] = [];
  const covered = new Set<string>();
  for (let step = 0; step < k; step++) {
    let best = -1, bestGain = -1;
    for (let i = 0; i < pool.length; i++) {
      if (chosen.includes(i)) continue;
      let gain = 0;
      covs[i].forEach(g => { if (!covered.has(g)) gain++; });
      // tie-break: more goals overall (exercise more behaviour)
      const score = gain * 1000 + covs[i].size;
      if (score > bestGain) { bestGain = score; best = i; }
    }
    if (best < 0) break;
    chosen.push(best);
    covs[best].forEach(g => covered.add(g));
  }
  return { probes: chosen.map(i => pool[i]), covered, possible: allPossibleGoals(ir) };
}
