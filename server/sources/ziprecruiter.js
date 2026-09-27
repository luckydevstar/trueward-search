// ZipRecruiter blocks scraping (Cloudflare challenge on every www page; robots.txt disallows all).
// It does publish an official, read-only, no-auth MCP server (advertised in /llms.txt), used here.
// Limits: 5 jobs per call and a strict rate limit (429 for ~5 minutes after ~3 quick calls), so
// only a few calls are made per refresh. No description is returned, so on-site interview
// wording can't be checked for this source; its own REMOTE filter and job_type are relied on.
import crypto from 'node:crypto';
import { http, sleep } from './util.js';

const ROLES = ['software engineer', 'software developer', 'full stack developer'];
const CALLS_PER_RUN = Number(process.env.ZIPRECRUITER_CALLS_PER_RUN || 3);

async function searchJobs(jobRole, offset) {
  const res = await http('https://api.ziprecruiter.com/mcp', {
    method: 'POST',
    retries: 0,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
      params: {
        name: 'search_jobs',
        arguments: { job_role: jobRole, location_types: ['REMOTE'], country_admin_code: 'US', max_posted_minutes_ago: 1440, offset },
      },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'MCP error');
  let sc = data.result?.structuredContent;
  if (!sc) {
    const text = data.result?.content?.find((c) => c.type === 'text')?.text;
    if (text) { const parsed = JSON.parse(text); sc = parsed.structuredContent || parsed; }
  }
  return sc?.results || [];
}

const stableId = (r) =>
  crypto.createHash('sha1').update(`${r.company}|${r.title}|${r.location}`.toLowerCase()).digest('hex').slice(0, 16);

export default {
  name: 'ziprecruiter',
  label: 'ZipRecruiter',
  async fetchJobs({ log }) {
    const jobs = [];
    let calls = 0;
    outer: for (let offset = 0; calls < CALLS_PER_RUN; offset += 5) {
      for (const role of ROLES) {
        if (calls >= CALLS_PER_RUN) break outer;
        calls++;
        let rows;
        try { rows = await searchJobs(role, offset); } catch (e) {
          log(`"${role}": ${e.message}`);
          if (/HTTP 429/.test(e.message)) {
            // Rate limited; the next refresh will try again.
            if (!jobs.length) throw new Error('Rate limited by ZipRecruiter (HTTP 429); will retry on next refresh');
            break outer;
          }
          continue;
        }
        for (const r of rows) {
          if (!r.is_remote) continue;
          const s = r.salary;
          jobs.push({
            source: 'ziprecruiter',
            sourceId: stableId(r),
            title: r.title,
            company: r.company,
            location: r.location,
            country: 'US',
            salary: s?.min_annual ? `$${Math.round(s.min_annual / 1000)}K${s.max_annual ? `–$${Math.round(s.max_annual / 1000)}K` : ''}` : null,
            url: r.job_redirect_url,
            postedAt: new Date(Date.now() - (r.days_ago || 0) * 864e5),
            workplace: r.job_type,
            remote: true,
            description: r.job_type,
          });
        }
        await sleep(3000);
      }
    }
    return jobs;
  },
};
