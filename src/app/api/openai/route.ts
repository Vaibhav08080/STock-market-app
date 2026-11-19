// POST /api/openai  → { content }      GET → { configured, model }
// The OpenAI key (OPENAI_API_KEY) never leaves the server. Logged-in users only.
import { configFromEnv, proxyOpenAI } from '@/lib/ai/openaiProxy'
import { getSessionUserId } from '@/lib/ai/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request): Promise<Response> {
  const userId = await getSessionUserId(req)
  if (!userId) return Response.json({ error: { message: 'Sign in to use AI features.' } }, { status: 401 })
  const raw = req.method === 'POST' ? await req.text() : ''
  const out = await proxyOpenAI(req.method, raw, configFromEnv(process.env), `user:${userId}`)
  return Response.json(out.body, { status: out.status, headers: { 'cache-control': 'no-store' } })
}

export const GET = handle
export const POST = handle
