"use server"
import {auth} from "@/lib/better-auth/auth"
import {inngest} from "@/lib/inngest/client"
import {headers} from "next/headers"
export const SignUpwithEmail = async (
  { email, password, fullName, country, investmentGoals, riskTolerance, preferredIndustry }: SignUpFormData
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await auth.api.signUpEmail({
      body: {
        email: email,
        password: password,
        name: fullName,
      },
    })
    if (response) {
      await inngest.send({
        name: "app/user.created",
        data:{
          email:email,
          name:fullName,
          country:country,
          investmentGoals:investmentGoals,
          riskTolerance:riskTolerance,
          preferredIndustry:preferredIndustry
        }
      })
      return {success:true , message:"User created successfully"}
    }
    // Fallback when no response is returned from auth API
    return { success:false, message:"Sign up failed" }
  } catch (error) {
    console.log("SIGNUP ERROR", error)
    return { success:false , message:"Something went wrong"}
  }
}

export const signUpWithEmail = SignUpwithEmail

export const signInWithEmail = async (
  { email, password }: SignInFormData
): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await auth.api.signInEmail({
      body: { email, password },
    })
    if (response) {
      return { success: true, message: "Signed in successfully" }
    }
    return { success: false, message: "Sign in failed" }
  } catch (error) {
    console.log("SIGNIN ERROR", error)
    return { success: false, message: "Something went wrong" }
  }
}

export const signOut = async () => {
  try{
    await auth.api.signOut({headers:await headers()})

  }
  catch(e){
    console.log("SIGNOUT ERROR", e)
    return {success:false , message:"Signout failed"}

  }}