import { betterAuth } from "better-auth";
import {mongodbAdapter} from "better-auth/adapters/mongodb"
import {connectToDB} from "@/database/mongoose"
import {nextCookies} from "better-auth/next-js"



let authInstance :ReturnType<typeof betterAuth> |null=null


export const getAuth = async () => {
    if(authInstance) return authInstance
    const mongoose = await connectToDB()
    const db = mongoose.connection.db
    if(!db) throw new Error("Failed to connect to database")
    authInstance = betterAuth({
        database:mongodbAdapter(db as any),
        secret:process.env.BETTER_AUTH_SECRET,
        baseURL:process.env.NEXT_PUBLIC_BASE_URL,
        emailAndPassword:{
            enabled:true,
            disableSignUp:false,
            requireEmailVerification:false,
            minPasswordLength:8,
            maxPasswordLength:20,
            autoSignIn:true,
            
        },
        plugin:[nextCookies()]
        
    })
    return authInstance
    
}

export const auth= await getAuth()