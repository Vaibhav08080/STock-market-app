'use client';

// ─────────────────────────────────────────────────────────────────────────────
// AI Strategy Lab — chat → typed IR → verified code → walk-forward backtest
// Implementation of "QuantForge Pro: Behaviourally Verified Natural-Language
// Strategy Compilation and Overfitting-Aware Backtesting" inside TradersCasa.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send, Bot, User, Sparkles, Play, Upload, CheckCircle2, XCircle, Loader2, Circle, MinusCircle,
  Database, KeyRound, RotateCcw,
} from 'lucide-react';
import { paraphraseIR, type StrategyIR } from '@/lib/strategy-lab/ir';
import { parseStrategy, type ChatTurn } from '@/lib/strategy-lab/llm';
import { useAIStatus } from '@/lib/openai';
import { loadBinance, loadYahoo, parseCSV, resolveSymbol, type DataSource, type Dataset } from '@/lib/strategy-lab/data';
import type { PipelineInput, PipelineResult, StageEvent, StageId, StageStatus } from '@/lib/strategy-lab/pipeline';
import { LabResults } from './LabResults';

type Msg = {
  id: string; role: 'user' | 'assistant'; text: string; loading?: boolean;
  ir?: StrategyIR; errors?: string[]; usedLLM?: boolean;
};

type UIStage = StageId | 'data';
const STAGES: { id: UIStage; label: string }[] = [
  { id: 'data', label: 'Load data' },
  { id: 'validate', label: 'Validate IR' },
  { id: 'codegen', label: 'Generate code' },
  { id: 'guard', label: 'Guard' },
  { id: 'probes', label: 'Probes' },
  { id: 'verify', label: 'Behaviour check' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'walkforward', label: 'Walk-forward' },
  { id: 'dsr', label: 'Deflated Sharpe' },
  { id: 'regime', label: 'Regimes' },
  { id: 'mutation', label: 'Mutation test' },
];

const EXAMPLES = [
  'Buy RELIANCE when 14-day RSI drops below 30 and price is above the 200-day EMA; sell when RSI crosses 70 or after a 5% loss.',
  'BTC: buy when the 50 EMA crosses above the 200 EMA, sell on the opposite cross.',
  'Buy ETH when price closes below the lower Bollinger band, sell at the middle band, 3% stop loss.',
  'Buy AAPL when MACD crosses above its signal line while MACD is above zero; exit when it crosses below.',
];

