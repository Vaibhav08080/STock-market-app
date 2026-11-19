'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, XCircle, ShieldCheck, FlaskConical, TrendingUp, AlertTriangle, Code2, ListTree, Layers3 } from 'lucide-react';
import type { PipelineResult } from '@/lib/strategy-lab/pipeline';
import type { StrategyIR } from '@/lib/strategy-lab/ir';
import type { Metrics } from '@/lib/strategy-lab/engine';
import { LineChart, type LineDef, type MarkerDef } from './LabCharts';

const mono: React.CSSProperties = { fontFamily: 'var(--font-geist-mono), monospace' };
const card: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' };
const cardHead: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '7px', padding: '9px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', fontSize: '11px', fontWeight: 700, color: 'var(--text)' };
const sub: React.CSSProperties = { fontSize: '10px', color: 'var(--text3)', fontWeight: 500, marginLeft: 'auto' };

const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '∞');
const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
const col = (v: number) => (v > 0 ? 'var(--gain)' : v < 0 ? 'var(--loss)' : 'var(--text2)');
type Tone = 'good' | 'warn' | 'bad';
const TONE: Record<Tone, { fg: string; border: string; bg: string }> = {
  good: { fg: 'var(--gain)', border: 'rgba(15,237,190,0.35)', bg: 'rgba(15,237,190,0.05)' },
  warn: { fg: 'var(--warn)', border: 'rgba(245,166,35,0.35)', bg: 'rgba(245,166,35,0.05)' },
  bad: { fg: 'var(--loss)', border: 'rgba(255,77,106,0.35)', bg: 'rgba(255,77,106,0.05)' },
};
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function Kpi({ label, value, sub: s, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px', padding: '9px 11px', minWidth: 0 }}>
      <div style={{ fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
      <div style={{ ...mono, fontSize: '16px', fontWeight: 700, color: color ?? 'var(--text)', marginTop: '3px' }}>{value}</div>
      {s && <div style={{ fontSize: '10px', color: 'var(--text3)', marginTop: '2px', ...mono }}>{s}</div>}
    </div>
  );
}

function MetricsGrid({ m, bh, tradeStats = true }: { m: Metrics; bh: Metrics; tradeStats?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '6px' }}>
      <Kpi label="Total return" value={pct(m.totalReturnPct)} color={col(m.totalReturnPct)} sub={`B&H ${pct(bh.totalReturnPct)}`} />
      <Kpi label="CAGR" value={pct(m.cagrPct)} color={col(m.cagrPct)} sub={`B&H ${pct(bh.cagrPct)}`} />
      <Kpi label="Sharpe" value={f2(m.sharpe)} color={col(m.sharpe)} sub={`B&H ${f2(bh.sharpe)}`} />
      <Kpi label="Max drawdown" value={`-${m.maxDrawdownPct.toFixed(1)}%`} color="var(--loss)" sub={`B&H -${bh.maxDrawdownPct.toFixed(1)}%`} />
      {tradeStats && <Kpi label="Trades" value={String(m.trades)} sub={`exposure ${m.exposurePct.toFixed(0)}%`} />}
      {tradeStats && <Kpi label="Win rate" value={`${m.winRatePct.toFixed(1)}%`} sub={`avg ${pct(m.avgTradePct, 2)}`} />}
      {tradeStats && <Kpi label="Profit factor" value={f2(m.profitFactor)} />}
      <Kpi label="Volatility" value={`${m.volPct.toFixed(1)}%`} sub={`B&H ${bh.volPct.toFixed(1)}%`} />
    </div>
  );
}

