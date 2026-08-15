// tools/build.mjs — SESSIONS 1–3.
// npm run build -> validate, write slugs, render 359 routes, emit sitemap, print report.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import { assignSlugs } from './slugify.mjs';
import { validate, proseWords, LAUNCH_THRESHOLD, TARGET_THRESHOLD } from './validate.mjs';
import {
  connectionMap, uniquePairs, bridgeBooks, themeMatrix, matrixPairs,
  publicationLag, streaksAndGaps, cumulativePages,
} from './derive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = 'https://bookshelf.drost.us';
const PER_PAGE = 24;            // SESSION 2 Step 2 — divides by 2, 3, 4 and 6. Do not change.
const YEAR_FLOOR = 2020;        // SESSION 2 Step 4 — floor fixed, ceiling computed.

const read = (p) => fs.readFileSync(p, 'utf8');
const readJson = (p) => JSON.parse(read(p));
const exists = (p) => fs.existsSync(p);

// ---------------------------------------------------------------- text helpers
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (s) => String(s ?? '').replace(/\*\*([^*]+?)\*\*/g, '$1').replace(/\*([^*]+?)\*/g, '$1');

/** The SPA's fmtText, server-side: escape, then render *italic* / **bold**. */
function fmtText(s) {
  let t = esc(s);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  return t;
}
function inline(s) {
  let t = esc(s);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt, href) => `<a href="${href}">${txt}</a>`);
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  return t;
}
function markdown(md) {
  const out = []; let list = null;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } continue; }
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const li = /^-\s+(.*)$/.exec(line);
    if (li) { (list ??= []).push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('\n');
}
function frontMatter(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { meta, body: raw.slice(m[0].length) };
}
/**
 * ONE teaser line (guardrail 5). Hard-capped so a hub can never reproduce a full
 * summary: several summaries are a single sentence, so "first sentence" alone would
 * republish them verbatim on the library, theme and year pages.
 */
function teaserOf(book, max = 130) {
  const s = plain(book.summary || '').trim();
  if (!s) return '';
  const stop = s.search(/[.!?](\s|$)/);
  let t = stop > 0 ? s.slice(0, stop + 1) : s;
  if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return t;
}
/** Descriptions must be unique and 140–160 chars (§12). */
function describe(...parts) {
  let d = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (d.length > 158) d = d.slice(0, 158).replace(/\s+\S*$/, '') + '…';
  return d;
}
const fmtDate = (d) => {
  const m = /^(\d{4})\/(\d{2})/.exec(d || '');
  if (!m) return '';
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[2] - 1] + ' ' + m[1];
};

// ---------------------------------------------------------------- load
const data = readJson(path.join(SRC, 'data/books.json'));
const themesCfg = readJson(path.join(SRC, 'data/themes.json')).themes.slice().sort((a, b) => a.order - b.order);
const clustersCfg = readJson(path.join(SRC, 'data/clusters.json')).clusters;
const standoutsCfg = readJson(path.join(SRC, 'data/standouts.json')).standouts;
const slugFile = readJson(path.join(SRC, 'data/slugs.json'));

const recoveryPath = path.join(SRC, 'data/titles.recovery.txt');
const recovery = new Map();
if (exists(recoveryPath)) {
  for (const line of read(recoveryPath).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('~~');
    if (i > 0) recovery.set(line.slice(0, i), line.slice(i + 2));
  }
}
let recovered = 0;

const coversDir = path.join(SRC, 'covers');
const coversStaged = exists(coversDir) && fs.readdirSync(coversDir).some((f) => f.endsWith('.jpg'));

const books = data.books.map((b) => {
  const book = { ...b };
  if (!String(book.title || '').trim() && recovery.has(book.id)) { book.title = recovery.get(book.id); recovered++; }
  book.public = book.public !== false;
  book.hasCover = exists(path.join(coversDir, `${book.id}.jpg`));
  book.teaser = teaserOf(book);
  book.shortTitle = String(book.title).split(':')[0];
  book.prose = proseWords(book);
  book.pagesNum = (() => { const n = parseInt(book.pages, 10); return isFinite(n) && n > 0 ? n : null; })();
  const s = standoutsCfg[book.id];
  if (s) { book.standout = true; book.cluster = s.cluster; book.standoutNote = s.note; }
  return book;
});

