'use client';

// Shared OpenAI client for the whole app (StockAI chat + AI Strategy Lab).
//
// The browser NEVER sees the API key. It calls our own endpoint `/api/openai`:
//   • local dev / preview → served by the Vite plugin in vite.config.ts
//   • Vercel             → the Edge Function in api/openai.ts
// Both read OPENAI_API_KEY (+ optional OPENAI_MODEL) on the server:
//   local:  .env.local  (git-ignored)      Vercel: Project → Settings → Environment Variables
import { useEffect, useState } from 'react';

const ENDPOINT = '/api/openai';

export interface AIStatus { configured: boolean; model: string; reachable: boolean }

let statusPromise: Promise<AIStatus> | null = null;

/** Asks the server whether a key is configured (cached for the page session). */
export function getAIStatus(): Promise<AIStatus> {
  statusPromise ??= fetch(ENDPOINT, { method: 'GET' })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { configured?: boolean; model?: string }) => ({ configured: !!j.configured, model: j.model || 'gpt-4.1-mini', reachable: true }))
    .catch(() => ({ configured: false, model: 'gpt-4.1-mini', reachable: false }));
  return statusPromise;
}

/** React hook: null while loading. */
export function useAIStatus(): AIStatus | null {
  const [s, setS] = useState<AIStatus | null>(null);
  useEffect(() => { let live = true; getAIStatus().then(v => { if (live) setS(v); }); return () => { live = false; }; }, []);
  return s;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface ChatOptions {
  json?: boolean;          // response_format json_object
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function chatCompletion(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: opts.signal ?? AbortSignal.timeout(70_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, json: !!opts.json, temperature: opts.temperature ?? 0, maxTokens: opts.maxTokens }),
    });
  } catch (e) {
    throw new Error(`Could not reach the AI endpoint (${e instanceof Error ? e.message : 'network error'}).`, { cause: e });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 404) throw new Error('AI endpoint /api/openai not found — run via `npm run dev` / `npm run preview`, or deploy on Vercel.');
    if (res.status === 503) throw new Error('No OPENAI_API_KEY on the server — add it to .env.local (local) or Vercel env vars, then restart.');
    if (res.status === 401) throw new Error(`OpenAI rejected the API key (401): ${msg}`);
    if (res.status === 429) throw new Error(`Rate limit / quota (429): ${msg}`);
    throw new Error(`AI error ${res.status}: ${msg}`);
  }
  return typeof data?.content === 'string' ? data.content : '';
}
