/**
 * Auth against Trueward Guru's accounts.
 *
 * This app has no user table and creates nobody. Signing in uses the same
 * Supabase Auth as the tracker and the calendar, and admits the same people:
 * `admin` and `super_admin` in the tracker's `app_user`. A bidder has no
 * business in the scraper's controls.
 *
 * The session lives in **httpOnly cookies**, so the browser holds a token it
 * cannot read and no Supabase SDK ships to the client. The SPA's only contact
 * with auth is POSTing a form to /api/auth/login and reading /api/auth/me.
 *
 * Tokens are verified **locally**. The project signs with ES256 and publishes
 * a JWKS, so a signature check is WebCrypto arithmetic over a cached key —
 * no network call on the request path. Calling /auth/v1/user per request
 * would have put a Supabase round trip in front of every job listing.
 */
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const ACCESS_COOKIE = 'tw_at';
export const REFRESH_COOKIE = 'tw_rt';

/** Which tracker roles may use this app. Widening it is a one-line change. */
const ALLOWED_ROLES = new Set(['admin', 'super_admin']);

export function missingEnv() {
  return [
    ['SUPABASE_URL', SUPABASE_URL],
    ['SUPABASE_ANON_KEY', ANON_KEY],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
}

// ---------------------------------------------------------------- cookies

/**
 * Read the Cookie header by hand rather than add cookie-parser.
 *
 * Express's `res.cookie` is built in; only reading needs help, and reading is
 * one split. A dependency for that is a dependency to keep patched.
 */
export function readCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

const cookieOptions = (maxAgeSeconds) => ({
  httpOnly: true,
  sameSite: 'lax',
  // Secure in production only, so `npm run dev` over plain http still works.
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: maxAgeSeconds * 1000,
});

export function setSession(res, session) {
  // The access token's own lifetime, so the cookie and the token expire
  // together rather than leaving a cookie that is already useless.
  res.cookie(ACCESS_COOKIE, session.access_token, cookieOptions(session.expires_in || 3600));
  if (session.refresh_token) {
    // 30 days: long enough not to re-type a password daily, short enough that
    // an abandoned laptop stops working eventually.
    res.cookie(REFRESH_COOKIE, session.refresh_token, cookieOptions(30 * 24 * 3600));
  }
}

export function clearSession(res) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    res.clearCookie(name, { path: '/' });
  }
}

// ---------------------------------------------------- JWKS + verification

let jwksCache = { keys: new Map(), fetchedAt: 0 };
const JWKS_TTL_MS = 10 * 60 * 1000;

async function keyFor(kid) {
  const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);

  const response = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!response.ok) throw new Error(`JWKS unavailable (${response.status})`);
  const { keys = [] } = await response.json();

  const imported = new Map();
  for (const jwk of keys) {
    // Only the signing algorithm this project actually uses. Accepting
    // whatever a JWKS advertises is how "alg: none" bugs happen.
    if (jwk.kty !== 'EC' || jwk.alg !== 'ES256') continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      ),
    );
  }
  jwksCache = { keys: imported, fetchedAt: Date.now() };
  return imported.get(kid);
}

const b64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verifies an access token and returns its claims, or null.
 *
 * The algorithm is pinned to ES256 from the token's own header being checked
 * against the key we imported — a token asking for `none`, or for HS256 with
 * the public key as the secret, finds no matching key and is refused.
 */
export async function verifyAccessToken(token) {
  try {
    const [headerPart, payloadPart, signaturePart] = String(token).split('.');
    if (!headerPart || !payloadPart || !signaturePart) return null;

    const header = JSON.parse(b64url(headerPart).toString('utf8'));
    if (header.alg !== 'ES256' || !header.kid) return null;

    const key = await keyFor(header.kid);
    if (!key) return null;

    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64url(signaturePart),
      Buffer.from(`${headerPart}.${payloadPart}`),
    );
    if (!ok) return null;

    const claims = JSON.parse(b64url(payloadPart).toString('utf8'));
    // Expiry is checked here because a signature stays valid forever.
    if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

// --------------------------------------------------------- Supabase calls

async function supabase(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...init.headers },
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

export async function signIn(email, password) {
  const { ok, body } = await supabase('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  // Supabase's own wording ("Invalid login credentials") is the right amount
  // to say — naming which half was wrong confirms whether an address exists.
  if (!ok) return { error: body?.error_description || body?.msg || 'Invalid login credentials' };
  return { session: body };
}

async function refreshSession(refreshToken) {
  const { ok, body } = await supabase('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return ok ? body : null;
}

/**
 * The tracker's role for this account, read as the account itself.
 *
 * Through PostgREST with the user's own token rather than a service-role key,
 * so `app_user`'s own RLS is what permits the read — this app never holds a
 * credential that can bypass it.
 */
async function roleOf(accessToken, userId) {
  const { ok, body } = await supabase(
    `/rest/v1/app_user?id=eq.${encodeURIComponent(userId)}&select=role,email,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!ok || !Array.isArray(body) || !body.length) return null;
  return body[0];
}

/** Role lookups are a round trip, and the answer changes rarely. */
const roleCache = new Map();
const ROLE_TTL_MS = 5 * 60 * 1000;

async function cachedRole(accessToken, userId) {
  const hit = roleCache.get(userId);
  if (hit && Date.now() - hit.at < ROLE_TTL_MS) return hit.row;
  const row = await roleOf(accessToken, userId);
  roleCache.set(userId, { row, at: Date.now() });
  return row;
}

export const isAllowed = (row) => Boolean(row && ALLOWED_ROLES.has(row.role));

// -------------------------------------------------------------- middleware

/**
 * Resolves the session, refreshing it if the access token has expired.
 *
 * Attaches `req.user` on success and leaves it undefined otherwise; deciding
 * what to do about that is the caller's job, because the answer differs
 * between an API call (401) and a page load (show the login screen).
 */
export async function loadUser(req, res, next) {
  const cookies = readCookies(req);
  let accessToken = cookies[ACCESS_COOKIE];
  let claims = accessToken ? await verifyAccessToken(accessToken) : null;

  if (!claims && cookies[REFRESH_COOKIE]) {
    const session = await refreshSession(cookies[REFRESH_COOKIE]);
    if (session?.access_token) {
      setSession(res, session);
      accessToken = session.access_token;
      claims = await verifyAccessToken(accessToken);
    } else {
      // The refresh token is spent or revoked; drop both rather than retry it
      // on every request for the rest of the session.
      clearSession(res);
    }
  }

  if (claims?.sub) {
    const row = await cachedRole(accessToken, claims.sub);
    if (isAllowed(row)) {
      req.user = {
        id: claims.sub,
        email: row.email || claims.email || '',
        name: row.name || null,
        role: row.role,
      };
    }
  }
  next();
}

/** Refuses anything without an allowed session. */
export function requireUser(req, res, next) {
  const missing = missingEnv();
  if (missing.length) {
    return res.status(503).json({
      error: `The server is missing ${missing.join(' and ')}. Set ${missing.length > 1 ? 'them' : 'it'} and restart.`,
    });
  }
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export { cachedRole as roleFor };
