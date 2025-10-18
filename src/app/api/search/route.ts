import { NextRequest } from "next/server"
import { searchStocks } from "@/lib/actions/finnhub.actions"

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get("q") || undefined
    const results = await searchStocks(q || undefined)
    return Response.json({ results })
  } catch (e) {
    console.error("/api/search error:", e)
    return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { "content-type": "application/json" } })
  }
}
