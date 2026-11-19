// Resolves the logged-in user for API routes. Imported lazily because the
// better-auth module connects to MongoDB at import time.
export async function getSessionUserId(req: Request): Promise<string | null> {
  try {
    const { auth } = await import('@/lib/better-auth/auth')
    const session = await auth.api.getSession({ headers: req.headers })
    return session?.user?.id ?? null
  } catch (e) {
    console.error('[api] session lookup failed:', e)
    return null
  }
}
