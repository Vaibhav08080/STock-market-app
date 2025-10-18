import { getDateRange, getTodayDateRange, validateArticle, formatArticle } from "@/lib/utils"

const FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
const NEXT_PUBLIC_FINNHUB_API_KEY = process.env.NEXT_PUBLIC_FINNHUB_API_KEY as string

async function fetchJSON<T>(url: string, revalidateSeconds?: number): Promise<T> {
  const options: RequestInit = revalidateSeconds
    ? { cache: "force-cache", next: { revalidate: revalidateSeconds } as any }
    : { cache: "no-store" }
  const res = await fetch(url, options as any)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json() as Promise<T>
}

export async function getNews(symbols?: string[]): Promise<MarketNewsArticle[]> {
  try {
    const range = getDateRange(5)
    const token = NEXT_PUBLIC_FINNHUB_API_KEY
    if (!token) throw new Error("Missing FINNHUB API key")

    if (symbols && symbols.length) {
      const cleaned = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean)
      const maxArticles = 6
      const collected: MarketNewsArticle[] = []
      const seen = new Set<string>()

      for (let round = 0; round < maxArticles; round++) {
        const idx = round % cleaned.length
        const sym = cleaned[idx]
        const url = `${FINNHUB_BASE_URL}/company-news?symbol=${encodeURIComponent(sym)}&from=${range.from}&to=${range.to}&token=${token}`
        const list = await fetchJSON<RawNewsArticle[]>(url, 900)
        const article = list.find((a) => validateArticle(a))
        if (article) {
          const key = `${article.id || ""}|${article.url || ""}|${article.headline || ""}`
          if (!seen.has(key)) {
            seen.add(key)
            collected.push(formatArticle(article, true, sym, round) as MarketNewsArticle)
          }
        }
        if (collected.length >= maxArticles) break
      }

      collected.sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
      return collected.slice(0, maxArticles)
    }

    const today = getTodayDateRange()
    const url = `${FINNHUB_BASE_URL}/news?category=general&from=${today.from}&to=${today.to}&token=${token}`
    const raw = await fetchJSON<RawNewsArticle[]>(url, 900)
    const seen = new Set<string>()
    const formatted = [] as MarketNewsArticle[]
    for (const a of raw) {
      if (!validateArticle(a)) continue
      const key = `${a.id || ""}|${a.url || ""}|${a.headline || ""}`
      if (seen.has(key)) continue
      seen.add(key)
      formatted.push(formatArticle(a, false) as MarketNewsArticle)
      if (formatted.length >= 6) break
    }
    formatted.sort((a, b) => (b.datetime || 0) - (a.datetime || 0))
    return formatted
  } catch (e) {
    console.error("[getNews] Failed to fetch news:", e)
    throw new Error("Failed to fetch news")
  }
}

export { fetchJSON, FINNHUB_BASE_URL, NEXT_PUBLIC_FINNHUB_API_KEY }
