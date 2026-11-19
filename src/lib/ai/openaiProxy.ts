// Server-side OpenAI proxy (shared by the Vite dev server and the Vercel function).
// The API key lives ONLY on the server (OPENAI_API_KEY) — it is never sent to the browser.
//
//   GET  /api/openai  → { configured, model }
//   POST /api/openai  → { content }   body: { messages, json?, temperature?, maxTokens? }

export interface ProxyConfig {
  apiKey: string;
  model: string;
  baseUrl?: string; // optional override (e.g. a local mock for tests)
}

export interface ProxyResult { status: number; body: unknown }

const ROLES = new Set(['system', 'user', 'assistant']);
const MAX_MESSAGES = 40;
const MAX_CHARS = 40_000;
const MAX_TOKENS = 1000;

// best-effort per-IP rate limit (per server instance)
const RATE_LIMIT = 30;           // requests
const RATE_WINDOW_MS = 60_000;   // per minute
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_LIMIT;
}

const err = (status: number, message: string): ProxyResult => ({ status, body: { error: { message } } });

export function configFromEnv(env: Record<string, string | undefined>): ProxyConfig {
  return {
    // VITE_* names are accepted for backwards compatibility; prefer the plain names.
    apiKey: (env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY || '').trim(),
    model: (env.OPENAI_MODEL || env.VITE_OPENAI_MODEL || '').trim() || 'gpt-4.1-mini',
    baseUrl: (env.OPENAI_BASE_URL || '').trim() || undefined,
  };
}

export async function proxyOpenAI(method: string, rawBody: string, cfg: ProxyConfig, ip = 'unknown'): Promise<ProxyResult> {
  if (method === 'GET') return { status: 200, body: { configured: cfg.apiKey.length > 0, model: cfg.model } };
  if (method !== 'POST') return err(405, 'Method not allowed');
  if (!cfg.apiKey) return err(503, 'Server has no OPENAI_API_KEY configured.');
  if (rateLimited(ip)) return err(429, 'Too many requests — slow down (30/min).');

  let body: Record<string, unknown>;
  try { body = JSON.parse(rawBody || '{}'); } catch { return err(400, 'Body must be JSON.'); }

  const msgs = body.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || msgs.length > MAX_MESSAGES) return err(400, `messages must be an array of 1–${MAX_MESSAGES} items.`);
  let chars = 0;
  const messages: { role: string; content: string }[] = [];
  for (const m of msgs) {
    if (!m || typeof m !== 'object') return err(400, 'Invalid message.');
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (typeof role !== 'string' || !ROLES.has(role) || typeof content !== 'string') return err(400, 'Each message needs role (system|user|assistant) and string content.');
    chars += content.length;
    messages.push({ role, content });
  }
  if (chars > MAX_CHARS) return err(413, 'Conversation too long.');

  const temperature = Math.min(1.5, Math.max(0, Number(body.temperature ?? 0) || 0));
  const maxTokens = Math.min(MAX_TOKENS, Math.max(16, Number(body.maxTokens ?? 800) || 800));

  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model, // the client cannot choose the model
        messages, temperature, max_tokens: maxTokens,
        ...(body.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return err(502, `Could not reach OpenAI: ${e instanceof Error ? e.message : 'network error'}`);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: { message?: { content?: string } }[] };
  if (!res.ok) return err(res.status, data?.error?.message || `OpenAI HTTP ${res.status}`);
  return { status: 200, body: { content: data?.choices?.[0]?.message?.content ?? '' } };
}
