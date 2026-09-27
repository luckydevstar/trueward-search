/**
 * Verification is hand-written and security-critical, so it is tested against
 * tokens signed with a key we control: the JWKS fetch is stubbed to serve our
 * own public key, which lets a *valid* token be built — something the real
 * project's private key would never allow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY = 'stub-anon-key';

const { verifyAccessToken, readCookies } = await import('./auth.js');

const KID = 'test-key-1';
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('jwks')) {
    return new Response(
      JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: 'ES256', use: 'sig' }] }),
      { headers: { 'content-type': 'application/json' } },
    );
  }
  return realFetch(url);
};

const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

async function mint(claims, { alg = 'ES256', kid = KID, key = pair.privateKey } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' });
  const body = b64(claims);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(`${head}.${body}`),
  );
  return `${head}.${body}.${Buffer.from(sig).toString('base64url')}`;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 10;

test('a properly signed, unexpired token verifies', async () => {
  const token = await mint({ sub: 'user-1', email: 'a@b.com', exp: future });
  const claims = await verifyAccessToken(token);
  assert.equal(claims?.sub, 'user-1');
});

test('an expired token is refused even though its signature is good', async () => {
  const token = await mint({ sub: 'user-1', exp: past });
  assert.equal(await verifyAccessToken(token), null);
});

test('a tampered payload is refused', async () => {
  const token = await mint({ sub: 'user-1', exp: future });
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64({ sub: 'admin', exp: future })}.${s}`;
  assert.equal(await verifyAccessToken(forged), null);
});

test('alg:none is refused, even with a known kid', async () => {
  const head = b64({ alg: 'none', kid: KID, typ: 'JWT' });
  const body = b64({ sub: 'attacker', exp: future });
  assert.equal(await verifyAccessToken(`${head}.${body}.`), null);
});

test('HS256 signed with the public key is refused', async () => {
  // The classic algorithm-confusion attack: present a symmetric token whose
  // "secret" is the published public key. Pinning to ES256 is what stops it.
  const head = b64({ alg: 'HS256', kid: KID, typ: 'JWT' });
  const body = b64({ sub: 'attacker', exp: future });
  const sig = crypto
    .createHmac('sha256', JSON.stringify(jwk))
    .update(`${head}.${body}`)
    .digest('base64url');
  assert.equal(await verifyAccessToken(`${head}.${body}.${sig}`), null);
});

test('an unknown kid is refused', async () => {
  const token = await mint({ sub: 'user-1', exp: future }, { kid: 'not-in-jwks' });
  assert.equal(await verifyAccessToken(token), null);
});

test('a token signed by a different key is refused', async () => {
  const other = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const token = await mint({ sub: 'user-1', exp: future }, { key: other.privateKey });
  assert.equal(await verifyAccessToken(token), null);
});

test('malformed input is refused rather than thrown', async () => {
  for (const bad of ['', 'x', 'a.b', 'a.b.c', null, undefined, 'a.b.c.d']) {
    assert.equal(await verifyAccessToken(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('cookies are read from the header', () => {
  const cookies = readCookies({ headers: { cookie: 'tw_at=abc; tw_rt=d%20ef; other=1' } });
  assert.equal(cookies.tw_at, 'abc');
  assert.equal(cookies.tw_rt, 'd ef');
  assert.deepEqual(readCookies({ headers: {} }), {});
});