// ---------------------------------------------------------------- slugs + validate
// SLUG PRECEDENCE: Notion (arriving via books.json) > the local ledger > generated.
// Notion is now the system of record for slugs, which is strictly better than the ledger
// file: the value is editable by Alex, survives the nightly sync, and cannot be silently
// regenerated from a corrected title. slugs.json stays as a mirror and a backup, and as
// the drift detector below — a slug that changes is a live URL that moved.
const notionSlugs = new Map(
  data.books.filter((b) => String(b.slug || '').trim()).map((b) => [b.id, String(b.slug).trim()])
);
const slugDrift = [];
for (const [id, s] of notionSlugs) {
  const prev = (slugFile.slugs || {})[id];
  if (prev && prev !== s) slugDrift.push({ id, was: prev, now: s });
}
const seededLedger = { ...(slugFile.slugs || {}), ...Object.fromEntries(notionSlugs) };
const { ledger, written: slugsWritten, report: slugReport } = assignSlugs(books, seededLedger);
for (const b of books) {
  b.slug = ledger[b.id];
  // Unread books get no /book/{slug} page (SESSION 3), so they must not link to one.
  b.href = b.shelf === 'read' ? `/book/${b.slug}` : null;
}
const v = validate({ books, themes: themesCfg, ledger });

const byId = new Map(books.map((b) => [b.id, b]));
const publicBooks = books.filter((b) => b.public);
const readBooks = publicBooks.filter((b) => b.shelf === 'read');
// Shelf drives everything on /up-next. Notion's select now has three values, and the
// `currently-reading` -> `reading` rename is accepted either way so a sync during the
// rename can never produce an empty page.
const isReading = (b) => b.shelf === 'reading' || b.shelf === 'currently-reading';
const isTBR = (b) => String(b.shelf || '').toLowerCase() === 'tbr';
const currentlyReading = publicBooks.filter(isReading)
  .sort((a, b) => a.title.localeCompare(b.title, 'en'));
// To-be-read: no page, no connections, no summary — a cover, a title and a year.
const tbr = publicBooks.filter(isTBR)
  .sort((a, b) => a.title.localeCompare(b.title, 'en'));

// Canonical catalog order: dateRead desc, undated last, Goodreads ID as tiebreaker.
const catalogDesc = (a, b) => {
  const ad = a.dateRead || '', bd = b.dateRead || '';
  if (ad && bd && ad !== bd) return ad < bd ? 1 : -1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
};
const orderedRead = readBooks.slice().sort(catalogDesc);

// ---------------------------------------------------------------- derived
const cmap = connectionMap(books);
const pairs = uniquePairs(cmap);
const themeNames = themesCfg.map((t) => t.source);
// Themes shown on the /connections matrix. Theology & Faith connects to almost nothing,
// so it contributed an empty row and column and made the whole grid read as broken.
// It still has a theme page, books, and nodes in the graph — it is only off these axes.
const MATRIX_EXCLUDE = new Set(['Theology & Faith', 'Religion & Faith']);
const matrixThemes = themeNames.filter((t) => !MATRIX_EXCLUDE.has(t));
const matrixThemesCfg = themesCfg.filter((t) => !MATRIX_EXCLUDE.has(t.name));
const matrix = themeMatrix(books, cmap, matrixThemes);
// Peak off-diagonal value, so the heat shading in the matrix is scaled to real data
// rather than a hardcoded ceiling that goes wrong as the shelf grows.
const matrixMax = Math.max(1, ...matrix.flatMap((row, i) => row.filter((_, j) => i !== j)));
const crossPairs = matrixPairs(matrix, matrixThemes);
const bridges = bridgeBooks(books, cmap, 12);
const lag = publicationLag(readBooks);
const streaks = streaksAndGaps(readBooks);
const cumPages = cumulativePages(readBooks);

for (const b of books) {
  const ids = [...(cmap.get(b.id) || [])];
  b.connections = ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((o) => ({ book: o, shared: (b.themes || []).filter((t) => (o.themes || []).includes(t)) }))
    .sort((x, y) => y.shared.length - x.shared.length || catalogDesc(x.book, y.book));
}
const thinlyConnected = readBooks.filter((b) => b.connections.length < 3);

/**
 * Weighted sample without replacement, biased toward the front of the list.
 * `orderedRead` is newest-first, so weight 1/(rank+2) makes a recent read roughly
 * three times likelier than one from the back of the shelf — varied on every build,
 * but never a random grab from 2019 while this year's books sit unshown.
 */
function biasedSample(list, n) {
  const pool = list.map((b, i) => ({ b, w: 1 / (i + 2) }));
  const out = [];
  while (out.length < n && pool.length) {
    let total = 0;
    for (const p of pool) total += p.w;
    let r = Math.random() * total, k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    out.push(pool.splice(k, 1)[0].b);
  }
  return out;
}

