import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

/**
 * Supabase as the signed-in user, bound to the request's cookies.
 *
 * The **anon** key, not the service role. Every query it makes is filtered by
 * the policies in supabase/schema.sql, which gate the calendar tables on the
 * tracker's admin role. That is the whole point of the auth work: this app no
 * longer holds a credential that can bypass RLS on a database that also
 * stores candidate SSNs.
 *
 * Must be built per request and never hoisted to a module constant —
 * `cookies()` is request-scoped, so a shared client would serve one user's
 * session to everyone. `cache()` memoises it *within* a request, which is the
 * safe middle: one client per request rather than one per call site.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can read cookies but not write them. Supabase
            // tries to write when refreshing an expiring token; the proxy does
            // the same refresh on every request and *can* write, so swallowing
            // this is correct rather than merely convenient.
          }
        },
      },
    },
  );
});

/**
 * The signed-in account, or null.
 *
 * getClaims() verifies the JWT signature the same way getUser() does — locally
 * against a cached JWKS when the project signs asymmetrically — so this is not
 * a security trade, only a faster one.
 */
export async function currentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  return claims
    ? { id: claims.sub as string, email: (claims.email as string) ?? "" }
    : null;
}
