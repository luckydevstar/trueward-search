// Adzuna official API. Free keys at https://developer.adzuna.com/ -> set ADZUNA_APP_ID / ADZUNA_APP_KEY.
// Adzuna has no remote flag, so queries include "remote" and the shared rules check the text.
// Descriptions are ~500-char snippets, so on-site interview wording deeper in a posting can't be seen.
import { getJson, sleep } from './util.js';

const QUERIES = ['remote software engineer', 'remote software developer', 'remote full stack developer', 'remote frontend developer', 'remote backend developer'];
const PAGES = 2;

export default {
  name: 'adzuna',
  label: 'Adzuna',
  enabled: () => Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
  disabledReason: 'Set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env (free at developer.adzuna.com)',
  async fetchJobs({ log }) {
    const jobs = new Map();
    for (const what of QUERIES) {
      for (let page = 1; page <= PAGES; page++) {
        const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?` + new URLSearchParams({
          app_id: process.env.ADZUNA_APP_ID,
          app_key: process.env.ADZUNA_APP_KEY,
          what, results_per_page: '50', sort_by: 'date', max_days_old: '3',
        });
        let res;
        try { res = await getJson(url); } catch (e) { log(`"${what}" p${page}: ${e.message}`); break; }
        for (const r of res.results || []) {
          jobs.set(String(r.id), {
            source: 'adzuna',
            sourceId: String(r.id),
            title: stripTags(r.title),
            company: r.company?.display_name,
            location: [r.location?.display_name, ...(r.location?.area || []).slice(0, 1)].filter(Boolean).join(', '),
            country: 'US',
            salary: r.salary_min ? `$${Math.round(r.salary_min)}${r.salary_max && r.salary_max !== r.salary_min ? `–$${Math.round(r.salary_max)}` : ''}` : null,
            url: r.redirect_url,
            postedAt: r.created,
            description: stripTags(r.description),
          });
        }
        if ((res.results || []).length < 50) break;
        await sleep(500);
      }
    }
    return [...jobs.values()];
  },
};

const stripTags = (s = '') => s.replace(/<[^>]+>/g, '').trim();
