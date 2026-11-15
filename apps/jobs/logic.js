// Jobs: the parts without a screen (statuses, reading a shared link or a
// pasted posting, reminders). Kept apart from app.js so they can be tested
// in Node.

/** Where a job is in the search. The order is the pipeline. */
export const STATUSES = [
  { id: 'found', label: 'To judge', short: 'To judge' },
  { id: 'saved', label: 'Interesting, not applied yet', short: 'Saved' },
  { id: 'applied', label: 'Applied', short: 'Applied' },
  { id: 'interview', label: 'Interviewing', short: 'Interview' },
  { id: 'offer', label: 'Offer', short: 'Offer' },
  { id: 'rejected', label: 'Rejected', short: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn by me', short: 'Withdrawn' },
  { id: 'dismissed', label: 'Not interesting', short: 'Not for me' },
];

export const STATUS_IDS = STATUSES.map((s) => s.id);

export function statusLabel(id, short = false) {
  const s = STATUSES.find((x) => x.id === id);
  return s ? (short ? s.short : s.label) : id;
}

/** The tabs of the main screen and which statuses each one shows. */
export const VIEWS = [
  { id: 'judge', label: 'To judge', statuses: ['found'] },
  { id: 'saved', label: 'Saved', statuses: ['saved'] },
  { id: 'active', label: 'Applied', statuses: ['applied', 'interview', 'offer'] },
  { id: 'closed', label: 'Closed', statuses: ['rejected', 'withdrawn', 'dismissed'] },
];

export function viewOf(status) {
  return VIEWS.find((v) => v.statuses.includes(status))?.id ?? 'judge';
}

/** Quick reasons offered when judging a job. They are kept with the job so
 *  that a later search can learn from them. */
export const REASONS_YES = ['Tech stack', 'Domain', 'Role', 'Company', 'Location', 'Workload', 'Salary', 'Growth'];
export const REASONS_NO = [
  'Wrong tech',
  'Too junior',
  'Too senior',
  'Domain',
  'Location / commute',
  'Workload',
  'Salary',
  'Company',
  'Agency / recruiter',
  'Language',
];

/** Days after applying until the app suggests following up. */
export const FOLLOW_UP_DAYS = 10;

// ---- reading a link or a posting ------------------------------------------------

const SOURCES = [
  [/(^|\.)jobs\.ch$/, 'jobs.ch'],
  [/(^|\.)jobup\.ch$/, 'jobup.ch'],
  [/(^|\.)jobscout24\.ch$/, 'JobScout24'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/(^|\.)indeed\.(com|ch)$/, 'Indeed'],
  [/(^|\.)glassdoor\.(com|ch)$/, 'Glassdoor'],
  [/(^|\.)xing\.com$/, 'XING'],
  [/(^|\.)stepstone\.(ch|de)$/, 'StepStone'],
  [/(^|\.)swissdevjobs\.ch$/, 'SwissDevJobs'],
  [/(^|\.)monster\.(ch|com)$/, 'Monster'],
  [/(^|\.)topjobs\.ch$/, 'topjobs.ch'],
  [/(^|\.)ictjobs\.ch$/, 'ictjobs.ch'],
  [/(^|\.)greenhouse\.io$/, 'Company site'],
  [/(^|\.)lever\.co$/, 'Company site'],
  [/(^|\.)workday(jobs)?\.com$|myworkdayjobs\.com$/, 'Company site'],
  [/(^|\.)successfactors\.(com|eu)$/, 'Company site'],
  [/(^|\.)smartrecruiters\.com$/, 'Company site'],
];

/** The first http(s) link in a piece of text, without trailing punctuation. */
export function findUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return '';
  return match[0].replace(/[).,;:!?\]]+$/, '');
}

/** A readable name for where a link points (job board or "Company site"). */
export function sourceOf(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
  for (const [pattern, name] of SOURCES) if (pattern.test(host)) return name;
  return host;
}

