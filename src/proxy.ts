import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every matched request. Two jobs:
 *
 *  1. Refresh the Supabase session. Access tokens are short-lived and Server
 *     Components cannot write cookies, so a refresh anywhere else would have
 *     nowhere to persist and users would be signed out mid-session.
 *
 *  2. Send anonymous requests to /login before they reach a page.
 *
 * The second is an optimistic gate, not the boundary. It reads a cookie and
 * nothing more. The boundary is RLS: delete this file and an anonymous
 * request still gets no rows, because the policies ask the database who you
 * are rather than asking this.
 *
 * Next 16 renamed `middleware` to `proxy` and pinned it to the nodejs
 * runtime; there is no edge option to opt into.
 */
export async function proxy(request: NextRequest) {
  // Must be `let`: createServerClient replaces this response when it writes
  // refreshed auth cookies, and the replacement is what has to be returned.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/login" || pathname.startsWith("/auth");

  if (!signedIn && !isPublic) {
    // API routes get a 401 rather than a redirect: the grid's fetch would
    // otherwise receive the login page's HTML and fail to parse it, reporting
    // a JSON error instead of "you are signed out".
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Returning `response` rather than a fresh NextResponse.next() is
  // essential: a new one would drop the refreshed cookies set above, and the
  // session would silently fail to renew.
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
