// Same-origin proxy for Yahoo Finance chart history (the browser can't call Yahoo directly: no CORS).
// Only /v8/finance/chart/<symbol> is allowed. Used by the AI Strategy Lab (/backtest).
import { getSessionUserId } from '@/lib/ai/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await getSessionUserId(req))) return Response.json({ error: 'Sign in first.' }, { status: 401 })
  const { path } = await params
  const p = (path ?? []).map(decodeURIComponent)
  if (p.length !== 4 || p[0] !== 'v8' || p[1] !== 'finance' || p[2] !== 'chart' || !/^[\w.^=\-]{1,20}$/.test(p[3])) {
    return Response.json({ error: 'Only /v8/finance/chart/<symbol> is allowed.' }, { status: 400 })
  }
  const qs = new URL(req.url).search
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p[3])}${qs}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 3600 },
    })
    const body = await res.text()
    return new Response(body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'private, max-age=600' } })
  } catch (e) {
    return Response.json({ error: `Yahoo request failed: ${e instanceof Error ? e.message : 'network error'}` }, { status: 502 })
  }
}
