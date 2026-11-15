// Where to look for jobs: job boards and company career sites in
// Switzerland. The list below is the starting set; it is copied into
// jobs.json once and can then be edited in the app. New entries added here
// later reach the app too, but an entry deleted in the app stays deleted.
//
// access: how the source can be followed
//   'read'   robots.txt allows reading the listings; a later helper may read it
//   'feed'   the company's job system has a readable job search (Workday,
//            SuccessFactors, Greenhouse); a later helper may read it
//   'alert'  automation is not allowed; use the site's e-mail alert
//   'manual' look by hand
//   'check'  not checked yet
// star: a favourite, listed first (the ones marked ++ in my old list).
// Checked on 2026-11-15 (robots.txt, terms of use, careers page).

export const ACCESS = {
  read: 'Helper may read',
  feed: 'Job feed',
  alert: 'E-mail alert',
  manual: 'By hand',
  check: 'To check',
};

export const KINDS = [
  ['board', 'Job boards'],
  ['company', 'Company sites'],
];

const board = (id, name, url, field, access, notes = '') => ({ id: `seed:${id}`, kind: 'board', name, url, field, system: '', access, notes });
const company = (id, name, url, field, system, access, notes = '') => ({ id: `seed:${id}`, kind: 'company', name, url, field, system, access, notes });

