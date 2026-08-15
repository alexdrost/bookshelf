// tools/qa.mjs — SESSION 1 Step 10 + SESSION 2 Step 9 + SESSION 3 Step 6. Exit 1 on failure.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignSlugs } from './slugify.mjs';
import { proseWords, LAUNCH_THRESHOLD } from './validate.mjs';
import { connectionMap, uniquePairs } from './derive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'src');
const ORIGIN = 'https://bookshelf.drost.us';
const read = (p) => fs.readFileSync(p, 'utf8');

const fails = [], passes = [], notes = [];
const check = (cond, label, detail = '') => (cond ? passes.push(label) : fails.push(label + (detail ? ` — ${detail}` : '')));

if (!fs.existsSync(DIST)) { console.error('dist/ missing. Run `npm run build` first.'); process.exit(1); }

const htmlFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) htmlFiles.push(p);
  }
})(DIST);

const pages = htmlFiles.map((f) => {
  const rel = path.relative(DIST, f);
  return { file: rel, route: '/' + rel.replace(/index\.html$/, '').replace(/\/$/, ''), html: read(f) };
});
const notFound = pages.find((p) => p.file === '404.html');
const generated = pages.filter((p) => p !== notFound);
const bookPages = pages.filter((p) => p.route.startsWith('/book/'));
const libraryPagesArr = pages.filter((p) => p.route === '/library' || /^\/library\/\d+$/.test(p.route));
const themePages = pages.filter((p) => /^\/themes\/[a-z-]+$/.test(p.route));
const yearPages = pages.filter((p) => /^\/\d{4}$/.test(p.route));

console.log(`\nQA — ${pages.length} HTML files in dist/\n${'='.repeat(66)}`);

// ---------------------------------------------------------------- data
const books = JSON.parse(read(path.join(SRC, 'data/books.json'))).books;
// The title-recovery bridge is retired — the Worker reads Title correctly now, so the file is
// gone. This stays guarded only so an older checkout still runs.
const recovery = new Map();
const recoveryPath = path.join(SRC, 'data/titles.recovery.txt');
if (fs.existsSync(recoveryPath)) {
  for (const line of read(recoveryPath).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const i = line.indexOf('~~'); if (i > 0) recovery.set(line.slice(0, i), line.slice(i + 2));
  }
}
const enriched = books.map((b) => ({ ...b, title: b.title || recovery.get(b.id) || '', public: b.public !== false }));
const ledger = JSON.parse(read(path.join(SRC, 'data/slugs.json'))).slugs;
const readBooks = enriched.filter((b) => b.shelf === 'read' && b.public);
const themesCfg = JSON.parse(read(path.join(SRC, 'data/themes.json'))).themes.slice().sort((a, b) => a.order - b.order);

// ---------------------------------------------------------------- GENERATION
check(bookPages.length === readBooks.length, `one book page per public read book (${bookPages.length})`, `data has ${readBooks.length}`);
check(enriched.every((b) => ledger[b.id]), 'every book has a slug');
const slugVals = Object.values(ledger);
check(new Set(slugVals).size === slugVals.length, 'no duplicate slugs');
const again = assignSlugs(enriched, ledger);
check(again.written.length === 0, 'no slug changed since first write', `${again.written.length} would be rewritten`);
for (const p of generated) if (!p.html.startsWith('<!-- GENERATED — DO NOT EDIT.')) fails.push(`${p.file}: missing DO-NOT-EDIT header`);
passes.push('every generated file carries the DO-NOT-EDIT header');
check(read(path.join(ROOT, '.gitignore')).includes('dist/'), 'dist/ is gitignored');

