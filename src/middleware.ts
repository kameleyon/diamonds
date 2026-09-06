/**
 * Session refresh and route gating.
 *
 * Two jobs, and it is important not to confuse them:
 *
 *   1. Refresh the Supabase session. Server Components cannot write cookies, so
 *      without this the access token expires and the user is silently signed
 *      out mid-session. This is the only place the refreshed cookie can be set.
 *
 *   2. Redirect unauthenticated or unauthorised requests to /login. This is a
 *      CONVENIENCE, not the security boundary. Middleware does not run on
 *      direct server-action invocations, so every action and data read calls
 *      `requireViewer()` itself. Treating middleware as the boundary is a
 *      well-known way to ship an app that is trivially bypassed.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowed } from "@/lib/auth-policy";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Content-Security-Policy with a per-request nonce.
 *
 * The nonce is what makes this worth having. Next.js injects inline scripts for
 * hydration, so without a nonce the only way to let the app run is
 * `script-src 'unsafe-inline'` -- which permits every injected script too and
 * makes the policy close to decorative against XSS.
 *
 * `strict-dynamic` lets a nonce-approved script load its own chunks, which is
 * how Next's runtime works, without whitelisting hosts.
 *
 * Styles keep `unsafe-inline`: Tailwind and the artboard-style attributes this
 * app uses are inline by design, and there is no nonce path for them. That is a
 * real, stated limitation rather than an oversight -- style injection is a far
 * weaker primitive than script injection.
 */
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // eval is required by the dev-mode React refresh runtime, never in prod.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    // The app talks to Supabase from the browser for auth only.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "object-src 'none'",
    "base-uri 'self'",
    // Stops a form on this page POSTing credentials to another origin.
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const isDev = process.env.NODE_ENV !== "production";
  const csp = contentSecurityPolicy(nonce, isDev);

  // The nonce travels to the renderer on a request header; Next reads it from
  // here to stamp its own inline scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  // This response object accumulates the refreshed auth cookies. It must be the
  // one returned: building a fresh NextResponse later would drop the cookies
  // Supabase just set and log the user out on the next request.
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
  supabaseResponse.headers.set("content-security-policy", csp);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // With auth unconfigured the app runs as a local single-user tool. It is
  // still safe: the ledger is reached only through server code, and that code
  // enforces `requireViewer()` whenever auth IS configured.
  if (!url || !key) return supabaseResponse;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
        supabaseResponse.headers.set("content-security-policy", csp);
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Do not put other work between creating the client and reading claims: this
  // call is what triggers the token refresh, and code that runs first can
  // return early and leave the session stale.
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims as { email?: string } | undefined)?.email;

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!isAllowed(email) && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", path);
    const response = NextResponse.redirect(redirect);
    response.headers.set("content-security-policy", csp);
    return response;
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Auth cookies must
     * be refreshed on real page requests, not on every icon fetch.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
