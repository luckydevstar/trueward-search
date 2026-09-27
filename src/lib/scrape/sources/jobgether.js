// Jobgether's own frontend search API (no login; needs a browser User-Agent or Cloudflare returns 403).
// Every result is "Full Remote". 50 per page, max 10 pages, sort=date gives newest first.
// The listing has no description, so each new candidate's offer page is fetched for its JSON-LD
// description, which is where hybrid / on-site interview wording would appear.
import { getJson, getText, htmlToText, mapLimit, sleep, cheerio } from './util.js';

const MAX_PAGES = 6;
const MAX_DETAIL_FETCHES = Number(process.env.JOBGETHER_MAX_DETAILS || 150);
const MAX_AGE_MS = 3 * 864e5;

const searchUrl = (page) =>
  'https://jobgether.com/astroapi/offer/search?' +
  new URLSearchParams({ locations: 'united-states', jobReferences: 'it-development', sort: 'date', page: String(page) });

function toJob(o) {
  const s = o.salary;
  return {
    source: 'jobgether',
    sourceId: o._id,
    title: o.title,
    company: o.companyData?.name,
    location: o.requiredLocations || (o.countries || []).map((c) => c.name || c.slug).join(', '),
    salary: s?.min ? `${s.currency || '$'}${s.min}${s.max ? `–${s.max}` : ''}` : null,
    url: o.applyUrl || `https://jobgether.com/offer/${o.slug}`,
    detailUrl: `https://jobgether.com/offer/${o.slug}`,
    postedAt: o.createdAt,
    workplace: o.remoteOfferType,
    remote: o.remoteOfferType ? /full remote/i.test(o.remoteOfferType) : undefined,
  };
}

async function fetchDescription(detailUrl) {
  const html = await getText(detailUrl);
  const $ = cheerio.load(html);
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const posting = [].concat(data['@graph'] || data).find((d) => d['@type'] === 'JobPosting');
      if (posting?.description) return htmlToText(posting.description);
    } catch { /* ignore malformed blocks */ }
  }
  return '';
}

/** @type {import('../run.js').Source} */
const jobgether = {
  name: 'jobgether',
  label: 'Jobgether',
  async fetchJobs({ known, prefilter, reject, log }) {
    const listing = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await getJson(searchUrl(page), { headers: { Referer: 'https://jobgether.com/search-offers' } });
      const data = res.data || [];
      listing.push(...data.map(toJob));
      const oldest = data.at(-1)?.createdAt;
      if (!data.length || page >= (res.maxPages || 10) || (oldest && Date.now() - Date.parse(oldest) > MAX_AGE_MS)) break;
      await sleep(1000);
    }

    const candidates = [];
    for (const job of listing) {
      if (known.has(job.sourceId)) continue;
      const pre = prefilter(job);
      if (!pre.ok) { reject(job, pre.reason); continue; }
      candidates.push(job);
    }
    const batch = candidates.slice(0, MAX_DETAIL_FETCHES);
    if (candidates.length > batch.length) log(`${candidates.length - batch.length} jobs deferred to next run`);

    const results = await mapLimit(batch, 2, async (job) => {
      await sleep(1000);
      return { ...job, description: await fetchDescription(job.detailUrl) };
    });
    return results.map((r, i) => {
      if (!r?.error) return r;
      log(`detail ${batch[i].sourceId}: ${r.error.message}`);
      return null;
    }).filter(Boolean);
  },
};

export default jobgether;