/** A link without tracking parameters, so the same job is recognised again. */
export function cleanUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return String(url ?? '').trim();
  }
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|ref|refid|trk|trackingid|src|source|campaign|mc_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = '';
  return u.toString();
}

/** Workload as written in Swiss postings: "80%", "80-100%", "80 – 100 %", "Pensum 100%". */
export function findWorkload(text) {
  const t = String(text ?? '');
  const range = t.match(/\b(\d{2,3})\s*%?\s*(?:-|–|—|bis|to)\s*(\d{2,3})\s*%/i);
  if (range && Number(range[1]) <= 100 && Number(range[2]) <= 100) return `${range[1]}–${range[2]}%`;
  const single = t.match(/\b(\d{2,3})\s*%/);
  if (single && Number(single[1]) >= 10 && Number(single[1]) <= 100) return `${single[1]}%`;
  return '';
}

/**
 * Turn what was shared or pasted into the fields of a new job. Android's
 * share sheet sends a title, a text and a url, and job boards fill them in
 * differently (some put the link into the text), so all three are read.
 */
export function fromShared({ title = '', text = '', url = '' } = {}) {
  const link = cleanUrl(findUrl(url) || findUrl(text) || findUrl(title));
  const rest = String(text ?? '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '')
    .trim();
  let jobTitle = String(title ?? '').replace(/https?:\/\/\S+/gi, '').trim();
  if (!jobTitle) jobTitle = rest.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  let company = '';
  // Common share titles: "Title - Company - jobs.ch", "Title | Company", "Company hiring Title in Place | LinkedIn"
  const hiring = jobTitle.match(/^(.+?)\s+(?:is hiring|hiring|sucht)\s+(?:a\s+)?(.+?)(?:\s+in\s+.+?)?(?:\s*\|\s*LinkedIn)?$/i);
  if (hiring) {
    company = hiring[1].trim();
    jobTitle = hiring[2].trim();
  } else {
    const parts = jobTitle
      .split(/\s+[|–—-]\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p) => !SOURCES.some(([, name]) => name.toLowerCase() === p.toLowerCase()) && !/^(linkedin|indeed|jobs\.ch|jobup\.ch)$/i.test(p));
    if (parts.length >= 2) {
      jobTitle = parts[0];
      company = parts[1];
    } else if (parts.length === 1) jobTitle = parts[0];
  }
  return {
    title: jobTitle.slice(0, 200),
    company: company.slice(0, 120),
    url: link,
    source: link ? sourceOf(link) : '',
    workload: findWorkload(`${title}\n${text}`),
    description: rest.length > 40 ? rest : '',
  };
}

/** An existing job with the same link, if any. */
export function findDuplicate(jobs, url) {
  if (!url) return null;
  const clean = cleanUrl(url);
  return jobs.find((j) => j.url && cleanUrl(j.url) === clean) ?? null;
}

// ---- changing status ----------------------------------------------------------

/**
 * The fields to store when a job moves to another status: the change is
 * added to its history, and applying sets the date and a follow-up.
 */
export function moveTo(job, status, today) {
  if (!STATUS_IDS.includes(status)) throw new Error(`Unknown status: ${status}`);
  if (job.status === status) return { ...job };
  const next = { ...job, status, history: [...(job.history ?? []), { status, date: today }] };
  if (status === 'applied' && !next.appliedOn) {
    next.appliedOn = today;
    if (!next.followUpOn) next.followUpOn = addDays(today, FOLLOW_UP_DAYS);
  }
  if (['rejected', 'withdrawn', 'dismissed', 'offer'].includes(status)) next.followUpOn = '';
  return next;
}

/** Jobs whose follow-up date has come, oldest first. */
export function dueFollowUps(jobs, today) {
  return jobs
    .filter((j) => j.followUpOn && j.followUpOn <= today && ['applied', 'interview'].includes(j.status))
    .sort((a, b) => a.followUpOn.localeCompare(b.followUpOn));
}

