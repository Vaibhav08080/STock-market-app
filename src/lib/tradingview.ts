import { cache } from "react"

// TradingView widgets need an exchange-qualified symbol for some widgets:
// e.g. the Technical Analysis widget shows "Permission denied / This symbol is only
// available on TradingView" for bare "AAPL", but works for "NASDAQ:AAPL".
const EXCHANGE_PREFIX: [RegExp, string][] = [
  [/NASDAQ/i, "NASDAQ"],
  [/ARCA/i, "AMEX"],
  [/NYSE MKT|NYSE AMERICAN|AMERICAN STOCK EXCHANGE|\bAMEX\b/i, "AMEX"],
  [/NEW YORK STOCK EXCHANGE|^NYSE\b/i, "NYSE"],
  [/CBOE|BATS/i, "CBOE"],
  [/NATIONAL STOCK EXCHANGE OF INDIA/i, "NSE"],
  [/BOMBAY|\bBSE\b/i, "BSE"],
  [/LONDON STOCK EXCHANGE/i, "LSE"],
  [/TORONTO/i, "TSX"],
]

export const resolveTradingViewSymbol = cache(async (raw: string): Promise<string> => {
  const symbol = decodeURIComponent(raw || "").trim().toUpperCase()
  if (!symbol || symbol.includes(":")) return symbol
  const token = process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? ""
  if (!token) return symbol
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`,
      { next: { revalidate: 86_400 } },
    )
    if (!res.ok) return symbol
    const profile = (await res.json()) as { exchange?: string; ticker?: string }
    const exchange = profile?.exchange ?? ""
    const prefix = EXCHANGE_PREFIX.find(([re]) => re.test(exchange))?.[1]
    const ticker = (profile?.ticker || symbol).toUpperCase().replace(/\.(NS|BO)$/, "")
    return prefix ? `${prefix}:${ticker}` : symbol
  } catch {
    return symbol
  }
})
