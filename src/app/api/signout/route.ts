import { auth } from "@/lib/better-auth/auth";

export async function POST(req: Request) {
  try {
    await auth.api.signOut({ headers: req.headers });
    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("SIGNOUT API ERROR", e);
    return new Response("Failed to sign out", { status: 500 });
  }
}
