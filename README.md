# Trueward Search — remote US software-developer jobs

Collects recent jobs from several job boards, keeps only the ones that match the rules below,
and shows them newest first in a web UI with Apply, Mark applied, Edit and Delete.

**Rules** (all in [server/filters.js](server/filters.js), covered by [server/filters.test.js](server/filters.test.js)):

1. Software-developer roles only, judged by title. Excludes sales/solutions/support engineers, managers, recruiters, interns, etc.
2. Fully remote only. Rejects hybrid, on-site, in-office days, required commuting/relocation, **on-site or in-person interviews**, and required in-person attendance. Tech phrases like "hybrid cloud" or "hybrid retrieval" are ignored, and "remote or hybrid" counts as remote.
3. Open to US candidates.

## Signing in

Part of Trueward, so it uses Trueward Guru's accounts: the same Supabase Auth,
the same password, **admins only**. There is no user table here and no way to
create an account — the server reads the tracker's `app_user` for the role and
admits `admin` and `super_admin`. A bidder can authenticate and is then told
plainly that this app is not for them, rather than shown an empty list.

Two things make that safe without much machinery:

**The session is an httpOnly cookie.** The browser holds a token it cannot
read, no Supabase SDK ships to the client, and the SPA's entire contact with
auth is POSTing a form to `/api/auth/login` and reading `/api/auth/me`.

**Tokens are verified locally.** The project signs with ES256 and publishes a
JWKS, so checking a signature is WebCrypto over a cached key — no network call
on the request path. Calling `/auth/v1/user` per request would have put a
Supabase round trip in front of every job listing.

`server/auth.js` is hand-written, so it is tested like something
security-critical (`server/auth.test.js`): the JWKS fetch is stubbed with a key
we control, which lets a *valid* token be minted, and the refusals are asserted
individually — expired, tampered payload, unknown `kid`, wrong key, `alg:none`
with a real `kid`, and HS256 signed with the published public key (the classic
algorithm-confusion attack, which pinning to ES256 is what stops).

The gate itself is one line — `app.use('/api', requireUser)` above the routes
rather than repeated on each, so a route added later is protected by default
instead of by remembering.

## Running it

```bash
npm install && npm --prefix client install
cp .env.example .env      # SUPABASE_URL + SUPABASE_ANON_KEY are required
npm run build             # build the UI once
npm start                 # http://localhost:4000
```

Without those two variables nobody can sign in, and the app says exactly that
instead of showing a login form that cannot work.

When the server starts, it fetches from every source and then refreshes every 30 minutes (`REFRESH_MINUTES`).
The first run takes a few minutes because some sources are deliberately throttled.

For development with hot reload: `npm run dev` (UI on http://localhost:5173, API on :4000).
To scrape once from the terminal: `npm run scrape` or `npm run scrape -- linkedin jobgether`.
To run the tests: `npm test` — filters and auth.

## Sources

| Source | How | Notes |
|---|---|---|
| Jobright | Public visitor search API, Remote + US + last day | Throttled (~4s between calls) because it rate-limits bursts. Apply opens the Jobright job page. |
| Jobgether | Its site's search API (US, Software Development, newest first) | Remote-only board. Full description fetched per job. Apply goes straight to the employer's ATS. |
| RemoteYeah | Filtered RSS feed (dev titles, United States) | Remote-only board. The feed covers about the last 3 days. |
| Lensa | Its site's JSON API, `remote_jobs: only` | No date sort, so up to 500 results per query are scanned and filtered by date. |
| LinkedIn | Public logged-out job search | LinkedIn ignores the remote filter for logged-out requests, so each new job's description is fetched and checked (max 120 per run). Apply opens the LinkedIn job page. |
| ZipRecruiter | ZipRecruiter's official MCP API | Scraping is blocked by Cloudflare. The API gives only 5 jobs per call and rate-limits hard, so expect a trickle, and sometimes a "rate limited" status. No descriptions, so on-site interview wording can't be checked. |
| Adzuna | Official API | Needs free keys from https://developer.adzuna.com/ in `.env`. Only returns ~500-char description snippets. |

Hover a source chip in the UI to see its last run's counts or error.

## Managing jobs (CRUD)

| Action | UI | API |
|---|---|---|
| List (newest first) | Main list, grouped by day; tabs Active / New / Applied / Deleted, search, source filter | `GET /api/jobs?status=active&source=&q=&limit=&offset=` |
| Create | **+ Add job** | `POST /api/jobs` `{title, url, company, location, salary, notes, postedAt}` |
| Update | **✓ Applied**, **Edit** (title, URL, notes, …) | `PATCH /api/jobs/:id` |
| Delete | **Delete** (with Undo), **Delete all shown** | `DELETE /api/jobs/:id`, `POST /api/jobs/dismiss {ids}` |

A deleted job is not erased. It is marked `dismissed` so later refreshes never bring it back, including
when the same job (same company + title) shows up on a different board. Deleted jobs can be restored from
the **Deleted** tab. Jobs you added by hand can also be deleted permanently there.

Other endpoints: `GET /api/status` (source health), `POST /api/refresh` (fetch now).

Data is stored in SQLite at `data/jobs.db`. Unapplied jobs older than 30 days are pruned automatically.

## Caveats

- Apart from Adzuna and ZipRecruiter's MCP API, these are unofficial endpoints that each site's own web page uses.
  They can change or start blocking at any time. When one breaks, only that source's chip turns red; the others keep working.
  Check each site's terms of use; keep request volumes low (the defaults are conservative).
- The remote/US checks are keyword heuristics over the posting text. They are conservative (they would
  rather drop a borderline job than show a hybrid one), but they will occasionally be wrong in both directions.
  Adjust the patterns in `server/filters.js` and add a test case when you find one.