// The site palette, keyed on the Notion theme name (`source`), matching app.js.
const THEME_COLORS = {
  'Politics & Power': '#3a6ea5', 'Business & Finance': '#c6913f',
  'History & Foreign Affairs': '#9c7b57', 'Personal Growth & Leadership': '#88a04a',
  'Memoir & Biography': '#8268a6', 'Psychology & Mind': '#3a8fb0',
  'Society & Culture': '#b06a93', 'Religion & Faith': '#b3864c',
  'Tech & Future': '#5a66ad', 'Crime & Justice': '#b3564c', 'Other': '#9aa0a6',
};

const THEME_TILES = 6;   // one row of six in a card that sits two-up on the page
const themeIndex = themesCfg.map((t) => {
  const books = orderedRead.filter((b) => (b.themes || []).includes(t.source));
  return { ...t, books, color: THEME_COLORS[t.source] || THEME_COLORS.Other,
    tiles: biasedSample(books.filter((b) => b.hasCover), THEME_TILES) };
}).filter((t) => t.books.length);

const yearsPresent = [...new Set(readBooks.map((b) => b.yearRead).filter(Boolean))]
  .filter((y) => +y >= YEAR_FLOOR).sort();
const yearIndex = yearsPresent.map((y) => ({ year: y, books: orderedRead.filter((b) => b.yearRead === y) }));
const preFloor = readBooks.filter((b) => b.yearRead && +b.yearRead < YEAR_FLOOR).length;
const undated = readBooks.filter((b) => !b.dateRead).length;

const site = {
  origin: ORIGIN,
  publicCount: publicBooks.length,
  readCount: readBooks.length,
  uniqueConnections: pairs.size,
  themeCount: themeIndex.length,
  totalPages: cumPages.total,
  medianLag: lag.median,
};

// ---------------------------------------------------------------- picks
let picksMode = 'fallback', picks = [], clusters = [], picksYears = '';
if (Object.keys(standoutsCfg).length) {
  picksMode = 'clusters';
  clusters = clustersCfg.slice().sort((a, b) => a.order - b.order)
    .map((c) => ({ ...c, books: publicBooks.filter((b) => b.cluster === c.id) })).filter((c) => c.books.length);
  picks = clusters.flatMap((c) => c.books);
} else {
  const spa = read(path.join(SRC, 'index.html'));
  const m = /const STANDOUTS=\{([\s\S]*?)\n\};/.exec(spa);
  const byYear = {};
  if (m) for (const row of m[1].matchAll(/"(\d{4})":\s*\[([^\]]*)\]/g)) byYear[row[1]] = [...row[2].matchAll(/"(\d+)"/g)].map((x) => x[1]);
  const years = Object.keys(byYear).sort().reverse().slice(0, 2);
  picksYears = years.slice().reverse().join(' and ');
  picks = years.flatMap((y) => byYear[y]).map((id) => byId.get(id)).filter((b) => b && b.public);
}

// ---------------------------------------------------------------- schema
const PERSON = {
  '@context': 'https://schema.org', '@type': 'Person', '@id': `${ORIGIN}/#alexdrost`,
  name: 'Alex Drost', jobTitle: 'Advisor & Speaker', image: 'https://alexdrost.com/alex-drost.jpg',
  url: `${ORIGIN}/about`,
  address: { '@type': 'PostalAddress', addressLocality: 'Detroit', addressRegion: 'MI', addressCountry: 'US' },
  sameAs: ['https://alexdrost.com', 'https://drost.us', 'https://alex.drost.us', 'https://bookshelf.drost.us',
    'https://vibe.drost.us', 'https://thebusinessofaccounting.com', 'https://connection.builders',
    'https://www.linkedin.com/in/adrost/'],
};
const PERSON_ABOUT = {
  ...PERSON,
  worksFor: { '@type': 'Organization', name: 'Cascade Partners' },
  hasCredential: [{ '@type': 'EducationalOccupationalCredential', credentialCategory: 'license', name: 'Certified Public Accountant (CPA)', recognizedBy: { '@type': 'Organization', name: 'State of Michigan' } }],
  alumniOf: [{ '@type': 'CollegeOrUniversity', name: 'Northwood University' }, { '@type': 'CollegeOrUniversity', name: 'Walsh College' }],
};
/**
 * WebSite node, emitted alongside Person as a two-node @graph on every page.
 * `author`/`publisher` reference the Person by @id rather than repeating it — that shared
 * identifier is what resolves this site and the rest of the portfolio to one entity.
 * No SearchAction: Google deprecated the sitelinks searchbox.
 */
const WEBSITE = {
  '@type': 'WebSite', '@id': `${ORIGIN}/#website`, url: `${ORIGIN}/`,
  name: 'Alex Drost\u2019s Bookshelf',
  description: 'A personal library of annotated books, themed and mapped by the threads that run between them.',
  inLanguage: 'en-US',
  author: { '@id': `${ORIGIN}/#alexdrost` },
  publisher: { '@id': `${ORIGIN}/#alexdrost` },
};
/** Person + WebSite as one graph. The Person keeps its own @context at the graph level. */
const identityGraph = (person) => {
  const { '@context': _ctx, ...node } = person;
  return { '@context': 'https://schema.org', '@graph': [node, WEBSITE] };
};

