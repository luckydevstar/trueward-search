import { applyRules, isSoftwareRole, isUS, findNotRemoteSignal } from '../filters.js';
import {
  insertJob, recordReject, getKnownSourceIds, recordRun, pruneOld, getRuns,
} from '../db';
import remoteyeah from './sources/remoteyeah.js';
import jobgether from './sources/jobgether.js';
import jobright from './sources/jobright.js';
import linkedin from './sources/linkedin.js';
import adzuna from './sources/adzuna.js';
import lensa from './sources/lensa.js';
import ziprecruiter from './sources/ziprecruiter.js';

export const SOURCES = [jobright, jobgether, remoteyeah, ziprecruiter, lensa, adzuna, linkedin];

const MAX_AGE_MS = Number(process.env.MAX_AGE_DAYS || 7) * 864e5;

/** A run older than this is assumed dead rather than still going. */
const STALE_RUN_MS = 15 * 60 * 1000;

/** Cheap checks run before a source spends requests on a detail page. */
function prefilter(job, { checkLocation = true } = {}) {
  const role = isSoftwareRole(job.title);
  if (!role.ok) return role;
  if (checkLocation) {
    const us = isUS(job);
    if (!us.ok) return us;
  }
  if (job.remote === false) return { ok: false, reason: `source-says-${job.workplace || 'not-remote'}` };
  const sig = findNotRemoteSignal([job.title, job.location, job.workplace].filter(Boolean).join(' | '));
  if (sig) return { ok: false, reason: `not-remote: "${sig}"` };
  return { ok: true };
}

/**
 * Is a scrape in progress?
 *
 * Read from the database, not from a module-level Set as before. On
 * serverless each request is its own process, so an in-memory flag would say
 * "no" to every caller and the UI's spinner would never appear — and two
 * overlapping runs would never notice each other.
 *
 * A run with no `finished_at` counts as in progress until it goes stale,
 * because a function killed mid-run (a timeout, a deploy) leaves its row open
 * forever and would otherwise block refreshing permanently.
 */
export async function isRunning(db) {
  const runs = await getRuns(db);
  return runs.some(
    (r) =>
      r.started_at &&
      !r.finished_at &&
      Date.now() - new Date(r.started_at).getTime() < STALE_RUN_MS,
  );
}

export async function runSource(db, source) {
  const run = {
    source: source.name,
    started_at: new Date().toISOString(),
    finished_at: null,
    fetched: 0,
    accepted: 0,
    inserted: 0,
    error: null,
  };
  const log = (msg) => console.log(`[${source.name}] ${msg}`);

  // Written before the work starts, so isRunning() above can see it and the
  // UI can show a spinner while a source is still fetching.
  await recordRun(db, run);

  try {
    if (source.enabled && !source.enabled()) {
      run.error = `disabled: ${source.disabledReason}`;
      return run;
    }

    const known = await getKnownSourceIds(db, source.name);
    const reject = (job, reason) => recordReject(db, job, reason);
    const jobs = await source.fetchJobs({ known, prefilter, reject, log });
    run.fetched = jobs.length;

    for (const job of jobs) {
      if (!job?.sourceId || !job.title || !job.url) continue;
      if (known.has(String(job.sourceId))) continue;
      const posted = new Date(job.postedAt);
      if (Number.isNaN(posted.getTime())) job.postedAt = new Date();
      else if (Date.now() - posted.getTime() > MAX_AGE_MS) continue;

      const verdict = applyRules(job);
      if (!verdict.ok) { await reject(job, verdict.reason); continue; }
      run.accepted++;
      if (await insertJob(db, job)) run.inserted++;
    }
    log(`fetched ${run.fetched}, passed rules ${run.accepted}, new ${run.inserted}`);
  } catch (e) {
    run.error = e.message;
    log(`ERROR ${e.message}`);
  } finally {
    run.finished_at = new Date().toISOString();
    await recordRun(db, run);
  }
  return run;
}

export async function runAll(db, names) {
  const selected = names?.length ? SOURCES.filter((s) => names.includes(s.name)) : SOURCES;
  // Different hosts, so sources run in parallel; each source throttles itself.
  const results = await Promise.all(selected.map((s) => runSource(db, s)));
  await pruneOld(db, 30);
  return results;
}
