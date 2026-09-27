import * as cheerio from 'cheerio';

export const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch with browser-like headers, timeout and retry on 429/5xx. */
export async function http(url, { headers = {}, retries = 2, timeout = 25000, ...opts } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        ...opts,
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          ...headers,
        },
      });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(2000 * (attempt + 1) ** 2);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      if (attempt >= retries || err.message?.startsWith('HTTP ')) throw err;
      await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
}

export const getText = async (url, opts) => (await http(url, opts)).text();
export const getJson = async (url, opts) =>
  (await http(url, { ...opts, headers: { Accept: 'application/json', ...opts?.headers } })).json();

/** HTML -> readable plain text. */
export function htmlToText(html = '') {
  if (!html) return '';
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $('script,style').remove();
  $('br').replaceWith('\n');
  $('p,li,div,h1,h2,h3,h4,h5,h6,tr').each((_, el) => { $(el).append('\n'); });
  return $('#__root').text().replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** "3 hours ago", "2 days ago", "Just now", "30+ days ago" -> Date. Returns null when unparseable. */
export function parseRelative(text, now = Date.now()) {
  if (!text) return null;
  const t = text.toLowerCase().trim();
  if (/just now|moments? ago|today|few seconds/.test(t)) return new Date(now);
  if (/yesterday/.test(t)) return new Date(now - 864e5);
  const m = t.match(/(\d+)\+?\s*(second|sec|minute|min|hour|hr|h|day|d|week|wk|w|month|mo)s?\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = {
    second: 1e3, sec: 1e3, minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, h: 36e5,
    day: 864e5, d: 864e5, week: 6048e5, wk: 6048e5, w: 6048e5, month: 2592e6, mo: 2592e6,
  }[m[2]];
  return new Date(now - n * unit);
}

/** Run async fn over items with limited concurrency. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { error: e }; }
      }
    }),
  );
  return out;
}

export { cheerio };