const J = (o) => JSON.stringify(o, null, 2);

function breadcrumb(trail) {
  return J({
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${ORIGIN}${t.path}` })),
  });
}
const articleSchema = (page) => J({
  '@context': 'https://schema.org', '@type': 'Article', headline: page.h1Plain, description: page.description,
  author: { '@id': `${ORIGIN}/#alexdrost` }, publisher: { '@id': `${ORIGIN}/#alexdrost` },
  mainEntityOfPage: `${ORIGIN}${page.path}`, image: `${ORIGIN}/share.png`,
});
function collectionSchema(page, list) {
  return J({
    '@context': 'https://schema.org', '@type': 'CollectionPage', name: page.h1Plain, description: page.description,
    url: `${ORIGIN}${page.path}`,
    mainEntity: {
      '@type': 'ItemList', numberOfItems: list.length,
      itemListElement: list.slice(0, 100).map((b, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: { '@type': 'Book', name: b.title, author: { '@type': 'Person', name: b.author }, url: `${ORIGIN}${b.href}` },
      })),
    },
  });
}
function bookSchema(b) {
  const o = {
    '@context': 'https://schema.org', '@type': 'Book', name: b.title,
    author: { '@type': 'Person', name: b.author },
    url: `${ORIGIN}${b.href}`,
    description: plain(b.summary || ''),
  };
  // Only claim an image we actually ship — a 404 in JSON-LD costs the rich result.
  if (b.hasCover) o.image = `${ORIGIN}/covers/${b.id}.jpg`;
  if (b.isbn) o.isbn = b.isbn;
  if (b.pagesNum) o.numberOfPages = b.pagesNum;   // never emit a zero
  if (b.yearPub) o.datePublished = String(b.yearPub);
  return J(o);
}

// ---------------------------------------------------------------- render setup
const env = nunjucks.configure(path.join(SRC, 'templates'), { autoescape: true });
env.addFilter('fmt', (s) => fmtText(s));
env.addFilter('date', (s) => fmtDate(s));
env.addFilter('num', (n) => Number(n).toLocaleString('en-US'));
env.addFilter('take', (a, n) => (Array.isArray(a) ? a.slice(0, n) : a));
env.addFilter('startsWith', (s2, p2) => String(s2 ?? '').startsWith(p2));

const NAV = [
  { label: 'Library', path: '/library' },
  { label: 'Up Next', path: '/up-next' },
  { label: 'Timeline', path: '/timeline' },
  { label: 'Themes', path: '/themes' },
  { label: 'Connections', path: '/connections' },
  { label: 'Analytics', path: '/analytics' },
  { label: 'Recommendations', path: '/recommendations' },
  { label: 'About', path: '/about' },
];
const GENERATED = (name) => `<!-- GENERATED — DO NOT EDIT. Source: src/templates/${name} -->\n`;

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const writtenRoutes = [];
function emit(routePath, templateName, ctx, { indexable = true, priority = 0.5 } = {}) {
  const page = ctx.page;
  page.breadcrumbJson = breadcrumb(page.trail || [{ name: 'Bookshelf', path: '/' }, { name: page.crumb, path: page.path }]);
  const html = GENERATED(templateName) + env.render(templateName, {
    site, nav: NAV, personJson: J(identityGraph(page.person || PERSON)), ...ctx,
  });
  const rel = routePath === '/' ? 'index.html' : `${routePath.replace(/^\//, '')}/index.html`;
  const abs = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, html);
  writtenRoutes.push({ path: routePath, file: rel, indexable: indexable && !page.noindex, priority });
}

const tokens = { '{{COUNT}}': String(site.publicCount), '{{READ}}': String(site.readCount), '{{CONNECTIONS}}': site.uniqueConnections.toLocaleString('en-US'), '{{PICKCOUNT}}': String(picks.length), '{{THEMES}}': String(site.themeCount) };
const fill = (s) => Object.entries(tokens).reduce((acc, [k, val]) => acc.split(k).join(val), String(s ?? ''));
const confirmMarkers = [];
const scanMarkers = (where, text) => { for (const m of String(text).matchAll(/\[CONFIRM[^\]]*\]/g)) confirmMarkers.push({ where, marker: m[0] }); };

function copyPage(file) {
  const { meta, body } = frontMatter(read(path.join(SRC, 'pages', file)));
  scanMarkers(file, body); scanMarkers(file, JSON.stringify(meta));
  return {
    meta,
    copy: { kicker: fill(meta.kicker), h1: fill(meta.h1), standfirst: fill(meta.standfirst), portrait: meta.portrait || '', html: markdown(fill(body)) },
  };
}