export const DEFAULT_SOURCES = [
  // ---- job boards ----
  board('jobs-ch', 'jobs.ch', 'https://www.jobs.ch/en/vacancies/?term=software%20engineer&location=Z%C3%BCrich', 'Biggest Swiss board', 'alert', 'Terms ban crawlers, scrapers and bots.'),
  board('jobup', 'jobup.ch', 'https://www.jobup.ch/en/jobs/?term=software%20engineer', 'Same company as jobs.ch, strong in Romandie', 'alert'),
  board('linkedin', 'LinkedIn', 'https://www.linkedin.com/jobs/search/?keywords=software%20engineer&location=Z%C3%BCrich%2C%20Switzerland', 'International employers, recruiters', 'alert', 'Terms ban scraping.'),
  { ...board('jobagent', 'jobagent.ch', 'https://www.jobagent.ch/search?terms=software+engineer&provinces=ZH', 'Aggregator of company sites', 'alert', 'robots.txt blocks generic bots. E-mail alert: "Job-Abo".'), star: true },
  { ...board('job-room', 'job-room.ch', 'https://www.job-room.ch/', 'Federal job portal (arbeit.swiss)', 'manual', 'robots.txt blocks the job search.'), star: true },
  { ...board('talendo', 'talendo.ch', 'https://talendo.ch/en', 'Curated jobs, Zurich region', 'read', 'robots.txt allows, 10 s delay. Terms forbid aggregating without consent: personal use only.'), star: true },
  board('nzz', 'jobs.nzz.ch', 'https://jobs.nzz.ch/job/alle-jobs-im-kanton-Z%C3%BCrich', 'NZZ job board', 'read', 'robots.txt allows the listing pages.'),
  board('swissdevjobs', 'SwissDevJobs', 'https://swissdevjobs.ch/jobs/all/Zurich', 'Software only, with salary ranges', 'alert', 'robots.txt seems to block bots.'),
  board('indeed', 'Indeed', 'https://ch.indeed.com/jobs?q=software+engineer&l=Z%C3%BCrich', 'Aggregator', 'alert', 'Terms ban scraping.'),
  board('glassdoor', 'Glassdoor', 'https://www.glassdoor.ch/', 'Jobs, company reviews, salaries', 'manual'),
  board('ictcareer', 'ictcareer.ch', 'https://ictcareer.ch/de/', 'IT only', 'check'),
  board('ictjobs', 'ictjobs.ch', 'https://www.ictjobs.ch/', 'IT only', 'check'),
  board('itjobs', 'itjobs.ch', 'https://www.itjobs.ch/', 'IT only', 'check'),
  board('ijobs', 'ijobs.ch', 'https://ijobs.ch/', 'IT only', 'check'),
  board('job-box', 'job-box.ch', 'https://www.job-box.ch/', 'General', 'check'),
  board('jobscout24', 'JobScout24', 'https://www.jobscout24.ch/', 'General', 'check'),
  board('startup-jobs', 'Swiss Startup Jobs', 'https://www.swissstartupjobs.com/', 'Startups', 'check'),
  board('eth', 'ETH Zurich jobs', 'https://jobs.ethz.ch/', 'ETH and spin-offs', 'check'),
  board('next-career', 'next-career.ch', 'https://next-career.ch/de/jobs/', 'General', 'check'),
  board('yooture', 'yooture', 'https://www.yooture.ch/', 'Companies approach you', 'manual', 'Talent platform, not a board: keep a profile there.'),

  // ---- company career sites ----
  company('google', 'Google', 'https://www.google.com/about/careers/applications/jobs/results?location=Zurich%2C%20Switzerland', 'Tech', 'Own', 'check'),
  company('microsoft', 'Microsoft', 'https://careers.microsoft.com/', 'Tech', 'Probably Eightfold', 'check'),
  company('apple', 'Apple', 'https://jobs.apple.com/en-ch/search', 'Tech', 'Own', 'check'),
  company('amazon', 'Amazon / AWS', 'https://www.amazon.jobs/', 'Tech', 'Own', 'check'),
  company('meta', 'Meta', 'https://www.metacareers.com/locations/zurich', 'Tech (Reality Labs)', 'Own', 'check'),
  company('nvidia', 'NVIDIA', 'https://jobs.nvidia.com/careers', 'Tech', 'Custom', 'check'),
  company('ibm', 'IBM Research Zurich', 'https://www.ibm.com/careers/search?field_keyword_05[0]=Switzerland', 'Research', 'Custom', 'check'),
  company('disney', 'Disney Research', 'https://www.disneyresearch.com/', 'Research', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('proton', 'Proton', 'https://job-boards.greenhouse.io/proton', 'Privacy software', 'Greenhouse', 'feed', 'Official public job board API.'),
  company('swisscom', 'Swisscom', 'https://swisscom.wd103.myworkdayjobs.com/en-US/SwisscomExternalCareers', 'Telecom', 'Workday', 'feed'),
  company('temenos', 'Temenos', 'https://temenos.wd103.myworkdayjobs.com/en-US/Temenoscareers', 'Banking software', 'Workday', 'feed'),
  company('zuehlke', 'Zühlke', 'https://zuehlke.wd3.myworkdayjobs.com/en-US/Zuhlke-Careers', 'Engineering consultancy', 'Workday', 'feed'),
  company('swissre', 'Swiss Re', 'https://careers.swissre.com/', 'Reinsurance', 'SuccessFactors', 'feed'),
  company('schindler', 'Schindler', 'https://job.schindler.com/', 'Industry, IoT', 'SuccessFactors', 'feed'),
  company('sonova', 'Sonova', 'https://www.sonova.com/en/careers', 'Medtech', 'SuccessFactors', 'feed'),
  company('roche', 'Roche', 'https://careers.roche.com/global/en', 'Pharma, diagnostics', 'Phenom', 'check'),
  company('novartis', 'Novartis', 'https://www.novartis.com/careers/career-search', 'Pharma', 'Custom', 'check'),
  company('ubs', 'UBS', 'https://www.ubs.com/global/en/careers/search-jobs.html', 'Bank', 'Probably Taleo', 'check'),
  company('zurich', 'Zurich Insurance', 'https://www.zurich.ch/', 'Insurance', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('juliusbaer', 'Julius Bär', 'https://www.juliusbaer.com/', 'Bank', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('zkb', 'Zürcher Kantonalbank', 'https://www.zkb.ch/', 'Bank', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('raiffeisen', 'Raiffeisen', 'https://jobs.raiffeisen.ch/', 'Bank', '', 'check'),
  company('postfinance', 'PostFinance', 'https://www.postfinance.ch/', 'Bank', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('six', 'SIX Group', 'https://www.six-group.com/', 'Financial infrastructure', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('swisslife', 'Swiss Life', 'https://www.swisslife.com/en/careers.html', 'Insurance', '', 'check'),
  company('axa', 'AXA Switzerland', 'https://www.axa.ch/de/ueber-axa/jobs-karriere/stellenangebote/offene-stellen.html', 'Insurance', '', 'check'),
  company('helvetia', 'Helvetia', 'https://jobs.helvetia.com/ch/', 'Insurance', '', 'check'),
  company('abb', 'ABB', 'https://careers.abb.com/', 'Industry', '', 'check'),
  company('siemens', 'Siemens', 'https://jobs.siemens.com/', 'Industry', '', 'check'),
  company('logitech', 'Logitech', 'https://www.logitech.com/', 'Consumer tech', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('sbb', 'SBB', 'https://www.sbb.ch/', 'Railways', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('post', 'Swiss Post', 'https://www.post.ch/', 'Logistics', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('migros', 'Migros', 'https://www.migros.ch/', 'Retail', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('galaxus', 'Digitec Galaxus', 'https://www.galaxus.ch/', 'E-commerce', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('getyourguide', 'GetYourGuide', 'https://www.getyourguide.com/', 'Travel tech', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
  company('scandit', 'Scandit', 'https://www.scandit.com/careers/current-openings/', 'Software', '', 'check'),
  company('on', 'On', 'https://jobs.on.com/careers', 'Sports, e-commerce tech', '', 'check'),
  company('nexthink', 'Nexthink', 'https://nexthink.com/company/careers/jobs', 'Software', '', 'check'),
  company('avaloq', 'Avaloq', 'https://www.avaloq.com/careers/job-openings', 'Banking software', '', 'check'),
  company('netcetera', 'Netcetera', 'https://www.netcetera.com/careers/open-positions', 'Software services', 'Partly Personio', 'check'),
  company('adnovum', 'Adnovum', 'https://careers.adnovum.com/search/', 'Software, security', '', 'check'),
  company('elca', 'ELCA', 'https://www.elca.ch/', 'Software services', '', 'check', 'Link goes to the main site: replace it with the careers page.'),
];

/**
 * The default sources not yet offered to this file. `seen` lists the ids
 * offered before, so an entry the user deleted is not added again.
 */
export function newDefaults(seen = []) {
  const known = new Set(seen);
  return DEFAULT_SOURCES.filter((s) => !known.has(s.id));
}

/** Sources of one kind: followed ones first, favourites first, then the longest unopened, then by name. */
export function sortSources(sources, kind) {
  return sources
    .filter((s) => s.kind === kind)
    .sort(
      (a, b) =>
        Number(Boolean(a.skip)) - Number(Boolean(b.skip)) ||
        Number(Boolean(b.star)) - Number(Boolean(a.star)) ||
        (a.checkedOn || '').localeCompare(b.checkedOn || '') ||
        a.name.localeCompare(b.name),
    );
}
