"use server"
import { connectToDB } from "@/database/mongoose"
export const getAllUserForNewsEmail = async (): Promise<Array<{ id: string; email: string; name: string; country?: string }>>=>{
    try{
        const mongoose = await connectToDB()
        const db = mongoose.connection.db
        if(!db){
            throw new Error("Database connection not found")
        }
        const projections = { id: 1, email: 1, name: 1, fullName: 1, country: 1 } as const
        const filter = { email: { $exists: true, $ne: null } } as const

        const candidateCollections = ["users", "user", "auth_users"]
        let found: any[] = []
        let usedCollection = ""
        for (const col of candidateCollections) {
            try {
                const res = await db.collection(col).find(filter, { projection: projections as any }).toArray()
                if (res?.length) {
                    found = res
                    usedCollection = col
                    break
                }
            } catch {}
        }

        // As a final fallback, if still empty, try listing collections and use the first that contains email docs
        if (!found.length) {
            const cols = await db.listCollections().toArray()
            for (const c of cols) {
                try {
                    const res = await db.collection(c.name).find(filter, { projection: projections as any }).toArray()
                    if (res?.length) { found = res; usedCollection = c.name; break }
                } catch {}
            }
        }

        console.log(`[getAllUserForNewsEmail] Using collection: ${usedCollection || "<none>"} count=${found.length}`)

        return found
            .filter((user) => !!(user as any).email)
            .map((user) => {
                const fallbackName = ((user as any).email as string)?.split("@")[0] || "Investor"
                return {
                    id: (user as any).id || (user as any)._id?.toString() || "",
                    email: (user as any).email,
                    name: (user as any).name || (user as any).fullName || fallbackName,
                    country: (user as any).country,
                }
            })
        
    }catch(error){
        console.log("[getAllUserForNewsEmail] Error fetching users for news email", error)
        return[]
    }

}