// ================================================================ ROUTES
// ---- / -----------------------------------------------------------------
{
  const featuredBook = orderedRead[0];
  // The home feature read as a stub at one sentence. Two sentences plus the first core
  // idea — still well short of the book page, so guardrail 5 holds.
  {
    const full = plain(featuredBook.summary || '').trim();
    const cut = (t, max) => (t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') + '\u2026' : t);
    let two = full, hits = 0;
    for (const mm of full.matchAll(/[.!?](\s|$)/g)) { hits++; if (hits === 2) { two = full.slice(0, mm.index + 1); break; } }
    featuredBook.leadIn = fmtText(cut(two, 340));
    featuredBook.coreLead = fmtText(cut(plain((featuredBook.core || [])[0] || ''), 190));
  }
  // 24 — three full rows of eight on desktop, and it divides by 2, 3, 4 and 6, so no
  // row is left with orphans at any breakpoint.
  const recent = orderedRead.slice(0, 24);
  const page = {
    path: '/', crumb: 'Home',
    title: `Alex Drost’s Bookshelf — ${site.publicCount} Books, Annotated and Connected`,
    description: describe(`A personal library of ${site.publicCount} books — each with a summary, core ideas, and ${site.uniqueConnections.toLocaleString('en-US')} hand-made links between them.`),
    trail: [{ name: 'Bookshelf', path: '/' }],
  };
  page.extraJson = collectionSchema({ ...page, h1Plain: 'Alex Drost’s bookshelf' }, recent);
  emit('/', 'home.njk', { page, featuredBook, recent, picks: picks.slice(0, 6), themeIndex }, { priority: 1.0 });
}

// ---- /about /recommendations /up-next ----------------------------------
for (const [route, tpl, file, schema, prio] of [
  ['/about', 'about.njk', 'about.md', null, 0.9],
  ['/recommendations', 'picks.njk', 'recommendations.md', 'article', 0.9],
  ['/up-next', 'up-next.njk', 'up-next.md', null, 0.7],
]) {
  const { meta, copy } = copyPage(file);
  const page = {
    path: route, crumb: meta.crumb, title: fill(meta.title), description: fill(meta.description),
    ogType: meta.ogType || 'website', h1Plain: plain(fill(meta.h1)).replace(/&rsquo;/g, '’'),
    person: route === '/about' ? PERSON_ABOUT : PERSON,
  };
  if (schema === 'article') page.extraJson = articleSchema(page);
  emit(route, tpl, { page, copy, picks, picksMode, picksYears, clusters, currentlyReading, tbr }, { priority: prio });
}

// ---- /library + pagination ---------------------------------------------
const libraryPages = Math.max(1, Math.ceil(orderedRead.length / PER_PAGE));
for (let n = 1; n <= libraryPages; n++) {
  const slice = orderedRead.slice((n - 1) * PER_PAGE, n * PER_PAGE);
  const route = n === 1 ? '/library' : `/library/${n}`;
  const page = {
    path: route, crumb: n === 1 ? 'Library' : `Library, page ${n}`,
    title: n === 1
      ? `The Full Library — ${orderedRead.length} Books | Alex Drost’s Bookshelf`
      : `The Full Library, Page ${n} of ${libraryPages} | Alex Drost’s Bookshelf`,
    description: n === 1
      ? describe(`Every one of the ${orderedRead.length} books on the shelf, most recent read first — summaries, themes, and the connections between them.`)
      : describe(`Page ${n} of ${libraryPages} of the full library: books ${(n - 1) * PER_PAGE + 1}–${Math.min(n * PER_PAGE, orderedRead.length)} of ${orderedRead.length}, most recent read first.`),
    h1Plain: 'The full library',
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Library', path: '/library' }].concat(n === 1 ? [] : [{ name: `Page ${n}`, path: route }]),
    prev: n === 2 ? '/library' : n > 2 ? `/library/${n - 1}` : null,
    next: n < libraryPages ? `/library/${n + 1}` : null,
  };
  page.extraJson = collectionSchema(page, slice);
  emit(route, 'library.njk', {
    page, books: slice, pageNum: n, totalPages: libraryPages, perPage: PER_PAGE,
    total: orderedRead.length, themeIndex,
  }, { priority: n === 1 ? 0.8 : 0.6 });
}

// ---- /themes + theme pages ---------------------------------------------
{
  const page = {
    path: '/themes', crumb: 'Themes', title: 'Themes — Alex Drost’s Bookshelf',
    description: describe(`The ${themeIndex.length} themes the shelf is organised around, from business and psychology through to politics and faith.`),
    h1Plain: 'What the library is about',
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Themes', path: '/themes' }],
  };
  emit('/themes', 'themes-hub.njk', { page, themeIndex }, { priority: 0.8 });
}
for (const t of themeIndex) {
  const route = `/themes/${t.slug}`;
  const page = {
    path: route, crumb: t.name,
    title: `${t.name} — ${t.books.length} Books | Alex Drost’s Bookshelf`,
    description: describe(`${t.books.length} books on ${t.name.toLowerCase()}.`, t.intro),
    h1Plain: t.name,
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Themes', path: '/themes' }, { name: t.name, path: route }],
  };
  page.extraJson = collectionSchema(page, t.books);
  emit(route, 'theme.njk', { page, theme: t, books: t.books }, { priority: 0.7 });
}

// ---- /timeline + year pages --------------------------------------------
{
  const page = {
    path: '/timeline', crumb: 'Timeline', title: 'Reading Timeline — Alex Drost’s Bookshelf',
    description: describe(`Books finished each year from ${yearsPresent[0]} to ${yearsPresent[yearsPresent.length - 1]}, and how the mix of subjects has shifted.`),
    h1Plain: 'Reading over time',
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Timeline', path: '/timeline' }],
  };
  emit('/timeline', 'timeline.njk', { page, yearIndex, preFloor, undated, streaks, cumPages }, { priority: 0.8 });
}
for (const y of yearIndex) {
  const route = `/${y.year}`;
  const pagesRead = y.books.reduce((n, b) => n + (b.pagesNum || 0), 0);
  const page = {
    path: route, crumb: y.year, title: `What I Read in ${y.year} — Alex Drost’s Bookshelf`,
    description: describe(`The ${y.books.length} books finished in ${y.year} — ${pagesRead.toLocaleString('en-US')} pages, most recent read first, with themes and connections.`),
    h1Plain: `What I read in ${y.year}`,
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Timeline', path: '/timeline' }, { name: y.year, path: route }],
  };
  page.extraJson = collectionSchema(page, y.books);

  // Group into months, newest first, skipping months with no finish. The /timeline month
  // bars link to /{year}#m-{MM}, so these ids are the landing points for that chart.
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const buckets = new Map();
  const undatedInYear = [];
  for (const b of y.books) {
    const mm = (b.dateRead || '').split('/')[1];
    if (!mm || !MONTHS_LONG[+mm - 1]) { undatedInYear.push(b); continue; }
    if (!buckets.has(mm)) buckets.set(mm, []);
    buckets.get(mm).push(b);
  }
  const months = [...buckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mm, list]) => ({
      mm, name: `${MONTHS_LONG[+mm - 1]} ${y.year}`, short: MONTHS_SHORT[+mm - 1],
      books: list, pages: list.reduce((n, b) => n + (b.pagesNum || 0), 0),
    }));

  emit(route, 'year.njk', { page, year: y.year, books: y.books, pagesRead, months, undatedInYear }, { priority: 0.7 });
}