export function LabResults({ result, ir, symbol, capital }: { result: PipelineResult; ir: StrategyIR; symbol: string; capital: number }) {
  const [view, setView] = useState<'full' | 'oos'>(result.walkForward ? 'oos' : 'full');
  const [codeTab, setCodeTab] = useState<'code' | 'ir'>('code');
  const bt = result.backtest, wf = result.walkForward;

  const equityLines = useMemo<LineDef[]>(() => {
    if (view === 'oos' && wf) return [
      { name: 'Strategy (walk-forward OOS, tuned)', color: '#E8BA40', times: wf.oosTimes, values: wf.oosEquity },
      { name: 'Your parameters (same OOS dates)', color: '#FF8243', times: wf.oosTimes, values: wf.textbookOosEquity, width: 1 },
      { name: 'Buy & hold', color: '#9095A1', times: wf.oosTimes, values: wf.bhOosEquity, width: 1, dashed: true },
    ];
    if (!bt) return [];
    return [
      { name: 'Strategy (full sample, your parameters)', color: '#0FEDBE', times: bt.times, values: bt.equity },
      { name: 'Buy & hold', color: '#9095A1', times: bt.times, values: bt.bhEquity, width: 1, dashed: true },
    ];
  }, [view, wf, bt]);

  const priceLines = useMemo<LineDef[]>(() => (bt ? [{ name: `${symbol} close`, color: '#FDD458', times: bt.times, values: bt.closes, width: 1 }] : []), [bt, symbol]);
  const markers = useMemo<MarkerDef[]>(() => {
    if (!bt) return [];
    const ms: MarkerDef[] = [];
    bt.trades.slice(-150).forEach(t => { ms.push({ time: t.entryTime, kind: 'buy' }); if (t.reason !== 'open') ms.push({ time: t.exitTime, kind: 'sell' }); });
    return ms;
  }, [bt]);

  // ── verdict (paper §VII: report OOS, after costs, next to a passive benchmark) ──
  const verdict = (() => {
    if (!bt) return null;
    if (wf) {
      const beat = wf.oosSharpe > wf.bhOosSharpe;
      const overfit = wf.wfe < 0.5;
      const tone: Tone = wf.oosSharpe <= 0 || !beat ? 'bad' : overfit ? 'warn' : 'good';
      return {
        tone,
        title: wf.oosSharpe <= 0 ? 'No edge out of sample (OOS Sharpe ≤ 0)' : !beat ? 'Did NOT beat buy-and-hold out of sample' : overfit ? 'Beat buy-and-hold out of sample, but most of the in-sample edge decayed' : 'Beat buy-and-hold out of sample',
        text: `Walk-forward OOS Sharpe ${f2(wf.oosSharpe)} vs buy-and-hold ${f2(wf.bhOosSharpe)} on the same dates. Mean optimised in-sample Sharpe was ${f2(wf.meanIS)} → walk-forward efficiency ${f2(wf.wfe)}${overfit ? ' (below 0.5: most of the in-sample edge did not survive)' : ''}.${result.dsr ? ` Deflated Sharpe of the best full-sample variant: ${(result.dsr.dsr * 100).toFixed(1)}%${result.dsr.dsr < 0.95 ? ' (< 95%: not significant after accounting for the search)' : ''}.` : ''}`,
      };
    }
    const beat = bt.metrics.sharpe > bt.bh.sharpe && bt.metrics.sharpe > 0;
    return { tone: (beat ? 'warn' : 'bad') as Tone, title: beat ? 'Higher Sharpe than buy-and-hold (in-sample only)' : 'Lower Sharpe than buy-and-hold', text: 'Walk-forward validation is off, so this is an in-sample result only — treat it as optimistic.' };
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {verdict && (
        <div style={{ ...card, padding: '12px 14px', borderColor: TONE[verdict.tone].border, background: TONE[verdict.tone].bg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 700, color: TONE[verdict.tone].fg }}>
            {verdict.tone === 'good' ? <TrendingUp size={15} /> : <AlertTriangle size={15} />} {verdict.title}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text2)', marginTop: '5px', lineHeight: 1.6 }}>{verdict.text}</div>
        </div>
      )}

      {bt && (
        <div style={card}>
          <div style={cardHead}>
            <TrendingUp size={13} color="var(--teal)" /> Performance
            <span style={sub}>{date(bt.times[0])} → {date(bt.times[bt.times.length - 1])} · {bt.times.length} bars · costs included</span>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {wf && (
              <div className="tab-bar" style={{ alignSelf: 'flex-start' }}>
                <button className={`tab-btn ${view === 'oos' ? 'active' : ''}`} onClick={() => setView('oos')}>Walk-forward OOS</button>
                <button className={`tab-btn ${view === 'full' ? 'active' : ''}`} onClick={() => setView('full')}>Full sample (in-sample)</button>
              </div>
            )}
            {view === 'oos' && wf ? <MetricsGrid m={wf.oosMetrics} bh={wf.bhOosMetrics} tradeStats={false} /> : <MetricsGrid m={bt.metrics} bh={bt.bh} />}
            <LineChart lines={equityLines} height={260} logScale />
            <div style={{ fontSize: '10px', color: 'var(--text3)' }}>Equity in currency units, starting capital {capital.toLocaleString()} · log scale</div>
          </div>
        </div>
      )}

      {bt && (
        <div style={card}>
          <div style={cardHead}><Layers3 size={13} color="#FDD458" /> Signals on price <span style={sub}>green ▲ buy fill · red ▼ exit fill (last 150 trades)</span></div>
          <div style={{ padding: '10px 12px' }}><LineChart lines={priceLines} markers={markers} height={240} logScale /></div>
        </div>
      )}

      {wf && (
        <div style={card}>
          <div style={cardHead}><FlaskConical size={13} color="#FF8243" /> Walk-forward validation (TPE tuned inside each window)
            <span style={sub}>{wf.windows.length} windows · IS {wf.isLen} / OOS {wf.oosLen} bars · 40 trials each</span>
          </div>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' }}>
              <Kpi label="Mean IS Sharpe (optimised)" value={f2(wf.meanIS)} />
              <Kpi label="Stitched OOS Sharpe" value={f2(wf.oosSharpe)} color={col(wf.oosSharpe)} />
              <Kpi label="WFE = OOS / IS" value={f2(wf.wfe)} color={wf.wfe >= 0.5 ? 'var(--gain)' : 'var(--loss)'} />
              <Kpi label="Your params, OOS" value={f2(wf.textbookOosSharpe)} sub="no tuning" />
              <Kpi label="Buy & hold, OOS" value={f2(wf.bhOosSharpe)} />
              {result.dsr && <Kpi label="Full-sample best Sharpe" value={f2(result.dsr.bestSharpe)} sub={`${result.dsr.trials} trials`} />}
              {result.dsr && <Kpi label="Deflated Sharpe (DSR)" value={`${(result.dsr.dsr * 100).toFixed(1)}%`} color={result.dsr.dsr >= 0.95 ? 'var(--gain)' : 'var(--loss)'} sub={`SR₀ ${f2(result.dsr.SR0)} (ann.)`} />}
            </div>
            <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px' }}>
              <table className="data-table">
                <thead><tr><th>#</th><th>In-sample</th><th>Out-of-sample</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>Chosen params</th></tr></thead>
                <tbody>
                  {wf.windows.map((w, i) => (
                    <tr key={i}>
                      <td style={{ ...mono, fontSize: '11px', color: 'var(--text3)' }}>{i + 1}</td>
                      <td style={{ ...mono, fontSize: '10px', color: 'var(--text2)' }}>{date(w.isFrom)} → {date(w.isTo)}</td>
                      <td style={{ ...mono, fontSize: '10px', color: 'var(--text2)' }}>{date(w.oosFrom)} → {date(w.oosTo)}</td>
                      <td style={{ ...mono, fontSize: '11px', color: col(w.isSharpe) }}>{f2(w.isSharpe)}</td>
                      <td style={{ ...mono, fontSize: '11px', color: col(w.oosSharpe) }}>{f2(w.oosSharpe)}</td>
                      <td style={{ ...mono, fontSize: '10px', color: 'var(--text3)' }}>{Object.entries(w.params).map(([k, v]) => `${k}=${+v.toFixed(2)}`).join('  ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {result.regimes && (
        <div style={card}>
          <div style={cardHead}><Layers3 size={13} color="#FDD458" /> Regime attribution <span style={sub}>volatility terciles ({wf ? 'OOS dates' : 'full sample'}) — attribution only, never a trading input</span></div>
          <table className="data-table">
            <thead><tr><th>Regime</th><th>Share of bars</th><th>Strategy Sharpe</th><th>Buy & hold Sharpe</th></tr></thead>
            <tbody>
              {result.regimes.map(r => (
                <tr key={r.regime}>
                  <td style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', textTransform: 'capitalize' }}>{r.regime} volatility</td>
                  <td style={{ ...mono, fontSize: '11px', color: 'var(--text2)' }}>{r.share.toFixed(1)}%</td>
                  <td style={{ ...mono, fontSize: '11px', color: col(r.strategySharpe) }}>{f2(r.strategySharpe)}</td>
                  <td style={{ ...mono, fontSize: '11px', color: col(r.bhSharpe) }}>{f2(r.bhSharpe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={card}>
        <div style={cardHead}><ShieldCheck size={13} color="var(--gain)" /> Behavioural verification
          <span style={sub}>coverage {result.probes.covered.length}/{result.probes.possible.length} goals · generated code vs independent IR interpreter</span>
        </div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
            {result.probes.outcomes.map(o => (
              <span key={o.id} className={o.match ? 'pill-gain' : 'pill-loss'} style={{ fontSize: '10px' }} title={o.firstDivergence ? `first divergence at bar ${o.firstDivergence.index}` : `${o.bars} bars, ${o.entries} entries`}>
                {o.match ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {o.id} · {o.entries} entries
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {result.probes.possible.map(g => (
              <span key={g} className={result.probes.covered.includes(g) ? 'pill-brand' : 'pill-neutral'} style={{ fontSize: '9px', ...mono }}>{g}</span>
            ))}
          </div>
          {result.mutation && (
            <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
              <b style={{ color: 'var(--text)' }}>Mutation self-test:</b> {result.mutation.killed}/{result.mutation.total} seeded faults caught by the check
              <span style={{ color: 'var(--text3)' }}> ({Object.entries(result.mutation.byOp).map(([k, v]) => `${k} ${v.killed}/${v.total}`).join(' · ')}). Uncaught &lt;→≤ swaps are usually equivalent mutants.</span>
            </div>
          )}
        </div>
      </div>

      <div style={card}>
        <div style={cardHead}>
          <Code2 size={13} color="#FDD458" /> Compiled artefacts
          <div className="tab-bar" style={{ marginLeft: 'auto' }}>
            <button className={`tab-btn ${codeTab === 'code' ? 'active' : ''}`} onClick={() => setCodeTab('code')}><Code2 size={10} /> Generated code</button>
            <button className={`tab-btn ${codeTab === 'ir' ? 'active' : ''}`} onClick={() => setCodeTab('ir')}><ListTree size={10} /> Typed IR</button>
          </div>
        </div>
        <pre style={{ ...mono, margin: 0, padding: '12px', fontSize: '11px', lineHeight: 1.6, color: 'var(--text2)', background: 'var(--bg)', maxHeight: '320px', overflow: 'auto' }}>
          {codeTab === 'code' ? result.code : JSON.stringify(ir, null, 2)}
        </pre>
      </div>

      {bt && (
        <div style={card}>
          <div style={cardHead}>Trades <span className="pill-neutral" style={{ fontSize: '10px' }}>{bt.trades.length}</span><span style={sub}>full sample, your parameters, net of costs</span></div>
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Entry</th><th>Exit</th><th>Entry px</th><th>Exit px</th><th>Bars</th><th>Return</th><th>Exit reason</th></tr></thead>
              <tbody>
                {bt.trades.slice().reverse().map((t, i) => (
                  <tr key={i}>
                    <td style={{ ...mono, fontSize: '11px', color: 'var(--text2)' }}>{date(t.entryTime)}</td>
                    <td style={{ ...mono, fontSize: '11px', color: 'var(--text2)' }}>{t.reason === 'open' ? 'open' : date(t.exitTime)}</td>
                    <td style={{ ...mono, fontSize: '11px' }}>{t.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={{ ...mono, fontSize: '11px' }}>{t.exitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={{ ...mono, fontSize: '11px', color: 'var(--text3)' }}>{t.bars}</td>
                    <td style={{ ...mono, fontSize: '11px', fontWeight: 700, color: col(t.retPct) }}>{pct(t.retPct, 2)}</td>
                    <td><span className={t.reason === 'stop' ? 'pill-loss' : t.reason === 'take_profit' ? 'pill-gain' : 'pill-neutral'} style={{ fontSize: '10px' }}>{t.reason.replace('_', ' ')}</span></td>
                  </tr>
                ))}
                {!bt.trades.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '18px', color: 'var(--text3)', fontSize: '11px' }}>The rule never triggered on this data.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
