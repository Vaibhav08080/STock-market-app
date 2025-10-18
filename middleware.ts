import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  try {
    // Edge-safe: rely on cookie presence to determine auth state
    const sessionCookie = await getSessionCookie(request);
    const isLoggedIn = !!sessionCookie;

    // Auth routes handling
    if (pathname.startsWith('/sign-')) {
      // If already logged in, keep you out of auth pages
      if (isLoggedIn) {
        const res = NextResponse.redirect(new URL('/', request.url));
        res.headers.set('x-middleware', 'hit');
        return res;
      }
      const res = NextResponse.next();
      res.headers.set('x-middleware', 'hit');
      return res;
    }

    // Protected routes: require auth
    if (!isLoggedIn) {
      const signInUrl = new URL('/sign-in', request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      const res = NextResponse.redirect(signInUrl);
      res.headers.set('x-middleware', 'hit');
      return res;
    }

    const res = NextResponse.next();
    res.headers.set('x-middleware', 'hit');
    return res;
  } catch (error) {
    console.error('Middleware auth error:', error);
    const res = NextResponse.redirect(new URL('/sign-in', request.url));
    res.headers.set('x-middleware', 'hit');
    return res;
  }
}

export const config = {
  matcher: [
    // Match all request paths except for these assets, and explicitly include auth routes
    '/((?!api|_next/static|_next/image|favicon.ico|assets|favicon.*\.ico).*)',
    '/sign-in',
    '/sign-up',
  ],
};