// ---- /connections -------------------------------------------------------
{
  const page = {
    path: '/connections', crumb: 'Connections', title: 'The Connection Map — Alex Drost’s Bookshelf',
    description: describe(`${site.uniqueConnections.toLocaleString('en-US')} hand-made links across ${site.readCount} books — what connects to what, and why it was worth recording.`),
    h1Plain: 'The web of connections',
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Connections', path: '/connections' }],
  };
  page.extraJson = articleSchema(page);
  emit('/connections', 'connections.njk', {
    page, matrix, matrixMax, themeNames, themesCfg: matrixThemesCfg, crossPairs: crossPairs.slice(0, 12),
  }, { priority: 0.8 });
}

// ---- /analytics ---------------------------------------------------------
{
  const page = {
    path: '/analytics', crumb: 'Analytics', title: 'Reading Analytics — Alex Drost’s Bookshelf',
    description: describe(`${site.readCount} books, ${site.totalPages.toLocaleString('en-US')} pages, and what the numbers say about how the reading has changed.`),
    h1Plain: 'Reading analytics',
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Analytics', path: '/analytics' }],
  };
  page.extraJson = articleSchema(page);
  emit('/analytics', 'analytics.njk', { page, lag, streaks, cumPages, crossPairs: crossPairs.slice(0, 10), matrix, themeNames: matrixThemes, themesCfg: matrixThemesCfg }, { priority: 0.8 });
}

