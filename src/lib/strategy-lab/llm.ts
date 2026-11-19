// ─────────────────────────────────────────────────────────────────────────────
// LLM parser: natural language → typed IR (QuantForge Pro §IV.B, §VI.C)
// The LLM NEVER writes code. It only fills the JSON IR, which is then validated;
// on a validation error the messages are fed back once for a repair attempt.
// ─────────────────────────────────────────────────────────────────────────────
import { validateIR, type StrategyIR } from './ir';
import { localParse, type ParseOutput } from './localParser';
import { chatCompletion, getAIStatus, type ChatMessage } from '@/lib/openai';

// The key stays on the server (OPENAI_API_KEY) — see src/lib/openai.ts and server/openaiProxy.ts.

const SYSTEM_PROMPT = `You are the strategy compiler of a backtesting platform (QuantForge Pro).
You translate a user's plain-English trading idea into a typed JSON intermediate representation (IR).
You NEVER write code. You only output one JSON object with this exact shape:

{
  "reply": string,                 // 1-3 short sentences to the user (friendly, plain English; you may use Hinglish if the user does)
  "status": "ok" | "clarify" | "chat",
  "ir": IR | null,                 // required when status = "ok"
  "symbol": { "symbol": string, "market": "crypto" | "us_stock" | "india_stock" } | null,
  "interval": "1d" | "4h" | "1h" | "1w" | null
}

IR = {
  "indicators": [ { "name": string, "type": IndicatorType, "params": object } ],
  "entry": Cond,
  "exit": Cond | null,
  "stop_loss_pct": number | null,     // percent below entry fill, e.g. 5
  "take_profit_pct": number | null,   // percent above entry fill, e.g. 10
  "assumptions": string[]             // every default you had to choose
}
IndicatorType and params:
  "SMA" {period} | "EMA" {period} | "RSI" {period}
  "MACD" {fast, slow} | "MACD_SIGNAL" {fast, slow, signal} | "MACD_HIST" {fast, slow, signal}
  "BB_UPPER" {period, std} | "BB_MIDDLE" {period, std} | "BB_LOWER" {period, std}
Cond =
  { "op": "and" | "or", "args": [Cond, ...] }
| { "op": "lt" | "gt" | "le" | "ge" | "cross_above" | "cross_below", "left": Operand, "right": Operand }
Operand = { "kind": "ref", "ref": "close" | "open" | "high" | "low" | <indicator name> } | { "kind": "const", "value": number }

Rules:
- Names: lowercase letters/digits/underscore, start with a letter (e.g. "rsi14", "ema200").
- Only long-only, single-asset, bar-based rules. Signals are evaluated at bar close and filled next open.
- Never compare two constants. Left side of a crossover must be a series. MACD fast < slow.
- "crosses 70" for RSI means cross_above when the level is above 50, cross_below otherwise.
- Vague wording → documented defaults, and list each in "assumptions":
  oversold = RSI(14) < 30; overbought = RSI(14) > 70; uptrend = close > EMA(200); downtrend = close < EMA(200);
  golden cross = SMA(50) cross_above SMA(200); death cross = SMA(50) cross_below SMA(200);
  MACD defaults 12/26/9; Bollinger defaults 20 / 2.0; RSI default period 14.
- If no exit is given: RSI entries → exit when RSI cross_above 70; crossover entries → opposite crossover;
  lower-band entries → close > middle band. State that in assumptions.
- Short selling, options, multi-asset, fundamentals, news or ML signals are NOT supported:
  set status "clarify" and explain briefly what can be tested instead.
- If the user only chats or asks a question, use status "chat" with ir null.
- If the user edits a previous strategy ("make RSI 25", "add a 3% stop"), start from CURRENT_IR and return the full updated IR.
- symbol: fill only if the user names an instrument (BTC/ETH → crypto, NSE names like RELIANCE/TCS/NIFTY → india_stock, US tickers → us_stock).`;

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface LLMResult extends ParseOutput {
  status: 'ok' | 'clarify' | 'chat';
  validated?: StrategyIR;
  errors?: string[];
  usedLLM: boolean;
}

async function callOpenAI(messages: ChatMessage[]): Promise<Record<string, unknown>> {
  const txt = await chatCompletion(messages, { json: true, temperature: 0 });
  try { return JSON.parse(txt || '{}'); }
  catch { throw new Error('The model returned malformed JSON — try rephrasing.'); }
}

export async function parseStrategy(history: ChatTurn[], userText: string, currentIR: StrategyIR | null): Promise<LLMResult> {
  if (!(await getAIStatus()).configured) {
    const o = localParse(userText);
    const v = o.ir ? validateIR(o.ir) : null;
    return { ...o, status: v?.ok ? 'ok' : o.ir ? 'clarify' : 'chat', validated: v?.ir, errors: v && !v.ok ? v.errors : undefined, usedLLM: false };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-8).map(h => ({ role: h.role, content: h.text }) as ChatMessage),
    { role: 'user', content: `${currentIR ? `CURRENT_IR: ${JSON.stringify(currentIR)}\n\n` : ''}${userText}` },
  ];

  let out = await callOpenAI(messages);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (out.status !== 'ok' || !out.ir) break;
    const v = validateIR(out.ir);
    if (v.ok) {
      return { reply: String(out.reply ?? ''), status: 'ok', ir: out.ir, validated: v.ir, symbol: (out.symbol as LLMResult['symbol']) ?? null, interval: (out.interval as string) ?? null, usedLLM: true };
    }
    if (attempt === 1) {
      return { reply: String(out.reply ?? ''), status: 'clarify', ir: out.ir, errors: v.errors, symbol: (out.symbol as LLMResult['symbol']) ?? null, interval: (out.interval as string) ?? null, usedLLM: true };
    }
    // one repair round with the validator's actionable messages
    messages.push({ role: 'assistant', content: JSON.stringify(out) });
    messages.push({ role: 'user', content: `The IR failed validation:\n- ${v.errors.join('\n- ')}\nReturn the corrected full JSON object.` });
    out = await callOpenAI(messages);
  }
  return {
    reply: String(out.reply ?? ''), status: (out.status as LLMResult['status']) ?? 'chat', ir: null,
    symbol: (out.symbol as LLMResult['symbol']) ?? null, interval: (out.interval as string) ?? null, usedLLM: true,
  };
}
