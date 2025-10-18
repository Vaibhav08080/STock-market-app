"use client"

import { useState } from "react"

type Props = {
  symbol: string
  company: string
  isInWatchlist: boolean
}

export default function WatchlistButton({ symbol, company, isInWatchlist }: Props) {
  const [inList, setInList] = useState<boolean>(!!isInWatchlist)
  return (
    <button
      type="button"
      onClick={() => setInList((v) => !v)}
      aria-pressed={inList}
      style={{
        background: inList ? "#f59e0b" : "#111827",
        color: inList ? "#111827" : "#e5e7eb",
        border: "1px solid #374151",
        padding: "10px 14px",
        borderRadius: 8,
        fontSize: 14,
        cursor: "pointer",
      }}
    >
      {inList ? "Remove from Watchlist" : "Add to Watchlist"}
    </button>
  )
}
