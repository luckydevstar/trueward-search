// LinkedIn public (logged-out) job search. The guest endpoints ignore the remote filter (f_WT=2)
// and list office cities as locations, so each new job's detail page is fetched and its
// description checked by the shared rules. Detail fetches are capped per run to stay under
// LinkedIn's guest rate limit; unchecked jobs are picked up on the next run.
import { getText, htmlToText, parseRelative, mapLimit, sleep, cheerio } from './util.js';

const QUERIES = [
  'remote software engineer',
  'remote software developer',
  'remote full stack developer',
  'remote frontend developer',
  'remote backend engineer',
];
const PAGES_PER_QUERY = 4; // 10 results per page
const MAX_DETAIL_FETCHES = Number(process.env.LINKEDIN_MAX_DETAILS || 120);

const searchUrl = (keywords, start) =>
  'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?' +
  new URLSearchParams({
    keywords, location: 'United States', geoId: '103644278',
    f_WT: '2', f_TPR: 'r86400', sortBy: 'DD', start: String(start),
  });

function parseCards(html) {
  const $ = cheerio.load(html);
  return $('div.base-card[data-entity-urn]').map((_, el) => {
    const c = $(el);
    const id = c.attr('data-entity-urn').split(':').pop();
    const time = c.find('time');
    const rel = parseRelative(time.text());
    const date = time.attr('datetime');
    return {
      source: 'linkedin',
      sourceId: id,
      title: c.find('.base-search-card__title').text().trim(),
      company: c.find('.base-search-card__subtitle').text().trim(),
      location: c.find('.job-search-card__location').text().trim(),
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      // Relative text ("3 hours ago") is more precise than the date-only attribute.
      postedAt: rel ?? (date ? new Date(date) : new Date()),
    };
  }).get();
}

export default {
  name: 'linkedin',
  label: 'LinkedIn',
  async fetchJobs({ known, prefilter, reject, log }) {
    const cards = new Map();
    for (const q of QUERIES) {
      for (let p = 0; p < PAGES_PER_QUERY; p++) {
        let html;
        try { html = await getText(searchUrl(q, p * 10)); } catch (e) { log(`search "${q}" p${p}: ${e.message}`); break; }
        const found = parseCards(html);
        found.forEach((j) => cards.set(j.sourceId, j));
        if (found.length < 10) break;
        await sleep(700);
      }
    }

    const candidates = [];
    for (const job of cards.values()) {
      if (known.has(job.sourceId)) continue;
      // LinkedIn listings show an office city even for remote roles, so only the title is checked here.
      const pre = prefilter(job, { checkLocation: false });
      if (!pre.ok) { reject(job, pre.reason); continue; }
      candidates.push(job);
    }
    const batch = candidates.slice(0, MAX_DETAIL_FETCHES);
    if (candidates.length > batch.length) log(`${candidates.length - batch.length} jobs deferred to next run`);

    const results = await mapLimit(batch, 2, async (job) => {
      await sleep(600);
      const html = await getText(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${job.sourceId}`);
      const $ = cheerio.load(html);
      const description = htmlToText($('.show-more-less-html__markup').html() || $('.description__text').html() || '');
      // remote stays undefined: the rules then require the title/description to say "remote"
      // and contain no hybrid / on-site wording.
      return { ...job, description };
    });
    const out = [];
    results.forEach((r, i) => {
      if (r?.error) log(`detail ${batch[i].sourceId}: ${r.error.message}`);
      else out.push(r);
    });
    return out;
  },
};
