import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'jobs.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    source_id   TEXT NOT NULL,
    dedupe_key  TEXT NOT NULL,
    title       TEXT NOT NULL,
    company     TEXT,
    location    TEXT,
    salary      TEXT,
    url         TEXT NOT NULL,
    description TEXT,
    posted_at   TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'new',   -- new | applied | dismissed
    notes       TEXT,
    manual      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source, source_id)
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_posted ON jobs (posted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs (dedupe_key);

  -- Jobs that failed the rules. Remembered so detail pages are not re-fetched every run.
  CREATE TABLE IF NOT EXISTS rejected (
    source    TEXT NOT NULL,
    source_id TEXT NOT NULL,
    reason    TEXT,
    seen_at   TEXT NOT NULL,
    PRIMARY KEY (source, source_id)
  );

  CREATE TABLE IF NOT EXISTS scrape_runs (
    source      TEXT PRIMARY KEY,
    started_at  TEXT,
    finished_at TEXT,
    fetched     INTEGER,
    accepted    INTEGER,
    inserted    INTEGER,
    error       TEXT
  );
`);

export const STATUSES = ['new', 'applied', 'dismissed'];

// Same job posted on several boards: match on company + title, ignoring punctuation and seniority noise.
export function dedupeKey(company = '', title = '') {
  const norm = (s) =>
    s.toLowerCase()
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/\b(remote|us|usa|united states|100%|fully|work from home)\b/g, ' ')
      .replace(/\b(inc|llc|ltd|corp|corporation|co)\b\.?/g, ' ')
      .replace(/[^a-z0-9+#]+/g, ' ')
      .trim();
  return `${norm(company)}|${norm(title)}`;
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO jobs
    (source, source_id, dedupe_key, title, company, location, salary, url, description, posted_at, fetched_at, manual)
  VALUES
    (@source, @source_id, @dedupe_key, @title, @company, @location, @salary, @url, @description, @posted_at, @fetched_at, @manual)
`);
const dupeExists = db.prepare('SELECT 1 FROM jobs WHERE dedupe_key = ? LIMIT 1');
const knownIds = db.prepare(
  'SELECT source_id FROM jobs WHERE source = @s UNION SELECT source_id FROM rejected WHERE source = @s',
);
const rejectStmt = db.prepare(`
  INSERT OR REPLACE INTO rejected (source, source_id, reason, seen_at) VALUES (?, ?, ?, ?)
`);

/** Source ids already stored or rejected, so scrapers can skip expensive detail fetches. */
export function getKnownSourceIds(source) {
  return new Set(knownIds.all({ s: source }).map((r) => r.source_id));
}

export function recordReject(job, reason) {
  rejectStmt.run(job.source, String(job.sourceId), String(reason).slice(0, 300), new Date().toISOString());
}

/** Insert a scraped job. Skips it if it (or a cross-board duplicate) is already stored, including dismissed ones. */
export function insertJob(job, { manual = false } = {}) {
  const row = {
    source: job.source,
    source_id: String(job.sourceId),
    dedupe_key: dedupeKey(job.company, job.title),
    title: job.title.trim(),
    company: job.company?.trim() || null,
    location: job.location?.trim() || null,
    salary: job.salary || null,
    url: job.url,
    description: job.description ? job.description.slice(0, 5000) : null,
    posted_at: new Date(job.postedAt || Date.now()).toISOString(),
    fetched_at: new Date().toISOString(),
    manual: manual ? 1 : 0,
  };
  if (!manual && dupeExists.get(row.dedupe_key)) return null;
  const info = insertStmt.run(row);
  return info.changes ? info.lastInsertRowid : null;
}

export function listJobs({ status = 'active', source, q, limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = {};
  if (status === 'active') where.push("status != 'dismissed'");
  else if (status && status !== 'all') { where.push('status = @status'); params.status = status; }
  if (source) { where.push('source = @source'); params.source = source; }
  if (q) {
    where.push("(title LIKE @q OR company LIKE @q OR IFNULL(description,'') LIKE @q)");
    params.q = `%${q}%`;
  }
  const sql = `
    SELECT id, source, title, company, location, salary, url, substr(description, 1, 400) AS snippet,
           posted_at, fetched_at, status, notes, manual
    FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY posted_at DESC, id DESC
    LIMIT @limit OFFSET @offset`;
  const total = db.prepare(`SELECT COUNT(*) n FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(params).n;
  return { total, jobs: db.prepare(sql).all({ ...params, limit, offset }) };
}

export function getJob(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

const EDITABLE = ['title', 'company', 'location', 'salary', 'url', 'description', 'posted_at', 'status', 'notes'];

export function updateJob(id, patch) {
  const fields = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (!fields.length) return getJob(id);
  db.prepare(`UPDATE jobs SET ${fields.map((f) => `${f} = @${f}`).join(', ')} WHERE id = @id`)
    .run({ ...Object.fromEntries(fields.map((f) => [f, patch[f]])), id });
  return getJob(id);
}

/** Soft delete: row stays so the scraper never re-adds the job. */
export function dismissJob(id) {
  return db.prepare("UPDATE jobs SET status = 'dismissed' WHERE id = ?").run(id).changes > 0;
}

/** Hard delete, used only for manually-added jobs (nothing will re-add them). */
export function deleteJob(id) {
  return db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0;
}

export function counts() {
  return db.prepare(`
    SELECT source, status, COUNT(*) n FROM jobs GROUP BY source, status
  `).all();
}

export function recordRun(run) {
  db.prepare(`
    INSERT INTO scrape_runs (source, started_at, finished_at, fetched, accepted, inserted, error)
    VALUES (@source, @started_at, @finished_at, @fetched, @accepted, @inserted, @error)
    ON CONFLICT(source) DO UPDATE SET
      started_at = excluded.started_at, finished_at = excluded.finished_at, fetched = excluded.fetched,
      accepted = excluded.accepted, inserted = excluded.inserted, error = excluded.error
  `).run(run);
}

export function getRuns() {
  return db.prepare('SELECT * FROM scrape_runs ORDER BY source').all();
}

/** Drop old, untouched jobs so the DB does not grow forever. Dismissed rows are kept to block re-adding. */
export function pruneOld(days = 30) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  db.prepare('DELETE FROM rejected WHERE seen_at < ?').run(cutoff);
  return db.prepare("DELETE FROM jobs WHERE status = 'new' AND manual = 0 AND posted_at < ?").run(cutoff).changes;
}
