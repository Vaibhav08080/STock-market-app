"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Command } from "cmdk"
import Link from "next/link"
import { useDebounce } from "@/hooks/useDebounce"

type Props = SearchCommandProps & { externalOnly?: boolean }

export default function SearchCommand({ renderAs = 'button', label = 'Add stock', initialStocks, externalOnly = false }: Props) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [loading, setLoading] = useState(false)
  const [stocks, setStocks] = useState<StockWithWatchlistStatus[]>(initialStocks)

  const isSearchMode = !!searchTerm.trim()
  const displayStocks = isSearchMode ? stocks : stocks?.slice(0, 10)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(v => !v)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("open-search", onOpen as EventListener)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("open-search", onOpen as EventListener)
    }
  }, [])

  const runSearch = useCallback(async () => {
    if (!isSearchMode) { setStocks(initialStocks); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchTerm.trim())}`)
      const json = await res.json()
      setStocks(Array.isArray(json?.results) ? json.results : [])
    } catch {
      setStocks([])
    } finally {
      setLoading(false)
    }
  }, [isSearchMode, initialStocks, searchTerm])

  const debouncedSearch = useDebounce(runSearch, 300)

  useEffect(() => {
    debouncedSearch()
  }, [debouncedSearch, searchTerm])

  const handleSelectStock = () => {
    setOpen(false)
    setSearchTerm("")
    setStocks(initialStocks)
  }

  const handleManualSearch = () => {
    runSearch()
  }

  const Shortcut = useMemo(() => (
    <span style={{ marginLeft: 8, color: "#6b7280", fontSize: 12 }}>⌘K</span>
  ), [])

  return (
    <>
      {!externalOnly && (
        renderAs === 'text' ? (
          <span onClick={() => setOpen(true)} className="search-text">{label}</span>
        ) : (
          <button onClick={() => setOpen(true)} className="search-btn">{label}</button>
        )
      )}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "10vh",
            zIndex: 1000,
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 92vw)",
              background: "#0f1115",
              color: "#E5E7EB",
              border: "1px solid #262626",
              borderRadius: 12,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
              overflow: "hidden",
            }}
          >
            <Command label="Search" shouldFilter={true}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderBottom: "1px solid #1f2937" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <Command.Input
                    autoFocus
                    placeholder="Type a symbol or company name..."
                    value={searchTerm}
                    onValueChange={setSearchTerm}
                    style={{
                      width: "100%",
                      outline: "none",
                      border: "1px solid #374151",
                      background: "#0b0d11",
                      color: "#F3F4F6",
                      padding: "10px 12px",
                      borderRadius: 8,
                      fontSize: 14,
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleManualSearch}
                  style={{
                    background: "#111827",
                    color: "#E5E7EB",
                    border: "1px solid #374151",
                    padding: "9px 12px",
                    borderRadius: 8,
                    fontSize: 14,
                    cursor: "pointer",
                  }}
                >
                  Search
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={{
                    background: "transparent",
                    color: "#9CA3AF",
                    border: "none",
                    padding: 6,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
              <Command.List style={{ maxHeight: 420, overflowY: "auto", padding: 8 }}>
                <Command.Empty style={{ padding: 16, color: "#9CA3AF" }}>{loading ? "Loading stocks..." : "No results"}</Command.Empty>
                <div style={{ padding: "8px 10px", color: "#9CA3AF", fontSize: 12 }}>
                  {isSearchMode ? "Search results" : "Popular stocks"} ({displayStocks?.length || 0})
                </div>
                {displayStocks?.map((stock) => (
                  <Command.Item
                    key={stock.symbol}
                    value={stock.symbol}
                    onSelect={handleSelectStock}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 8,
                      margin: "4px 2px",
                      background: "transparent",
                    }}
                  >
                    <Link href={`/stocks/${stock.symbol}`} className="search-item-link" style={{ display: "flex", gap: 10, alignItems: "center", color: "inherit", textDecoration: "none", width: "100%" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, color: "#F3F4F6" }}>{stock.name}</div>
                        <div style={{ fontSize: 12, color: "#9CA3AF" }}>{stock.symbol} | {stock.exchange} | {stock.type}</div>
                      </div>
                    </Link>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </div>
        </div>
      ) : null}
    </>
  )
}