/** How a view is sorted: newest first, except applications by next step. */
export function sortForView(view, jobs) {
  const list = [...jobs];
  if (view === 'active') {
    const rank = { offer: 0, interview: 1, applied: 2 };
    return list.sort(
      (a, b) =>
        (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
        (a.followUpOn || '9999').localeCompare(b.followUpOn || '9999') ||
        (b.appliedOn || '').localeCompare(a.appliedOn || ''),
    );
  }
  return list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/** Counts of judged jobs per reason, a first look at what matters. */
export function reasonCounts(jobs) {
  const yes = {};
  const no = {};
  for (const j of jobs) {
    const target = j.verdict === 'yes' ? yes : j.verdict === 'no' ? no : null;
    if (!target) continue;
    for (const r of j.reasons ?? []) target[r] = (target[r] ?? 0) + 1;
  }
  return { yes, no };
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a, b) {
  const toUTC = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

// ---- importing many jobs from a copied results page -------------------------

const JOB_LINK = [
  [/(^|\.)jobs\.ch$/, /\/vacancies\/detail\/|\/stellenangebote\/detail\/|\/offres-emplois\/detail\//],
  [/(^|\.)jobup\.ch$/, /\/detail\//],
  [/(^|\.)linkedin\.com$/, /\/jobs\/view\//],
  [/(^|\.)indeed\.(com|ch)$/, /\/viewjob|\/rc\/clk|\/pagead\/clk|[?&]jk=/],
  [/(^|\.)jobagent\.ch$/, /\/job\/\d|\/jobs?\/[^/?]+-\d{4,}/],
  [/(^|\.)glassdoor\.(com|ch)$/, /job-listing|\/partner\/joblisting/],
];
const SKIP_TEXT = /^(apply|bewerben|save|speichern|merken|details?|mehr|more|show more|view|ansehen|share|teilen|new|neu|easy apply|promoted)$/i;

function entities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function plain(html) {
  return entities(String(html ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is this link a job posting (not navigation, filters, company pages)? */
export function isJobLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname + u.search;
  for (const [h, pattern] of JOB_LINK) if (h.test(host)) return pattern.test(path);
  return /\d{5,}/.test(u.pathname) || /\/(jobs?|stellen\w*|vacanc\w*|positions?|offres?|career\w*|karriere)\/[^/]+/i.test(u.pathname);
}

/**
 * Jobs in a copied results page. Copying a page in the browser gives HTML
 * with the links; each job link becomes one job, its text the title. Plain
 * text (no HTML) still works for lists of links: each link is a job, the
 * line before it the title.
 */
export function jobsFromPaste({ html = '', text = '' } = {}) {
  const byUrl = new Map();
  const add = (url, title) => {
    const clean = cleanUrl(entities(url));
    if (!isJobLink(clean)) return;
    title = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (title.length > 160 || SKIP_TEXT.test(title)) title = '';
    const prev = byUrl.get(clean);
    if (!prev) byUrl.set(clean, { url: clean, title, source: sourceOf(clean) });
    else if (title && (!prev.title || (prev.title.length < 6 && title.length > prev.title.length))) prev.title = title;
  };
  if (html) {
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const inner = m[2];
      const label = plain(inner) || (inner.match(/aria-label="([^"]+)"/i) || [])[1] || '';
      add(m[1], label);
    }
  }
  if (!byUrl.size) {
    const lines = String(text ?? '').split(/\r?\n/);
    let last = '';
    for (const line of lines) {
      const url = findUrl(line);
      const rest = line.replace(/https?:\/\/\S+/g, '').trim();
      if (url) add(url, rest || last);
      else if (line.trim()) last = line.trim();
    }
  }
  return [...byUrl.values()].map((j) => ({ ...j, ...splitTitle(j.title) }));
}

/** "Software Engineer - Example AG" -> title and company, when the share title had both. */
function splitTitle(title) {
  if (!title) return { title: '', company: '' };
  const parsed = fromShared({ title });
  return { title: parsed.title || title, company: parsed.company };
}