// ---- /book/{slug} × 318 -------------------------------------------------
const gated = [];
for (const b of orderedRead) {
  const noindex = b.prose < LAUNCH_THRESHOLD;
  if (noindex) gated.push(b);
  const themeLinks = (b.themes || []).map((t) => themeIndex.find((x) => x.source === t)).filter(Boolean);
  const yearLink = b.yearRead && yearsPresent.includes(b.yearRead) ? `/${b.yearRead}` : null;
  const page = {
    path: b.href, crumb: b.shortTitle, noindex,
    // These are articles about a book, not the site itself. og:type frames how LinkedIn and
    // Slack render the preview; "website" on 321 subpages is simply the wrong assertion.
    ogType: 'article',
    title: `${b.shortTitle} by ${b.author} — Summary & Key Ideas | Alex Drost’s Bookshelf`,
    description: describe(b.teaser || `${b.title} by ${b.author}.`),
    h1Plain: b.title,
    trail: [{ name: 'Bookshelf', path: '/' }, { name: 'Library', path: '/library' }, { name: b.shortTitle, path: b.href }],
    extraJson: bookSchema(b),
  };
  emit(b.href, 'book.njk', { page, book: b, themeLinks, yearLink, connections: b.connections }, { priority: 0.5 });
}

// ---- /404 ---------------------------------------------------------------
{
  const page = { path: '/404', crumb: 'Not found', noindex: true, title: 'Page not found — Alex Drost’s Bookshelf', description: 'That page is not on the shelf. Browse the library, the standout reads, or the connection map instead.', h1Plain: 'Not found' };
  page.breadcrumbJson = breadcrumb([{ name: 'Bookshelf', path: '/' }]);
  fs.writeFileSync(path.join(DIST, '404.html'), GENERATED('404.njk') + env.render('404.njk', { site, nav: NAV, page, personJson: J(identityGraph(PERSON)) }));
}

// ---------------------------------------------------------------- assets
function copyDir(from, to) {
  if (!exists(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) n += copyDir(s, d); else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}
copyDir(path.join(SRC, 'styles'), path.join(DIST, 'styles'));
copyDir(path.join(SRC, 'assets'), path.join(DIST, 'assets'));
const coverCount = copyDir(path.join(SRC, 'covers'), path.join(DIST, 'covers'));
// The published books.json is a FILTERED copy, not a straight passthrough. A book can be
// fully enriched in Notion — summary, core ideas, tags, connections — while still sitting on
// the reading or TBR shelf. None of that renders anywhere until it is `read`, and it should
// not be downloadable either: dist/books.json is a public URL. Unread books keep only what
// /up-next actually shows.
{
  const published = {
    ...data,
    books: data.books.map((b) => {
      if (b.shelf === 'read') return b;
      const { summary, core, conn, tags, ...rest } = b;
      return { ...rest, summary: '', core: [], conn: [], tags: '' };
    }),
  };
  fs.writeFileSync(path.join(DIST, 'books.json'), JSON.stringify(published, null, 1) + '\n');
}
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
// id -> slug, so client-side modules can link to book pages without duplicating books.json
fs.writeFileSync(path.join(DIST, 'data/slugs.json'), JSON.stringify(Object.fromEntries(readBooks.map((b) => [b.id, b.slug]))));
// TEMPORARY, twin of src/data/titles.recovery.txt. Every client-side feature — search,
// the path finder, graph labels, analytics book lists — reads books.json, where every
// title is currently "". Without this the whole interactive layer looks broken. Emits an
// empty object the moment the Worker is fixed, and app.js then applies nothing.
fs.writeFileSync(path.join(DIST, 'data/titles.json'),
  JSON.stringify(Object.fromEntries(books.filter((b) => !String(data.books.find((x) => x.id === b.id).title || '').trim()).map((b) => [b.id, b.title]))));
// _headers is read by Cloudflare Pages from the deploy root — caching and security headers.
for (const extra of ['share.png', '_headers']) { const p = path.join(SRC, extra); if (exists(p)) fs.copyFileSync(p, path.join(DIST, extra)); }

// ---------------------------------------------------------------- robots + sitemap
fs.writeFileSync(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
const sitemapRoutes = writtenRoutes.filter((r) => r.indexable);
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapRoutes.map((r) => `  <url><loc>${ORIGIN}${r.path}</loc><priority>${r.priority.toFixed(1)}</priority></url>`),
  '</urlset>', '',
].join('\n'));
const sitemapMismatch = sitemapRoutes.filter((r) => !exists(path.join(DIST, r.file))).map((r) => `sitemap lists ${r.path} but ${r.file} was not written`);

// ---------------------------------------------------------------- slug ledger
fs.writeFileSync(path.join(SRC, 'data/slugs.json'),
  JSON.stringify({ _comment: slugFile._comment, slugs: Object.fromEntries(Object.entries(ledger).sort((a, b) => a[1].localeCompare(b[1]))) }, null, 2) + '\n');

