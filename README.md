# Trueward Search — remote US software-developer jobs

Collects recent jobs from several job boards, keeps only the ones that match the rules below,
and shows them newest first with Apply, Mark applied, Edit and Delete.

Part of Trueward: one Next.js app, signed in with the same admin accounts as
the tracker and the calendar.

**Rules** (all in [src/lib/filters.js](src/lib/filters.js), covered by [src/lib/filters.test.js](src/lib/filters.test.js)):

1. Software-developer roles only, judged by title. Excludes sales/solutions/support engineers, managers, recruiters, interns, etc.
2. Fully remote only. Rejects hybrid, on-site, in-office days, required commuting/relocation, **on-site or in-person interviews**, and required in-person attendance. Tech phrases like "hybrid cloud" or "hybrid retrieval" are ignored, and "remote or hybrid" counts as remote.
3. Open to US candidates.

## Architecture

One Next.js app. There is no separate backend or frontend any more: route
handlers under `src/app/api/` are the BFF, the UI is a client component beside
them, and the jobs live in the same Supabase Postgres as Trueward Guru and the
calendar (every object prefixed `search_`, so nothing collides).

| | |
| --- | --- |
| `GET/POST /api/jobs` | list with filters and search, manual entry |
| `PATCH/DELETE /api/jobs/[id]` | edit, mark applied, dismiss, purge |
| `POST /api/jobs/dismiss` `…/restore` | bulk clear, and its undo |
| `GET /api/status` | sources, last runs, whether a scrape is in progress |
| `POST/GET /api/refresh` | scrape now |

**What the move off SQLite changed.** Two things stopped being free:

*Knowing whether a scrape is running.* It used to be a `Set` in the Express
process. On serverless each request is its own process, so an in-memory flag
says "no" to every caller — the spinner would never appear and two runs would
never notice each other. It is now read from `search_run`: a row with no
`finished_at` counts as running, until it goes stale, because a function
killed mid-run (a timeout, a deploy) leaves its row open forever and would
otherwise block refreshing permanently.

*Truncating the description.* SQLite did `substr(description, 1, 400)` in the
list query. PostgREST cannot express that in a select, so it lives in the
`search_job_list` view instead — otherwise every row would ship 5 KB of
description to render a 400-character snippet.

## Signing in

Trueward Guru's accounts, admins only — the same Supabase Auth as the tracker
and the calendar. There is no user table here and no way to create an account;
the policies ask `app_user` for the signing-in account's role and admit `admin`
and `super_admin`.

`src/proxy.ts` redirects anonymous page requests to `/login` and answers `/api`
with a 401 rather than a redirect — otherwise the UI's `fetch` would receive
the login page's HTML and report a parse error instead of "you are signed out".
That gate is a courtesy; **RLS is the boundary.** Delete the proxy and an
anonymous request still gets no rows.

## Scraping

The scraper and its seven sources moved across unchanged — they are plain Node
with `fetch` and cheerio, and rewriting working code to change no behaviour is
not a migration, it is a risk.

What did change is *who* runs them. **There is no schedule.** Scraping happens
when you press "Refresh now", and the run uses your own session — so RLS
applies to it exactly as it does to every other request.

That is not a limitation, it is the reason this app holds **no service-role
key**. A scheduled run has nobody behind it and therefore no `auth.uid()` for
the policies to test, which is what would force one in. A key that bypasses
RLS on a database that also stores candidate SSNs has no business in a web
deployment if nothing needs it — so nothing does.

The only place that key appears is `scripts/scrape-cli.ts`, a script you run by
hand. Nothing under `src/` reads it.

Scraping is slow, so the route sets `maxDuration = 300`. Each source records
its own run row as it finishes, so a run cut short by the platform's cap leaves
the sources that completed updated rather than losing the lot — and refreshing
again picks up where it left off, because each source skips what it has
already stored. On a Hobby plan the cap is 60s, which will usually cut a full
sweep short: either press it twice, or narrow it with
`{"sources": ["linkedin"]}`.

## Running it

```bash
npm install
cp .env.example .env     # NEXT_PUBLIC_SUPABASE_URL + _ANON_KEY are required
```

Then **paste `supabase/schema.sql` into the Supabase SQL editor and run it.**
Nothing works before that, and the app says so rather than showing an empty
list. Afterwards:

```bash
npm run dev              # http://localhost:3200
```

Port 3200, so it can run beside Trueward Guru on 3000 and the calendar on 3100.

To scrape from the terminal: `npm run scrape`, or
`npm run scrape -- linkedin jobgether`. To run the tests: `npm test`.

## Deploying

Vercel, like the other two. Environment variables:

| | |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | the shared Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | safe in the browser — RLS filters it |

That is the whole list. In particular **do not set
`SUPABASE_SERVICE_ROLE_KEY` here** — the app never reads it, and setting it
would put a key that bypasses RLS on a database holding candidate SSNs into a
web deployment for no reason. It belongs in your local `.env` only, where
`npm run scrape` uses it.

There is no cron, so there is no `vercel.json`.

## Reading and copying a job

Expanding a row fetches the **full description** — the list itself carries
only a 400-character snippet, because shipping every description to render a
list would be most of the payload for none of the page. It is fetched once per
row and kept, so collapsing and reopening costs nothing.

Copy buttons sit next to the things worth copying: the description, the apply
URL, and — in the edit form — the title, the apply URL and the company. They
confirm with a tick, because the clipboard gives no feedback of its own and
otherwise the only way to know a click worked is to paste somewhere and check.
The button hides itself where `navigator.clipboard` is unavailable (any
non-secure context) rather than sitting there doing nothing.

The Apply button carries the destination URL as its tooltip, so you can see
where it goes before it opens a tab.

**Company size** is shown when a source supplies it. Only Jobright does today
— it comes back on `companyResult.companySize` as free text ("201-500
employees"), and it is stored as the board words it rather than parsed into a
range, because boards disagree about bucket boundaries and parsing would
invent a precision none of them offer. Everything else leaves it null, which
is why the pill appears per row rather than occupying a column. To add
another source, set `companySize` on the job object it returns; `insertJob`
already carries it through.

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

Jobs live in the shared Supabase Postgres (`search_job`). Unapplied, non-manual jobs older than 30 days are pruned after each run; dismissed rows are kept deliberately, because they are what stops a job being re-added.

## Caveats

- Apart from Adzuna and ZipRecruiter's MCP API, these are unofficial endpoints that each site's own web page uses.
  They can change or start blocking at any time. When one breaks, only that source's chip turns red; the others keep working.
  Check each site's terms of use; keep request volumes low (the defaults are conservative).
- The remote/US checks are keyword heuristics over the posting text. They are conservative (they would
  rather drop a borderline job than show a hybrid one), but they will occasionally be wrong in both directions.
  Adjust the patterns in `src/lib/filters.js` and add a test case when you find one.