// ---------------------------------------------------------------- STRUCTURE (S2)
const expectedLibPages = Math.ceil(readBooks.length / 24);
check(libraryPagesArr.length === expectedLibPages, `${expectedLibPages} library pages`, `found ${libraryPagesArr.length}`);
const lastLib = pages.find((p) => p.route === `/library/${expectedLibPages}`);
const remainder = readBooks.length - (expectedLibPages - 1) * 24;
check(lastLib && (lastLib.html.match(/class="book"/g) || []).length === remainder, `library page ${expectedLibPages} holds the remainder (${remainder})`);
for (const p of libraryPagesArr) {
  const n = p.route === '/library' ? 1 : +p.route.split('/')[2];
  if (n > 1) check(/rel="prev"/.test(p.html), `${p.route}: rel="prev" present`);
  if (n < expectedLibPages) check(/rel="next"/.test(p.html), `${p.route}: rel="next" present`);
  // The anchors must be in the SERVED html, not injected — that is the whole point.
  if (n < expectedLibPages) check(p.html.includes(`href="/library/${n + 1}"`), `${p.route}: next anchor is in the served HTML`);
}
check(pages.find((p) => p.route === '/library').html.includes('id="loadMore"'), 'library has a visible no-JS "Load more" fallback');
check(themePages.length === themesCfg.length, `${themesCfg.length} theme pages`, `found ${themePages.length}`);
const hubOrder = [...pages.find((p) => p.route === '/themes').html.matchAll(/href="\/themes\/([a-z-]+)"/g)].map((m) => m[1]);
check(JSON.stringify(hubOrder) === JSON.stringify(themesCfg.map((t) => t.slug)), 'themes hub is in editorial order, not by count', hubOrder.join(','));
const yearsInData = [...new Set(readBooks.map((b) => b.yearRead).filter((y) => y && +y >= 2020))].sort();
check(yearPages.length === yearsInData.length, `${yearsInData.length} year pages`, `found ${yearPages.length}`);
check(!pages.some((p) => p.route === '/2019'), 'no year page for 2019');
check(!themePages.some((p) => /class="pickcard"/.test(p.html) === false), 'no empty theme page emitted');
check(!yearPages.some((p) => /class="pickcard"/.test(p.html) === false), 'no empty year page emitted');
check(!pages.some((p) => p.html.includes('/#v=')), 'no SPA hash routes remain in the nav');
check(!pages.some((p) => /href="\/authors/.test(p.html)), 'no authors route');

// ---------------------------------------------------------------- CONTENT
const byId = new Map(enriched.map((b) => [b.id, b]));
const bookPageByRoute = new Map(bookPages.map((p) => [p.route, p]));
let proseLeak = 0;
for (const b of readBooks) {
  if (!b.summary || b.summary.length <= 140) continue;
  const own = `/book/${ledger[b.id]}`;
  for (const p of generated) {
    if (p.route === own) continue;
    if (p.html.includes(b.summary)) { proseLeak++; if (proseLeak < 4) fails.push(`full summary of ${b.id} leaked onto ${p.route}`); }
  }
}
check(proseLeak === 0, 'full summary and core ideas appear on the book page and nowhere else', `${proseLeak} leaks`);
const nonPublic = new Set(enriched.filter((b) => !b.public).map((b) => b.id));
const unread = new Set(enriched.filter((b) => b.shelf !== 'read').map((b) => b.id));
const leaked = [];
for (const p of generated) {
  for (const m of p.html.matchAll(/href="\/book\/([a-z0-9-]+)"/g)) {
    const id = Object.keys(ledger).find((k) => ledger[k] === m[1]);
    if (!id) { leaked.push(`${p.route} -> unknown slug ${m[1]}`); continue; }
    if (nonPublic.has(id)) leaked.push(`${p.route} links non-public ${id}`);
    if (unread.has(id) && !p.route.startsWith('/up-next')) leaked.push(`${p.route} links unread ${id}`);
  }
}
check(leaked.length === 0, 'no non-public or unread book rendered anywhere', leaked.slice(0, 4).join(' | '));

// ---------------------------------------------------------------- CONNECTIONS
const cmap = connectionMap(enriched);
let selfLink = 0, unresolvedConn = 0, asymmetric = 0;
for (const b of readBooks) {
  const page = bookPageByRoute.get(`/book/${ledger[b.id]}`);
  if (!page) continue;
  if (page.html.includes(`href="/book/${ledger[b.id]}"`)) {
    // self-link only counts inside the connections module
    const mod = page.html.split('id="connections"')[1] || '';
    if (mod.includes(`href="/book/${ledger[b.id]}"`)) selfLink++;
  }
  for (const t of cmap.get(b.id) || []) {
    if (!bookPageByRoute.has(`/book/${ledger[t]}`)) unresolvedConn++;
    // undirected: if A lists B, B must list A
    const other = bookPageByRoute.get(`/book/${ledger[t]}`);
    if (other && !(other.html.split('id="connections"')[1] || '').includes(`href="/book/${ledger[b.id]}"`)) asymmetric++;
  }
}
check(selfLink === 0, 'no book shows a connection to itself', `${selfLink}`);
check(unresolvedConn === 0, 'every connection resolves to an existing page', `${unresolvedConn} unresolved`);
check(asymmetric === 0, 'one-way pairs appear on both books', `${asymmetric} asymmetric`);
const ids = new Set(enriched.map((b) => b.id));
check(enriched.flatMap((b) => (b.conn || []).filter((c) => !ids.has(c))).length === 0, 'zero dangling references');
notes.push(`${uniquePairs(cmap).size} unique undirected pairs rendered`);

// ---------------------------------------------------------------- SCHEMA
const personIds = new Set();
let jsonBlocks = 0;
for (const p of pages) {
  const blocks = [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) fails.push(`${p.file}: no JSON-LD`);
  for (const [, body] of blocks) {
    jsonBlocks++;
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { fails.push(`${p.file}: JSON-LD does not parse — ${e.message}`); continue; }
    if (parsed['@type'] === 'Person') {
      personIds.add(parsed['@id']);
      if ('email' in parsed || 'telephone' in parsed) fails.push(`${p.file}: Person carries email/telephone`);
      if (parsed.sameAs.length !== 8) fails.push(`${p.file}: sameAs has ${parsed.sameAs.length} nodes, expected 8`);
    }
    if (parsed['@type'] === 'Book' && 'numberOfPages' in parsed) {
      if (!parsed.numberOfPages) fails.push(`${p.file}: numberOfPages is zero`);
    }
  }
}
passes.push(`all ${jsonBlocks} JSON-LD blocks parse`);
check(personIds.size === 1 && personIds.has(`${ORIGIN}/#alexdrost`), `Person @id identical across all ${pages.length} pages`, [...personIds].join(', '));
for (const token of ['aggregateRating', 'ratingValue', '"Review"', 'reviewRating', 'SearchAction']) {
  const bad = pages.filter((p) => p.html.includes(token));
  check(bad.length === 0, `no ${token} anywhere`, bad.slice(0, 3).map((b) => b.file).join(', '));
}

// ---------------------------------------------------------------- SEO
const titles = new Map(), descs = new Map();
for (const p of generated) {
  const t = /<title>([\s\S]*?)<\/title>/.exec(p.html)?.[1] ?? '';
  const d = /<meta name="description" content="([\s\S]*?)">/.exec(p.html)?.[1] ?? '';
  if (!t) fails.push(`${p.route}: no title`);
  if (!d) fails.push(`${p.route}: no description`);
  if (titles.has(t)) fails.push(`duplicate title: "${t.slice(0, 60)}" on ${p.route} and ${titles.get(t)}`); else titles.set(t, p.route);
  if (descs.has(d)) fails.push(`duplicate description on ${p.route} and ${descs.get(d)}`); else descs.set(d, p.route);
  if (!/<link rel="canonical" href="[^"]+">/.test(p.html)) fails.push(`${p.route}: no canonical`);
  for (const tag of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']) {
    if (!p.html.includes(`property="${tag}"`)) fails.push(`${p.route}: missing ${tag}`);
  }
}
passes.push(`unique title and description on all ${generated.length} generated pages`);
passes.push('canonical + full OG set on every page');
for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
  const bad = pages.filter((p) => p.html.includes(host));
  check(bad.length === 0, `no reference to ${host}`, bad.slice(0, 3).map((b) => b.file).join(', '));
}

// gate
const gatedExpected = readBooks.filter((b) => proseWords(b) < LAUNCH_THRESHOLD);
let gatedOk = 0;
for (const b of gatedExpected) {
  const p = bookPageByRoute.get(`/book/${ledger[b.id]}`);
  if (p && p.html.includes('content="noindex,follow"')) gatedOk++;
  else fails.push(`gated page /book/${ledger[b.id]} is missing noindex,follow`);
}
check(gatedOk === gatedExpected.length, `all ${gatedExpected.length} thin pages carry noindex,follow`);
const sm = read(path.join(DIST, 'sitemap.xml'));
const locs = new Set([...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(ORIGIN, '') || '/'));
check(![...gatedExpected].some((b) => locs.has(`/book/${ledger[b.id]}`)), 'no gated page appears in the sitemap');
const emitted = new Set(pages.map((p) => (p.route === '' ? '/' : p.route)));
check([...locs].every((l) => emitted.has(l)), 'sitemap has no entry that 404s');
const indexablePages = generated.filter((p) => !p.html.includes('content="noindex'));
check(indexablePages.every((p) => locs.has(p.route)), 'no indexable page orphaned from the sitemap',
  indexablePages.filter((p) => !locs.has(p.route)).slice(0, 4).map((p) => p.route).join(', '));
check(locs.size === indexablePages.length, `sitemap size matches indexable page count (${locs.size})`, `pages ${indexablePages.length}`);
check(!locs.has('/404'), 'sitemap excludes /404');
check(notFound.html.includes('content="noindex,follow"') || notFound.html.includes('content="noindex'), '404 is noindex');
const robots = read(path.join(DIST, 'robots.txt'));
check(robots.includes('Allow: /') && !/Disallow:\s*\S/.test(robots), 'robots.txt allows everything');
check(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`), 'robots.txt points at the sitemap');

// internal links resolve
const unresolved = [];
for (const p of pages) {
  for (const m of p.html.matchAll(/href="(\/[^"#?]*)(?:[#?][^"]*)?"/g)) {
    const href = m[1].replace(/\/$/, '') || '/';
    if (/^\/(assets|styles|covers|data)\//.test(href) || href === '/books.json') {
      if (!fs.existsSync(path.join(DIST, href.slice(1))) && !href.startsWith('/covers/')) unresolved.push(`${p.route} -> ${href}`);
      continue;
    }
    if (!emitted.has(href)) unresolved.push(`${p.route} -> ${href}`);
  }
}
check(unresolved.length === 0, 'every internal link resolves', [...new Set(unresolved)].slice(0, 6).join(' | '));

// ---------------------------------------------------------------- PERFORMANCE / MOBILE
const imgs = pages.flatMap((p) => [...p.html.matchAll(/<img[^>]*src="\/covers\/[^"]*"[^>]*>/g)].map((m) => ({ route: p.route, tag: m[0] })));
const badImgs = imgs.filter((i) => !/width="/.test(i.tag) || !/height="/.test(i.tag) || !/alt="/.test(i.tag) || !/loading="/.test(i.tag));
check(badImgs.length === 0, `every cover <img> has width/height/alt/loading (${imgs.length} checked)`, badImgs.slice(0, 2).map((b) => b.route).join(', '));
for (const f of ['app.js', 'library.js', 'graph.js', 'analytics.js']) {
  const js = read(path.join(DIST, 'assets/js', f));
  if (/probeImg\s*\(/.test(js)) fails.push(`${f}: probeImg survives`);
  if (/covers\.openlibrary\.org|googleapis\.com\/books/.test(js)) fails.push(`${f}: third-party cover fallback survives`);
}
passes.push('no probeImg and no third-party cover fallback in any module');
const preload = pages.filter((p) => /<script[^>]*src="[^"]*"(?![^>]*defer)/.test(p.html));
check(preload.length === 0, 'every script tag is deferred — nothing blocks first paint', preload.slice(0, 3).map((p) => p.route).join(', '));
check(!pages.some((p) => /fetch\(['"]\/books\.json/.test(p.html)), 'no page fetches books.json inline before paint');

// ---------------------------------------------------------------- OUT
console.log(`\n${passes.length} checks passed`);
for (const n of notes) console.log(`  · ${n}`);
if (fails.length) {
  console.log(`\n\x1b[1mFAILED (${fails.length})\x1b[0m`);
  for (const f of fails.slice(0, 30)) console.log(`  ✗ ${f}`);
  if (fails.length > 30) console.log(`  … ${fails.length - 30} more`);
  process.exit(1);
}
console.log('\x1b[1mQA PASSED\x1b[0m — all checks green\n');
