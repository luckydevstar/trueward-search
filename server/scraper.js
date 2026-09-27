import { applyRules, isSoftwareRole, isUS, findNotRemoteSignal } from './filters.js';
import { insertJob, recordReject, getKnownSourceIds, recordRun, pruneOld } from './db.js';
import remoteyeah from './sources/remoteyeah.js';
import jobgether from './sources/jobgether.js';
import jobright from './sources/jobright.js';
import linkedin from './sources/linkedin.js';
import adzuna from './sources/adzuna.js';
import lensa from './sources/lensa.js';
import ziprecruiter from './sources/ziprecruiter.js';

export const SOURCES = [jobright, jobgether, remoteyeah, ziprecruiter, lensa, adzuna, linkedin];

const MAX_AGE_MS = Number(process.env.MAX_AGE_DAYS || 7) * 864e5;

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

const running = new Set();

export async function runSource(source) {
  if (running.has(source.name)) return { source: source.name, skipped: 'already running' };
  running.add(source.name);
  const run = { source: source.name, started_at: new Date().toISOString(), fetched: 0, accepted: 0, inserted: 0, error: null };
  const log = (msg) => console.log(`[${source.name}] ${msg}`);
  try {
    if (source.enabled && !source.enabled()) {
      run.error = `disabled: ${source.disabledReason}`;
      return run;
    }
    const known = getKnownSourceIds(source.name);
    const reject = (job, reason) => recordReject(job, reason);
    const jobs = await source.fetchJobs({ known, prefilter, reject, log });
    run.fetched = jobs.length;
    for (const job of jobs) {
      if (!job?.sourceId || !job.title || !job.url) continue;
      if (known.has(String(job.sourceId))) continue;
      const posted = new Date(job.postedAt);
      if (Number.isNaN(posted.getTime())) job.postedAt = new Date();
      else if (Date.now() - posted.getTime() > MAX_AGE_MS) continue;
      const verdict = applyRules(job);
      if (!verdict.ok) { reject(job, verdict.reason); continue; }
      run.accepted++;
      if (insertJob(job)) run.inserted++;
    }
    log(`fetched ${run.fetched}, passed rules ${run.accepted}, new ${run.inserted}`);
  } catch (e) {
    run.error = e.message;
    log(`ERROR ${e.message}`);
  } finally {
    run.finished_at = new Date().toISOString();
    recordRun(run);
    running.delete(source.name);
  }
  return run;
}

export async function runAll(names) {
  const selected = names?.length ? SOURCES.filter((s) => names.includes(s.name)) : SOURCES;
  // Different hosts, so sources run in parallel; each source throttles itself.
  const results = await Promise.all(selected.map(runSource));
  pruneOld(30);
  return results;
}

export const isRunning = () => running.size > 0;