const INTERVALS: Record<DataSource, string[]> = { binance: ['1d', '4h', '1h'], yahoo: ['1d', '1w'], csv: ['1d'] };
const QUICK: { label: string; source: DataSource; symbol: string }[] = [
  { label: 'BTC', source: 'binance', symbol: 'BTCUSDT' },
  { label: 'ETH', source: 'binance', symbol: 'ETHUSDT' },
  { label: 'RELIANCE', source: 'yahoo', symbol: 'RELIANCE.NS' },
  { label: 'NIFTY 50', source: 'yahoo', symbol: '^NSEI' },
  { label: 'AAPL', source: 'yahoo', symbol: 'AAPL' },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const mono: React.CSSProperties = { fontFamily: 'var(--font-geist-mono), monospace' };
const inputStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '6px',
  padding: '5px 9px', fontSize: '12px', color: 'var(--text)', outline: 'none',
};
const lbl: React.CSSProperties = { fontSize: '9px', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' };

function StageIcon({ s }: { s: StageStatus }) {
  if (s === 'done') return <CheckCircle2 size={12} color="var(--gain)" />;
  if (s === 'failed') return <XCircle size={12} color="var(--loss)" />;
  if (s === 'running') return <Loader2 size={12} color="#FDD458" style={{ animation: 'spin 1s linear infinite' }} />;
  if (s === 'skipped') return <MinusCircle size={12} color="var(--text3)" />;
  return <Circle size={12} color="var(--line)" />;
}

function IRCard({ ir, errors }: { ir?: StrategyIR; errors?: string[] }) {
  return (
    <div style={{ marginTop: '8px', padding: '9px 10px', borderRadius: '8px', background: 'var(--bg)', border: `1px solid ${errors?.length ? 'rgba(255,77,106,0.3)' : 'rgba(232,186,64,0.25)'}` }}>
      {ir && paraphraseIR(ir).map((l, i) => (
        <div key={i} style={{ fontSize: '12px', color: 'var(--text)', lineHeight: 1.6, display: 'flex', gap: '6px' }}>
          <span style={{ color: i === 0 ? 'var(--gain)' : 'var(--loss)', ...mono, fontSize: '10px', marginTop: '2px', flexShrink: 0, whiteSpace: 'nowrap' }}>{i === 0 ? 'IN ' : 'OUT'}</span>
          <span>{l}</span>
        </div>
      ))}
      {ir?.assumptions.length ? (
        <div style={{ marginTop: '6px', fontSize: '11px', color: '#FF8243', lineHeight: 1.5 }}>
          Assumed: {ir.assumptions.join(' · ')}
        </div>
      ) : null}
      {errors?.length ? (
        <div style={{ fontSize: '11px', color: 'var(--loss)', lineHeight: 1.6 }}>
          {errors.map((e, i) => <div key={i}>• {e}</div>)}
        </div>
      ) : null}
    </div>
  );
}

export function StrategyLab() {
  const [messages, setMessages] = useState<Msg[]>([{
    id: 'hello', role: 'assistant',
    text: `Describe a trading rule in plain English (Hinglish bhi chalega). I'll compile it to a typed IR, generate code deterministically, verify the code bar-by-bar against an independent interpreter, then backtest it with walk-forward validation, costs and a deflated Sharpe ratio.`,
  }]);
  const [input, setInput] = useState('');
  const ai = useAIStatus();
  const [thinking, setThinking] = useState(false);
  const [currentIR, setCurrentIR] = useState<StrategyIR | null>(null);

  const [source, setSource] = useState<DataSource>('binance');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setIntervalV] = useState('1d');
  const [costBps, setCostBps] = useState(15);
  const [capital, setCapital] = useState(100000);
  const [runWF, setRunWF] = useState(true);
  const [runMut, setRunMut] = useState(true);
  const [csv, setCsv] = useState<Dataset | null>(null);

  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<string, { status: StageStatus; detail?: string }>>({});
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [resultIR, setResultIR] = useState<StrategyIR | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [dataInfo, setDataInfo] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const cacheRef = useRef(new Map<string, Dataset>());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => () => workerRef.current?.terminate(), []);

  const setStage = (id: UIStage, status: StageStatus, detail?: string) =>
    setStages(p => ({ ...p, [id]: { status, detail } }));

  const loadData = useCallback(async (src: DataSource, sym: string, iv: string): Promise<Dataset> => {
    if (src === 'csv') {
      if (!csv) throw new Error('Upload a CSV file first (date, open, high, low, close).');
      return csv;
    }
    const key = `${src}:${sym}:${iv}`;
    const hit = cacheRef.current.get(key);
    if (hit) return hit;
    const ds = src === 'binance' ? await loadBinance(sym, iv) : await loadYahoo(sym, iv);
    cacheRef.current.set(key, ds);
    return ds;
  }, [csv]);

  const runBacktest = useCallback(async (ir: StrategyIR, opts?: { source?: DataSource; symbol?: string; interval?: string }) => {
    const src = opts?.source ?? source, sym = opts?.symbol ?? symbol, iv = opts?.interval ?? interval;
    workerRef.current?.terminate();
    setRunning(true); setRunError(null); setResult(null); setStages({});
    setStage('data', 'running', `${sym} ${iv}`);
    let ds: Dataset;
    try {
      ds = await loadData(src, sym, iv);
      const from = new Date(ds.bars.time[0] * 1000).toISOString().slice(0, 10);
      const to = new Date(ds.bars.time[ds.bars.time.length - 1] * 1000).toISOString().slice(0, 10);
      const info = `${ds.symbol} · ${ds.bars.close.length} bars · ${from} → ${to}${ds.note ? ` · ${ds.note}` : ''}`;
      setDataInfo(info);
      setStage('data', 'done', `${ds.bars.close.length} bars`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStage('data', 'failed', msg); setRunError(msg); setRunning(false);
      return;
    }

    const w = new Worker(new URL('../../lib/strategy-lab/worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;
    const timeout = window.setTimeout(() => {
      w.terminate();
      setRunError('Sandbox time limit (120 s) reached — the run was stopped. Try fewer bars or turn off walk-forward.');
      setRunning(false);
    }, 120_000);
    w.onmessage = (e: MessageEvent<{ type: 'stage'; ev: StageEvent } | { type: 'result'; result: PipelineResult } | { type: 'error'; error: string }>) => {
      const d = e.data;
      if (d.type === 'stage') setStage(d.ev.stage, d.ev.status, d.ev.detail);
      else {
        window.clearTimeout(timeout);
        if (d.type === 'result') {
          setResult(d.result); setResultIR(ir);
          if (!d.result.ok) setRunError(d.result.error ?? 'Pipeline failed');
        } else setRunError(d.error);
        setRunning(false);
        w.terminate();
      }
    };
    w.onerror = ev => { window.clearTimeout(timeout); setRunError(ev.message || 'Worker crashed'); setRunning(false); };
    const payload: PipelineInput = {
      ir, bars: ds.bars, symbol: ds.symbol, interval: ds.interval, ppy: ds.ppy,
      costBps, initialCapital: capital, runWalkForward: runWF, runMutation: runMut,
    };
    w.postMessage(payload);
  }, [source, symbol, interval, costBps, capital, runWF, runMut, loadData]);

  const send = useCallback(async (txt?: string) => {
    const text = (txt ?? input).trim();
    if (!text || thinking) return;
    setInput('');
    const userMsg: Msg = { id: uid(), role: 'user', text };
    const loadId = uid();
    setMessages(p => [...p, userMsg, { id: loadId, role: 'assistant', text: '', loading: true }]);
    setThinking(true);
    const history: ChatTurn[] = messages.filter(m => !m.loading && m.id !== 'hello').map(m => ({
      role: m.role, text: m.ir ? `${m.text}\n[IR] ${JSON.stringify(m.ir)}` : m.text,
    }));
    try {
      const res = await parseStrategy(history, text, currentIR);
      let src = source, sym = symbol, iv = interval;
      if (res.symbol?.symbol) {
        const r = resolveSymbol(res.symbol);
        src = r.source; sym = r.symbol;
        setSource(src); setSymbol(sym);
        if (!INTERVALS[src].includes(iv)) { iv = '1d'; setIntervalV(iv); }
      }
      if (res.interval && INTERVALS[src].includes(res.interval)) { iv = res.interval; setIntervalV(iv); }
      const reply = res.reply || (res.validated ? 'Compiled your strategy:' : 'Hmm, I need a bit more detail.');
      setMessages(p => [...p.filter(m => m.id !== loadId), {
        id: uid(), role: 'assistant', usedLLM: res.usedLLM,
        text: res.validated ? `${reply}\n\nRunning on ${sym} (${iv})…` : reply,
        ir: res.validated, errors: res.errors,
      }]);
      if (res.validated) {
        setCurrentIR(res.validated);
        runBacktest(res.validated, { source: src, symbol: sym, interval: iv });
      }
    } catch (e) {
      setMessages(p => [...p.filter(m => m.id !== loadId), { id: uid(), role: 'assistant', text: `Parser error: ${e instanceof Error ? e.message : String(e)}` }]);
    } finally { setThinking(false); }
  }, [input, thinking, messages, currentIR, source, symbol, interval, runBacktest]);

  const onCsv = async (f: File) => {
    try {
      const ds = parseCSV(await f.text(), f.name);
      setCsv(ds); setSource('csv'); setSymbol(ds.symbol); setIntervalV('1d');
      setDataInfo(`${ds.symbol} · ${ds.bars.close.length} bars loaded from CSV${ds.note ? ` · ${ds.note}` : ''}`);
    } catch (e) { setRunError(e instanceof Error ? e.message : String(e)); }
  };

  const resetChat = () => {
    setMessages(m => m.slice(0, 1)); setCurrentIR(null); setResult(null); setStages({}); setRunError(null);
  };

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      {/* ═════ Chat column ═════ */}
      <div style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg2)' }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '9px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'linear-gradient(180deg,#FDD458,#E8BA40)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={15} color="#0b0b0b" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>Strategy Copilot</div>
            <div style={{ fontSize: '10px', color: ai === null ? 'var(--text3)' : ai.configured ? 'var(--teal)' : '#FF8243', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {ai === null ? <>Checking AI…</> : ai.configured ? <>OpenAI · {ai.model} → typed IR</> : <><KeyRound size={10} /> Offline parser · {ai.reachable ? 'set OPENAI_API_KEY in .env.local' : 'AI endpoint offline'}</>}
            </div>
          </div>
          <button className="btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={resetChat} title="New strategy"><RotateCcw size={11} /> New</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {messages.map(m => {
            const isUser = m.role === 'user';
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: '8px', padding: '0 12px', alignItems: 'flex-start' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isUser ? 'rgba(232,186,64,0.25)' : 'rgba(15,237,190,0.2)', border: `1px solid ${isUser ? 'rgba(232,186,64,0.4)' : 'rgba(15,237,190,0.35)'}` }}>
                  {isUser ? <User size={12} color="#FDD458" /> : <Bot size={12} color="#0FEDBE" />}
                </div>
                <div style={{ maxWidth: '84%', padding: '9px 12px', fontSize: '12.5px', lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: isUser ? '12px 4px 12px 12px' : '4px 12px 12px 12px', background: isUser ? 'rgba(232,186,64,0.18)' : 'var(--bg3)', border: `1px solid ${isUser ? 'rgba(232,186,64,0.25)' : 'var(--border)'}` }}>
                  {m.loading ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text3)', fontSize: '11px' }}>
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Compiling to IR…
                    </span>
                  ) : m.text}
                  {(m.ir || m.errors?.length) && <IRCard ir={m.ir} errors={m.errors} />}
                  {m.ir && (
                    <button className="btn-ghost" style={{ marginTop: '7px', padding: '3px 9px', fontSize: '11px' }} disabled={running} onClick={() => { setCurrentIR(m.ir!); runBacktest(m.ir!); }}>
                      <Play size={10} /> Re-run with current data settings
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {messages.length <= 1 && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={lbl}>Try one</div>
            {EXAMPLES.map(q => (
              <button key={q} onClick={() => send(q)} style={{ textAlign: 'left', padding: '6px 9px', borderRadius: '6px', cursor: 'pointer', background: 'var(--bg3)', border: '1px solid var(--border)', fontSize: '11px', color: 'var(--text2)', lineHeight: 1.45 }}
                onMouseOver={e => { e.currentTarget.style.borderColor = 'rgba(232,186,64,0.4)'; e.currentTarget.style.color = 'var(--text)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text2)'; }}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={currentIR ? 'Refine it… e.g. "make the stop 3%" or describe a new rule' : 'Describe your strategy…'}
            rows={2}
            style={{ ...inputStyle, flex: 1, resize: 'none', borderRadius: '10px', padding: '8px 11px', fontSize: '12.5px', lineHeight: 1.5, fontFamily: 'var(--font-geist-sans), sans-serif' }}
          />
          <button onClick={() => send()} disabled={!input.trim() || thinking}
            style={{ width: '36px', height: '36px', borderRadius: '50%', border: 'none', flexShrink: 0, cursor: input.trim() && !thinking ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', background: input.trim() && !thinking ? 'linear-gradient(180deg,#FDD458,#E8BA40)' : 'var(--bg3)' }}>
            <Send size={14} color={input.trim() && !thinking ? '#0b0b0b' : 'var(--text3)'} />
          </button>
        </div>
      </div>

      {/* ═════ Results column ═════ */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Data & settings */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
          <div>
            <div style={lbl}>Source</div>
            <div className="tab-bar">
              {([['binance', 'Crypto'], ['yahoo', 'Stocks'], ['csv', 'CSV']] as const).map(([k, l]) => (
                <button key={k} className={`tab-btn ${source === k ? 'active' : ''}`} onClick={() => { setSource(k); if (!INTERVALS[k].includes(interval)) setIntervalV('1d'); if (k === 'csv' && !csv) fileRef.current?.click(); }}>{l}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={lbl}>Symbol</div>
            {source === 'csv' ? (
              <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: '11px' }} onClick={() => fileRef.current?.click()}><Upload size={11} /> {csv ? csv.symbol : 'Upload CSV'}</button>
            ) : (
              <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} style={{ ...inputStyle, width: '130px', ...mono, fontWeight: 700 }} placeholder={source === 'binance' ? 'BTCUSDT' : 'RELIANCE.NS'} />
            )}
            <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onCsv(f); e.target.value = ''; }} />
          </div>
          <div>
            <div style={lbl}>Interval</div>
            <div className="tab-bar">
              {INTERVALS[source].map(iv => <button key={iv} className={`tab-btn ${interval === iv ? 'active' : ''}`} onClick={() => setIntervalV(iv)}>{iv}</button>)}
            </div>
          </div>
          <div>
            <div style={lbl}>Cost / side (bps)</div>
            <input type="number" min={0} max={200} value={costBps} onChange={e => setCostBps(Math.max(0, Number(e.target.value)))} style={{ ...inputStyle, width: '80px', ...mono }} />
          </div>
          <div>
            <div style={lbl}>Capital</div>
            <input type="number" min={100} value={capital} onChange={e => setCapital(Math.max(100, Number(e.target.value)))} style={{ ...inputStyle, width: '110px', ...mono }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={runWF} onChange={e => setRunWF(e.target.checked)} /> Walk-forward + DSR
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={runMut} onChange={e => setRunMut(e.target.checked)} /> Mutation self-test
          </label>
          <button className="btn-primary" style={{ marginLeft: 'auto', padding: '7px 16px' }} disabled={!currentIR || running} onClick={() => currentIR && runBacktest(currentIR)}>
            {running ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={12} />} {running ? 'Running…' : 'Run backtest'}
          </button>
          <div style={{ flexBasis: '100%', display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: 'var(--text3)' }}>Quick:</span>
            {QUICK.map(q => (
              <button key={q.label} onClick={() => { setSource(q.source); setSymbol(q.symbol); if (!INTERVALS[q.source].includes(interval)) setIntervalV('1d'); }}
                style={{ padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', background: symbol === q.symbol ? 'rgba(232,186,64,0.15)' : 'var(--bg3)', border: '1px solid var(--border)', color: symbol === q.symbol ? '#FDD458' : 'var(--text2)', fontSize: '10px', fontWeight: 600, ...mono }}>
                {q.label}
              </button>
            ))}
            {dataInfo && <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Database size={10} /> {dataInfo}</span>}
          </div>
        </div>

        {/* Pipeline stepper */}
        {Object.keys(stages).length > 0 && (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '9px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
            {STAGES.map(s => {
              const st = stages[s.id]?.status ?? 'pending';
              return (
                <div key={s.id} title={stages[s.id]?.detail} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: st === 'pending' ? 'var(--text3)' : st === 'failed' ? 'var(--loss)' : 'var(--text)' }}>
                  <StageIcon s={st} /> {s.label}
                  {stages[s.id]?.detail && st !== 'pending' && <span style={{ fontSize: '10px', color: 'var(--text3)', ...mono }}>· {stages[s.id]!.detail!.slice(0, 48)}</span>}
                </div>
              );
            })}
          </div>
        )}

        {runError && (
          <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(255,77,106,0.06)', border: '1px solid rgba(255,77,106,0.3)', color: 'var(--loss)', fontSize: '12px', lineHeight: 1.6 }}>
            {runError}
          </div>
        )}

        {result?.ok && resultIR && <LabResults result={result} ir={resultIR} symbol={symbol} capital={capital} />}

        {!result && !running && !runError && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '360px' }}>
            <div style={{ textAlign: 'center', maxWidth: '460px' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <Sparkles size={22} color="var(--text3)" />
              </div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)', marginBottom: '6px' }}>Describe → verify → backtest</div>
              <div style={{ fontSize: '12px', color: 'var(--text3)', lineHeight: 1.7 }}>
                The LLM only writes a typed IR. Code is generated from fixed templates, screened by a guard, and admitted only if it matches an independent interpreter on coverage-guided probe series. Results are reported out-of-sample, after {costBps} bps costs, next to buy-and-hold.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
