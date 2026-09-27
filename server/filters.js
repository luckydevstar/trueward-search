// Rules every job must pass before it is stored:
//   1. Software-developer relevant (judged by title)
//   2. Fully remote (no hybrid / on-site, no on-site interview step)
//   3. Open to US-based candidates
// Each check returns { ok, reason } so rejections can be logged and debugged.

const INCLUDE_TITLE = [
  /\bsoftware\s+(engineer|developer|development engineer|dev|architect|programmer|craftsman)/i,
  /\b(product|founding|forward deployed)\s+engineer/i,
  /\bmember of technical staff\b/i,
  /\bdevelopers?\b/i,
  /\bprogrammer\b/i,
  /\b(front|back)[\s-]?end\b/i,
  /\bfull[\s-]?stack\b/i,
  /\bweb (engineer|dev)/i,
  /\b(ios|android|mobile|react native|flutter)\b.*\b(engineer|dev)/i,
  /\b(sde|swe|sdet)\b/i,
  /\b(javascript|typescript|node(\.?js)?|react|angular|vue|python|java|golang|go|ruby|rails|php|laravel|\.net|c#|c\+\+|rust|scala|kotlin|swift|elixir|django)\b.*\b(engineer|dev)/i,
  /\b(platform|application|applications|api|cloud|devops|site reliability|infrastructure|systems|integration|blockchain|smart contract|game|embedded software)\s+(engineer|developer)/i,
  /\b(ml|machine learning|ai)\s+(engineer|developer)/i,
  /\bsre\b/i,
];

// Titles that match an include pattern but are not software-development roles.
const EXCLUDE_TITLE = [
  /\b(sales|pre-?sales|solutions?|support|customer|field|service|network|electrical|mechanical|civil|structural|chemical|hardware|manufacturing|process|quality assurance manager|test technician|validation)\s+engineer/i,
  /\b(business|market|real estate|property|land|leasing|residential|brand|content|course|curriculum|workforce)\s+develop/i,
  /\bdevelopment (representative|manager|director|associate|specialist)\b/i,
  /\b(recruiter|recruiting|talent|sourcer|account executive|marketing|designer|writer|teacher|tutor|nurse|attorney|paralegal)\b/i,
  /\b(instructor|trainer|professor|lecturer)\b/i,
  /\b(specialist|consultant|analyst|manager|director|vice president|vp|head of|coordinator|administrator|intern|internship)\b/i,
];

export function isSoftwareRole(title = '') {
  const t = title.replace(/\s+/g, ' ');
  if (EXCLUDE_TITLE.some((re) => re.test(t))) return { ok: false, reason: 'title-excluded' };
  if (INCLUDE_TITLE.some((re) => re.test(t))) return { ok: true };
  return { ok: false, reason: 'title-not-software' };
}

// Phrases that disqualify a job. Written to avoid tech jargon such as
// "hybrid cloud" or "hybrid app" and harmless mentions like "no office".
const NOT_REMOTE_PATTERNS = [
  // "hybrid" only counts when it describes the work arrangement (not "hybrid cloud", "hybrid retrieval", ...).
  /\bhybrid\s+(role|position|work|working|schedule|model|arrangement|capacity|environment(?!s)|opportunity|basis|setting|policy|job|remote|office|home|workplace|team member)\b/i,
  /\b(is|as|be|being|considered|categorized as|designated as)\s+(a\s+)?hybrid\b(?!\s+(cloud|apps?|mobile|infrastructure|architecture|solution|approach|system|platform|model of))/i,
  /(^|[-–|(,:;•])\s*hybrid\s*($|[)\-–:,;(|]|\d|\s+(in|at|from|with|or)\s+[A-Z])/im,
  /\bhybrid\s*(\(\s*\d|:)/i,
  /\bon[\s-]?site\b(?!\s+(visits? (to|with) (customers|clients))(?!.*required))/i,
  /\bin[\s-]office\b/i,
  /\bin[\s-]person\s+(interview|interviews|meeting|onboarding|orientation|work|role|position|attendance|presence|collaboration|requirement)/i,
  /\bwork(ing)?\s+(together\s+)?in[\s-]person\b/i,
  /\b\d\s*(\+\s*)?(or more\s+)?days?\s+(a|per|each|every)\s+week\s+(in|at|from)\s+(the|our|an?)\s+(office|campus|hub|studio|location)/i,
  /\b(report|commute|come)\s+(in)?to\s+(the|our|an?)\s+(office|campus|hub)/i,
  /\bmust\s+(be\s+able\s+to\s+)?(commute|relocate)\b/i,
  /\brelocation\s+(is\s+)?required\b/i,
  /\boffice[\s-]based\b/i,
  /\b(return|returning)\s+to\s+(the\s+)?office\b/i,
  /\bnot\s+(a\s+)?(fully\s+)?remote\b/i,
  /\bremote\s+(is\s+)?not\s+(available|possible|an option)\b/i,
];

// A small set of phrases that negate the matches above ("no onsite interviews",
// "not hybrid"). If one of these appears we strip it before testing.
const NEGATED_PHRASES = [
  /\b(no|not|never|without|zero)\s+(any\s+)?(on[\s-]?site|in[\s-]office|in[\s-]person|hybrid|office visits?|relocation)\b[^.]{0,40}/gi,
  /\b(100%|fully|completely|entirely)\s+remote\s*(,|\(|-|–)?\s*(no|not)\s+(hybrid|on[\s-]?site)\b/gi,
  // "remote or hybrid", "remote, hybrid, or in-person is OK", "hybrid or remote": remote is an allowed option.
  /\b(fully\s+)?remote\s*(,|\/|or|and)\s*(\w+\s*(,|\/)\s*)?(or\s+)?(a\s+)?(hybrid|on[\s-]?site|in[\s-]person|in[\s-]office|office[\s-]based)\b(\s+(is|are)\s+(ok|fine|welcome))?/gi,
  /\b(hybrid|on[\s-]?site|in[\s-]office|office[\s-]based)\s*(,|\/|or)\s*(fully\s+)?remote\b/gi,
  /\b(welcome|free|option(al)?|opportunity)\s+to\s+(work\s+)?(in\s+)?(a\s+)?(hybrid|in[\s-]office|on[\s-]?site)\b[^.]{0,40}/gi,
  /\boptional\s+(in[\s-]office|in[\s-]person|on[\s-]?site)\b[^.]{0,40}/gi,
  /\(remote\)\s*(,|or|\/)?\s*([\w .]+\((hybrid|on[\s-]?site)\)\s*(,|or)?\s*)+/gi,
  /\bwhether\s+you('|’)?re\s+remote\s+or\s+[\w-]+/gi,
];

export function findNotRemoteSignal(text = '') {
  if (!text) return null;
  let t = text.replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ');
  for (const re of NEGATED_PHRASES) t = t.replace(re, ' ');
  for (const re of NOT_REMOTE_PATTERNS) {
    const m = t.match(re);
    if (m) {
      const i = m.index ?? 0;
      return t.slice(Math.max(0, i - 60), i + m[0].length + 60).trim();
    }
  }
  return null;
}

/**
 * @param job normalized job; `remote` is the source's own claim
 *            (true = source says remote, false = source says not remote, undefined = unknown)
 */
export function isFullyRemote(job) {
  if (job.remote === false) return { ok: false, reason: 'source-says-not-remote' };
  const hay = [job.title, job.location, job.workplace, job.description].filter(Boolean).join('\n');
  const signal = findNotRemoteSignal(hay);
  if (signal) return { ok: false, reason: `not-remote: "${signal}"` };
  if (job.remote === true) return { ok: true };
  // Source did not tell us. Require the word "remote" somewhere.
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\btelecommute/i.test(hay)) return { ok: true };
  return { ok: false, reason: 'remote-unknown' };
}

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
];
const STATE_ABBR =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';

const US_RE = new RegExp(
  [
    '\\bUnited States\\b', '\\bU\\.?S\\.?A\\.?\\b', '\\bU\\.S\\.?\\b', '\\bUS\\b', '\\bAmericas?\\b',
    '\\bNorth America\\b', `,\\s*(${STATE_ABBR})\\b`, `\\b(${US_STATES.join('|')})\\b`,
  ].join('|'),
);

// Locations that, when they are the ONLY thing listed, mean non-US.
const NON_US_RE =
  /\b(canada|mexico|brazil|argentina|colombia|chile|peru|latam|latin america|uk|united kingdom|england|ireland|europe|emea|eu|germany|france|spain|portugal|netherlands|poland|romania|ukraine|india|pakistan|philippines|apac|asia|australia|new zealand|singapore|japan|israel|africa|nigeria|kenya|egypt|turkey|vietnam|indonesia|malaysia|china)\b/i;

export function isUS(job) {
  const loc = (job.location || '').trim();
  if (job.country && /^(us|usa|united states)$/i.test(job.country)) return { ok: true };
  if (US_RE.test(loc)) return { ok: true };
  if (/\b(worldwide|anywhere|global)\b/i.test(loc) && !NON_US_RE.test(loc)) return { ok: true };
  if (!loc || /^remote$/i.test(loc)) {
    // No location info. Fall back to the description; accept only if it mentions the US.
    return US_RE.test(job.description || '') ? { ok: true } : { ok: false, reason: 'location-unknown' };
  }
  return { ok: false, reason: `non-us-location: ${loc}` };
}

export function applyRules(job) {
  for (const check of [isSoftwareRole(job.title), isUS(job), isFullyRemote(job)]) {
    if (!check.ok) return check;
  }
  return { ok: true };
}
