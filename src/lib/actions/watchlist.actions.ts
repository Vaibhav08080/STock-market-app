"use server"

import { connectToDB } from "@/database/mongoose"
import Watchlist from "@/database/models/watchlist.model"

export async function getWatchlistSymbolsByEmail(email: string): Promise<string[]> {
  try {
    const mongoose = await connectToDB()
    const db = mongoose.connection.db
    if (!db) return []

    const user = await db.collection("users").findOne<{ id?: string; _id?: any; email?: string }>({ email })
    if (!user) return []

    const userId = (user as any).id || user._id?.toString()
    if (!userId) return []

    const items = await Watchlist.find({ userId }).select({ symbol: 1, _id: 0 }).lean()
    return (items || []).map((w) => w.symbol?.toUpperCase?.() || "").filter(Boolean)
  } catch (error) {
    console.error("[getWatchlistSymbolsByEmail] Failed:", error)
    return []
  }
}
