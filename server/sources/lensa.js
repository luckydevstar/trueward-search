// Lensa's own frontend JSON API (no login). Its SEO page supplies a trace id; without one the
// API returns apply_url "/404". Results are unsorted (random order, capped at 500 per query) and
// there is no date filter, so each query is paged through fully and filtered on posted_at.
// Full descriptions come from a second, batchable endpoint.
import { http, getText, htmlToText, sleep } from './util.js';

const QUERIES = ['Software Engineer', 'Software Developer', 'Full Stack Developer', 'Frontend Developer', 'Backend Developer'];
const PAGE_SIZE = 20;
const MAX_PAGES = 25; // 500-result cap
const MAX_AGE_MS = 3 * 864e5;

const post = async (path, body) =>
  (await http(`https://lensa.com${path}`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: 'https://lensa.com', Referer: 'https://lensa.com/remote-software-developer-jobs' },
  })).json();

async function getTraceId() {
  const html = await getText('https://lensa.com/remote-software-developer-jobs');
  const m = html.match(/siteJobListGenerationTraceId"?\s*:\s*"([^"]+)/);
  if (!m) throw new Error('Lensa trace id not found (page layout changed?)');
  return m[1];
}

function toJob(j) {
  return {
    source: 'lensa',
    sourceId: j.id,
    title: j.title?.cleaned_title || j.title?.title,
    company: j.company?.name,
    // Remote jobs show "Remote, Remote"; Lensa is a US job board, so treat country as US.
    location: j.location?.display_name?.replace(/^Remote, Remote$/, 'Remote (US)'),
    country: 'US',
    salary: j.predicted_salary?.display_value || null,
    url: j.apply_url?.startsWith('/') && j.apply_url !== '/404' ? `https://lensa.com${j.apply_url}` : null,
    postedAt: j.posted_at,
    remote: j.location_type?.is_remote,
    description: j.description,
    _detailKey: {
      global_trace_id: j.global_trace_id,
      job_pool_specific_description_based_id: j.job_pool_specific_description_based_id,
      remote_id: j.remote_id,
      application_intent_enabled: j.application_intent_enabled,
    },
  };
}

export default {
  name: 'lensa',
  label: 'Lensa',
  async fetchJobs({ known, prefilter, reject, log }) {
    const trace = await getTraceId();
    const listing = new Map();
    for (const position of QUERIES) {
      let searchParams = { location: null, position: [position], remote_jobs: 'only' };
      for (let page = 0; page < MAX_PAGES; page++) {
        let res;
        try {
          res = await post('/jlp/api/more-jobs', { searchParams, limit: PAGE_SIZE, globalTraceId: trace, pageType: 'two-pane-seo-job-search' });
        } catch (e) { log(`"${position}" p${page}: ${e.message}`); break; }
        const rows = res.standardRecommendedJobs || [];
        for (const j of rows) {
          if (Date.now() - Date.parse(j.posted_at) > MAX_AGE_MS) continue;
          const job = toJob(j);
          if (job.url && job.title) listing.set(job.sourceId, job);
        }
        searchParams = res.searchParamsForPaging;
        const st = searchParams?.apiStates?.rnd;
        if (!rows.length || !st || st.offset >= st.total) break;
        await sleep(400);
      }
    }

    const candidates = [];
    for (const job of listing.values()) {
      if (known.has(job.sourceId)) continue;
      const pre = prefilter(job);
      if (!pre.ok) { reject(job, pre.reason); continue; }
      candidates.push(job);
    }

    // Full descriptions, 10 per request.
    for (let i = 0; i < candidates.length; i += 10) {
      const batch = candidates.slice(i, i + 10);
      try {
        const res = await post('/jlp/api/traffic-jobs', {
          jobsRequestBody: batch.map((j) => j._detailKey), enableCompanyCardData: 'enabled', enableTrafficJobData: 'enabled',
        });
        res.forEach((r, k) => {
          const html = r?.trafficJob?.description?.cleaned_full_html_description;
          if (html && batch[k]) batch[k].description = htmlToText(html);
          if (r?.trafficJob?.is_expired && batch[k]) batch[k].expired = true;
        });
      } catch (e) { log(`descriptions batch ${i / 10}: ${e.message}`); }
      await sleep(500);
    }
    return candidates.filter((j) => !j.expired);
  },
};
