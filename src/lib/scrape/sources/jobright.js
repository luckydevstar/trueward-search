// Jobright's public visitor search API (no login). workModel 2 = Remote, country US, last day.
// It rate-limits bursts (403, errorCode 43004), so requests are spaced ~4s apart with backoff.
// The listing carries a summary; the full description (needed to spot on-site interview
// requirements) comes from the detail page's JSON-LD.
import { http, getText, htmlToText, sleep, cheerio } from './util.js';

const QUERIES = ['Software Engineer', 'Software Developer', 'Full Stack Engineer', 'Frontend Engineer', 'Backend Engineer'];
const PAGE_SIZE = 100;
const MAX_PAGES_PER_QUERY = 2;
const MAX_DETAIL_FETCHES = Number(process.env.JOBRIGHT_MAX_DETAILS || 80);
const GAP_MS = 4000;

async function search(title, position) {
  const url = `https://jobright.ai/swan/recommend/visitor-search?searchType=job-title&sortCondition=1&count=${PAGE_SIZE}&position=${position}`;
  const body = JSON.stringify({
    value: title, country: 'US', searchType: 'job-title', daysAgo: 1, workModel: [2],
    jobTaxonomyList: [{ taxonomyId: '00-00-00', title }],
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await http(url, { method: 'POST', body, retries: 0, headers: { 'Content-Type': 'application/json', Accept: 'application/json' } });
      return (await res.json()).result?.jobList || [];
    } catch (e) {
      if (!/HTTP 403/.test(e.message) || attempt === 3) throw e;
      await sleep(6000 * (attempt + 1)); // risk-control limit, recovers after a few seconds
    }
  }
  return [];
}

function toJob({ jobResult: j = {}, companyResult: c = {} }) {
  const summary = [j.jobSummary, ...(j.coreResponsibilities || []), ...(j.requirements || [])].filter(Boolean).join('\n');
  return {
    source: 'jobright',
    sourceId: j.jobId,
    title: j.jobTitle,
    company: c.companyName,
    location: j.jobLocation || (j.jobLocations || []).join('; '),
    salary: j.salaryDesc || null,
    url: `https://jobright.ai/jobs/info/${j.jobId}`,
    postedAt: j.publishTime ? new Date(j.publishTime.replace(' ', 'T') + 'Z') : new Date(),
    workplace: j.workModel,
    remote: j.workModel ? j.workModel === 'Remote' : j.isRemote,
    description: summary,
  };
}

async function fetchDescription(jobId) {
  const $ = cheerio.load(await getText(`https://jobright.ai/jobs/info/${jobId}`));
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const d = JSON.parse($(el).text());
      if (d['@type'] === 'JobPosting' && d.description) return htmlToText(d.description);
    } catch { /* ignore */ }
  }
  return '';
}

/** @type {import('../run.js').Source} */
const jobright = {
  name: 'jobright',
  label: 'Jobright',
  async fetchJobs({ known, prefilter, reject, log }) {
    const listing = new Map();
    for (const q of QUERIES) {
      for (let p = 0; p < MAX_PAGES_PER_QUERY; p++) {
        let rows;
        try { rows = await search(q, p * PAGE_SIZE); } catch (e) { log(`search "${q}": ${e.message}`); break; }
        rows.map(toJob).forEach((j) => j.sourceId && listing.set(j.sourceId, j));
        await sleep(GAP_MS);
        if (rows.length < PAGE_SIZE) break;
      }
    }

    const candidates = [];
    for (const job of listing.values()) {
      if (known.has(job.sourceId)) continue;
      const pre = prefilter(job);
      if (!pre.ok) { reject(job, pre.reason); continue; }
      candidates.push(job);
    }
    candidates.sort((a, b) => b.postedAt - a.postedAt);

    const out = [];
    for (const [i, job] of candidates.entries()) {
      if (i < MAX_DETAIL_FETCHES) {
        try {
          const full = await fetchDescription(job.sourceId);
          if (full) job.description = full;
        } catch (e) { log(`detail ${job.sourceId}: ${e.message}`); }
        await sleep(1200);
      }
      // Beyond the cap, the listing summary is used for the rule check.
      out.push(job);
    }
    return out;
  },
};

export default jobright;
