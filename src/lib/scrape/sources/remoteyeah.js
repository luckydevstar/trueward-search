// RemoteYeah only lists remote jobs. Its filtered RSS feed (dev titles + United States) holds
// roughly the last 3 days, newest first, with no pagination. The literal "+" in the URL matters:
// "%2B" makes the site silently return the unfiltered feed.
import { getText, htmlToText, cheerio } from './util.js';

const TITLES = [
  'software-engineer', 'backend-engineer', 'frontend-engineer', 'full-stack-engineer',
  'web-developer', 'mobile-engineer', 'devops-engineer',
];
const FEED = `https://remoteyeah.com/remote-${TITLES.join('+')}-jobs-in-united-states.xml`;

/** @type {import('../run.js').Source} */
const remoteyeah = {
  name: 'remoteyeah',
  label: 'RemoteYeah',
  async fetchJobs() {
    const xml = await getText(FEED);
    const $ = cheerio.load(xml, { xmlMode: true });
    return $('item').map((_, el) => {
      const it = $(el);
      const txt = (sel) => it.find(sel).first().text().trim();
      const company = txt('company');
      const title = txt('title').replace(/^Remote\s+/i, '').replace(new RegExp(`\\s+at\\s+${escapeRe(company)}$`, 'i'), '');
      const descHtml = txt('description');
      return {
        source: 'remoteyeah',
        sourceId: txt('guid'),
        title,
        company,
        location: txt('location'),
        url: txt('link').replace(/[?&]utm_source=rss&ref=rss$/, ''),
        postedAt: txt('pubDate'),
        description: htmlToText(descHtml),
        remote: true,
      };
    }).get();
  },
};

export default remoteyeah;


function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
