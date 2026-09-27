import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJobs, getJob, insertJob, updateJob, dismissJob, deleteJob, getRuns, counts, STATUSES } from './db.js';
import { runAll, isRunning, SOURCES } from './scraper.js';
import { clearSession, loadUser, missingEnv, requireUser, setSession, signIn, verifyAccessToken, roleFor, isAllowed } from './auth.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 4000);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 30);

// ---- Auth ----
//
// Trueward Guru's accounts, admins only. See server/auth.js for why the
// session is an httpOnly cookie and why tokens are verified locally.
//
// loadUser runs before everything and only *resolves* the session; the gate
// below is what refuses. Keeping those separate is what lets /api/auth/me
// answer "not signed in" with a 200 instead of a 401 the client has to treat
// as an error.
app.use(loadUser);

app.post('/api/auth/login', async (req, res) => {
  const missing = missingEnv();
  if (missing.length) {
    return res.status(503).json({ error: `The server is missing ${missing.join(' and ')}.` });
  }

  const { email, password } = req.body || {};
  if (!email?.trim() || !password) return res.status(400).json({ error: 'Email and password are required' });

  const { session, error } = await signIn(email.trim(), password);
  if (error) return res.status(401).json({ error });

  // Authenticating is not the same as being allowed in. A bidder has a valid
  // Trueward password and no business here, and is told so plainly rather
  // than being shown an empty app.
  const claims = await verifyAccessToken(session.access_token);
  const row = claims?.sub ? await roleFor(session.access_token, claims.sub) : null;
  if (!isAllowed(row)) {
    return res.status(403).json({ error: 'This app is for Trueward admins. Your account is not one.' });
  }

  setSession(res, session);
  res.json({ user: { id: claims.sub, email: row.email || email, name: row.name || null, role: row.role } });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/** Who is signed in, or null. Deliberately 200 either way. */
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user ?? null, configured: missingEnv().length === 0 });
});

// Everything below this line needs a session. Placed above the routes rather
// than repeated on each, so a route added later is gated by default instead
// of by remembering.
app.use('/api', requireUser);

// ---- Read ----
app.get('/api/jobs', (req, res) => {
  const { status = 'active', source, q, limit = '500', offset = '0' } = req.query;
  res.json(listJobs({ status, source: source || undefined, q: q || undefined, limit: Math.min(Number(limit) || 500, 2000), offset: Number(offset) || 0 }));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(Number(req.params.id));
  job ? res.json(job) : res.status(404).json({ error: 'Not found' });
});

// ---- Create (manual entry) ----
app.post('/api/jobs', (req, res) => {
  const { title, company, location, url, salary, description, postedAt, notes } = req.body || {};
  if (!title?.trim() || !url?.trim()) return res.status(400).json({ error: 'title and url are required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  const id = insertJob(
    { source: 'manual', sourceId: `manual-${Date.now()}`, title, company, location, url, salary, description, postedAt: postedAt || new Date() },
    { manual: true },
  );
  res.status(201).json(notes ? updateJob(id, { notes }) : getJob(id));
});

// ---- Update (status, notes, fields) ----
app.patch('/api/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getJob(id)) return res.status(404).json({ error: 'Not found' });
  if (req.body.status && !STATUSES.includes(req.body.status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  if (req.body.url && !/^https?:\/\//i.test(req.body.url)) return res.status(400).json({ error: 'url must start with http(s)://' });
  res.json(updateJob(id, req.body));
});

// ---- Delete ----
// Scraped jobs are soft-deleted (status=dismissed) so later scrapes don't bring them back.
// ?permanent=1 hard-deletes, and is only allowed for manually added jobs.
app.delete('/api/jobs/:id', (req, res) => {
  const id = Number(req.params.id);
  const job = getJob(id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const ok = req.query.permanent && job.manual ? deleteJob(id) : dismissJob(id);
  res.json({ ok });
});

// Bulk dismiss ("clear everything I've seen"). Jobs marked applied are left alone.
app.post('/api/jobs/dismiss', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  const dismissed = ids.filter((id) => getJob(id)?.status === 'new' && dismissJob(id));
  res.json({ dismissed });
});

// Undo for bulk dismiss
app.post('/api/jobs/restore', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  ids.forEach((id) => updateJob(id, { status: 'new' }));
  res.json({ restored: ids.length });
});

// ---- Scraping ----
app.get('/api/status', (_req, res) => {
  res.json({
    running: isRunning(),
    refreshMinutes: REFRESH_MINUTES,
    sources: SOURCES.map((s) => ({
      name: s.name,
      label: s.label,
      enabled: s.enabled ? s.enabled() : true,
      disabledReason: s.enabled && !s.enabled() ? s.disabledReason : null,
    })),
    runs: getRuns(),
    counts: counts(),
  });
});

app.post('/api/refresh', (req, res) => {
  if (isRunning()) return res.status(202).json({ started: false, message: 'A refresh is already running' });
  const names = Array.isArray(req.body?.sources) ? req.body.sources : undefined;
  runAll(names).catch((e) => console.error('refresh failed', e));
  res.status(202).json({ started: true });
});

// ---- Frontend (production build) ----
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  if (process.env.AUTO_REFRESH !== 'false') {
    const tick = () => { if (!isRunning()) runAll().catch((e) => console.error('scheduled refresh failed', e)); };
    setTimeout(tick, 3000);
    setInterval(tick, REFRESH_MINUTES * 60 * 1000);
  }
});
