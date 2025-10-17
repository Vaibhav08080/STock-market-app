import { NextResponse } from "next/server"
import mongoose from "mongoose"
import { connectToDB } from "@/database/mongoose"

export async function GET() {
  try {
    const conn = await connectToDB()
    const state = mongoose.connection.readyState // 1 = connected
    return NextResponse.json(
      {
        ok: true,
        state,
        host: conn.connection.host,
        name: conn.connection.name,
        message: "Connected",
      },
      { status: 200 }
    )
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to connect to database" },
      { status: 500 }
    )
  }
}