// ---------------------------------------------------------------- report
const B = (s) => `\x1b[1m${s}\x1b[0m`;
const line = (s = '') => console.log(s);
line();
line(B('BUILD REPORT — bookshelf.drost.us, SESSIONS 1–3'));
line('='.repeat(74));
line(`books ............... ${books.length} total · ${readBooks.length} read · ${currentlyReading.length} reading · ${tbr.length} to-be-read`);
line(`connections ......... ${pairs.size} unique undirected pairs (public + read)`);
line(`titles recovered .... ${recovered}${recovered ? '  <-- bridge file, not books.json' : ''}`);
line(`routes .............. ${writtenRoutes.length}  (${libraryPages} library · ${themeIndex.length} theme · ${yearIndex.length} year · ${orderedRead.length} book) + /404`);
line(`indexable in sitemap  ${sitemapRoutes.length}   (${gated.length} book pages gated to noindex,follow)`);
line();
if (v.failures.length) {
  line(B(`FAILURES (${v.failures.length}) — build aborted`));
  for (const f of v.failures.slice(0, 40)) line(`  ✗ ${f}`);
  line();
}
if (sitemapMismatch.length) { line(B('SITEMAP MISMATCH')); for (const m of sitemapMismatch) line(`  ✗ ${m}`); line(); }
line(B(`WARNINGS (${v.warnings.length})`));
for (const w of v.warnings) line(`  ! ${w}`);
line();
line(B('SLUG SOURCE'));
line(`  from Notion ......... ${notionSlugs.size}${notionSlugs.size ? '' : '   (add Slug to the Worker allowlist so it reaches books.json)'}`);
line(`  from local ledger ... ${Object.keys(ledger).length - notionSlugs.size - slugsWritten.length}`);
line(`  generated this run .. ${slugsWritten.length}`);
if (slugDrift.length) {
  line();
  line(B(`  !! ${slugDrift.length} SLUG(S) CHANGED IN NOTION — these are live URLs that just moved`));
  for (const d of slugDrift) line(`     ${d.id}  ${d.was}  ->  ${d.now}   (needs a 301 from the old path)`);
}
line();
line(B(`SLUGS WRITTEN THIS RUN (${slugsWritten.length})`));
line(slugsWritten.length ? '' : '  (none — every book already had a frozen slug)');
for (const s of slugsWritten.slice(0, 400)) line(`  ${s.slug.padEnd(60)} ${s.strategy === 'base' ? '' : '[' + s.strategy + '] '}${s.title.slice(0, 50)}`);
line();
line(B('ENRICHMENT WORKLIST — pages below the 100-word launch threshold (noindex,follow)'));
for (const b of gated.slice().sort((a, b) => a.prose - b.prose)) line(`  ${String(b.prose).padStart(3)}w  ${b.shortTitle.slice(0, 58).padEnd(60)} ${b.href}`);
line(`  ${gated.length} gated · ${v.belowTarget.length} more below the ${TARGET_THRESHOLD}-word target · ~${[...v.belowLaunch, ...v.belowTarget].reduce((n, b) => n + (TARGET_THRESHOLD - b.words), 0).toLocaleString('en-US')} words to close the gap`);
line();
line(B('CONNECTIONS'));
line(`  theme matrix top: ${crossPairs.slice(0, 3).map((p) => `${p.a.split(' ')[0]}↔${p.b.split(' ')[0]} ${p.n}`).join(' · ')}`);
line(`  bridge books: ${bridges.slice(0, 5).map((r) => `${r.book.author.split(' ').slice(-1)[0]} (${r.themeCount})`).join(', ')}`);
line(`  books with fewer than 3 connections: ${thinlyConnected.length}${thinlyConnected.length ? '  [' + thinlyConnected.map((b) => b.shortTitle.slice(0, 24)).join(' | ') + ']' : ''}`);
line();
line(B('ASSETS'));
if (!coversStaged) line('  ! src/covers/ is empty in this workspace — covers live in the GitHub repo.');
line(`  covers copied ....... ${coverCount}`);
line(`  missing covers ...... ${books.filter((b) => !b.hasCover).length}${coversStaged ? '' : ' (expected: not staged here)'}`);
line(`  missing ISBN ........ ${v.missingIsbn.length}`);
line(`  pages "0" ........... ${v.zeroPages.length}`);
line();
line(B(`[CONFIRM] MARKERS (${confirmMarkers.length})`));
for (const c of confirmMarkers) line(`  ${c.where}  ${c.marker}`);
if (!confirmMarkers.length) line('  (none)');
line();
if (v.failures.length || sitemapMismatch.length) { line(B('BUILD FAILED')); process.exit(1); }
line(B('BUILD OK') + `  ->  dist/  (${writtenRoutes.length} routes + 404)`);
