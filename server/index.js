import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listJobs, getJob, insertJob, updateJob, dismissJob, deleteJob, getRuns, counts, STATUSES } from './db.js';
import { runAll, isRunning, SOURCES } from './scraper.js';

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 4000);
const REFRESH_MINUTES = Number(process.env.REFRESH_MINUTES || 30);

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
