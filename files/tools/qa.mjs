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
// The floor is read out of build.mjs rather than restated, so this check cannot
// quietly disagree with the generator the way a hardcoded 2020 just did.
const YEAR_FLOOR = (() => {
  const m = /const YEAR_FLOOR = (\d{4});/.exec(read(path.join(ROOT, 'tools/build.mjs')));
  if (!m) throw new Error('qa: could not read YEAR_FLOOR out of tools/build.mjs');
  return +m[1];
})();
const yearsInData = [...new Set(readBooks.map((b) => b.yearRead).filter((y) => y && +y >= YEAR_FLOOR))].sort();
check(yearPages.length === yearsInData.length, `${yearsInData.length} year pages (floor ${YEAR_FLOOR})`, `found ${yearPages.length}`);
// Stronger than the old "no page for 2019": no year page may exist BELOW the floor,
// whatever the floor is set to, and no book below it may lose its library entry.
const belowFloor = yearPages.filter((p) => +p.route.slice(1) < YEAR_FLOOR).map((p) => p.route);
check(belowFloor.length === 0, `no year page below ${YEAR_FLOOR}`, belowFloor.join(', '));
const preFloorBooks = readBooks.filter((b) => b.yearRead && +b.yearRead < YEAR_FLOOR);
const libraryHtml = pages.filter((p) => p.route === '/library' || /^\/library\/\d+$/.test(p.route)).map((p) => p.html).join('');
const strandedPreFloor = preFloorBooks.filter((b) => !libraryHtml.includes(`/book/${b.slug}`)).map((b) => b.slug);
check(strandedPreFloor.length === 0,
  `all ${preFloorBooks.length} pre-${YEAR_FLOOR} books still reachable in the library`,
  strandedPreFloor.slice(0, 5).join(', '));
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
const websiteIds = new Set();
let jsonBlocks = 0;
for (const p of pages) {
  const blocks = [...p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length) fails.push(`${p.file}: no JSON-LD`);
  for (const [, body] of blocks) {
    jsonBlocks++;
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { fails.push(`${p.file}: JSON-LD does not parse — ${e.message}`); continue; }
    // Person and WebSite ship as a two-node @graph, so walk the graph as well as the root.
    for (const node of (parsed['@graph'] ?? [parsed])) {
      if (node['@type'] === 'Person') {
        personIds.add(node['@id']);
        if ('email' in node || 'telephone' in node) fails.push(`${p.file}: Person carries email/telephone`);
        if (node.sameAs.length !== 8) fails.push(`${p.file}: sameAs has ${node.sameAs.length} nodes, expected 8`);
      }
      if (node['@type'] === 'WebSite') {
        websiteIds.add(node['@id']);
        // The whole point of the graph is that WebSite points at Person by @id.
        if (node.author?.['@id'] !== `${ORIGIN}/#alexdrost`) fails.push(`${p.file}: WebSite.author does not reference the Person @id`);
        if (node.publisher?.['@id'] !== `${ORIGIN}/#alexdrost`) fails.push(`${p.file}: WebSite.publisher does not reference the Person @id`);
      }
      if (node['@type'] === 'Book' && 'numberOfPages' in node) {
        if (!node.numberOfPages) fails.push(`${p.file}: numberOfPages is zero`);
      }
    }
  }
}
passes.push(`all ${jsonBlocks} JSON-LD blocks parse`);
check(personIds.size === 1 && personIds.has(`${ORIGIN}/#alexdrost`), `Person @id identical across all ${pages.length} pages`, [...personIds].join(', '));
check(websiteIds.size === 1 && websiteIds.has(`${ORIGIN}/#website`), `WebSite @id identical across all ${pages.length} pages`, [...websiteIds].join(', '));
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

// ---------------------------------------------------------------- OG IMAGES
// Every one of these exists because the failure is silent: a card that 404s, a stale
// tag, or a page quietly sharing the wrong image all look fine until someone posts a
// link and the preview is wrong.
{
  const attr = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
  const ogImg = (h) => attr(h, /<meta property="og:image" content="([^"]*)"/g);
  const twImg = (h) => attr(h, /<meta name="twitter:image" content="([^"]*)"/g);
  const stripV = (u) => u.split('?')[0];
  const toFile = (u) => path.join(DIST, stripV(u).replace(ORIGIN + '/', '').replace(/^https?:\/\/[^/]+\//, ''));

  const multi = pages.filter((p) => ogImg(p.html).length !== 1 || twImg(p.html).length !== 1);
  check(multi.length === 0, `exactly one og:image and one twitter:image on all ${pages.length} pages`,
    multi.slice(0, 3).map((p) => p.route).join(', '));

  const mismatch = pages.filter((p) => ogImg(p.html)[0] !== twImg(p.html)[0]);
  check(mismatch.length === 0, 'og:image and twitter:image agree on every page',
    mismatch.slice(0, 3).map((p) => p.route).join(', '));

  const urls = pages.map((p) => ogImg(p.html)[0]).filter(Boolean);
  const offOrigin = urls.filter((u) => !u.startsWith(ORIGIN + '/'));
  check(offOrigin.length === 0, `every image URL is on ${ORIGIN}`, offOrigin.slice(0, 2).join(', '));

  // No third-party host may appear in ANY og:/twitter: tag — zero third-party requests
  // is a design principle of this site and a social card is an easy place to lose it.
  const foreign = pages.flatMap((p) => attr(p.html, /<meta (?:property|name)="(?:og|twitter):[^"]*" content="(https?:\/\/[^"]*)"/g))
    .filter((u) => !u.startsWith(ORIGIN + '/'));
  check(foreign.length === 0, 'no third-party host in any og: or twitter: tag', [...new Set(foreign)].slice(0, 2).join(', '));

  const versioned = urls.filter((u) => /\?v=[0-9a-f]{10}$/.test(u));
  check(versioned.length === urls.length, 'every image URL carries a 10-hex ?v= cache key',
    `${urls.length - versioned.length} without`);

  const missing = [...new Set(urls)].filter((u) => !fs.existsSync(toFile(u)));
  check(missing.length === 0, `every referenced image exists in dist/ (${new Set(urls).size} distinct)`,
    missing.slice(0, 3).map(stripV).join(', '));

  // Dimensions and format, read from the files rather than trusted from the tags.
  const dim = (buf) => {
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {          // JPEG: walk the markers
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { fmt: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return { fmt: 'jpeg', w: 0, h: 0 };
    }
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { fmt: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    return { fmt: 'other', w: 0, h: 0 };
  };
  const badDim = [], tooBig = [];
  for (const u of new Set(urls)) {
    const f = toFile(u);
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f);
    const d = dim(buf);
    const isShare = f.endsWith('share.png');
    if (isShare ? (d.fmt !== 'png' || d.w !== 2400 || d.h !== 1260) : (d.fmt !== 'jpeg' || d.w !== 1200 || d.h !== 630)) {
      badDim.push(`${path.relative(DIST, f)} ${d.fmt} ${d.w}x${d.h}`);
    }
    if (buf.length > 300 * 1024) tooBig.push(`${path.relative(DIST, f)} ${(buf.length / 1024).toFixed(0)}kB`);
  }
  check(badDim.length === 0, 'every card is 1200x630 JPEG (share.png 2400x1260 PNG), read from the file', badDim.slice(0, 3).join(', '));
  check(tooBig.length === 0, 'every image is under 300 kB', tooBig.slice(0, 3).join(', '));

  const noAlt = pages.filter((p) => {
    const a = attr(p.html, /<meta property="og:image:alt" content="([^"]*)"/g)[0];
    const b = attr(p.html, /<meta name="twitter:image:alt" content="([^"]*)"/g)[0];
    return !a || !b || !a.trim() || !b.trim();
  });
  check(noAlt.length === 0, 'og:image:alt and twitter:image:alt are present and non-empty everywhere',
    noAlt.slice(0, 3).map((p) => p.route).join(', '));

  const noCard = pages.filter((p) => !/<meta name="twitter:card" content="summary_large_image">/.test(p.html));
  check(noCard.length === 0, 'twitter:card is summary_large_image on every page', noCard.slice(0, 3).map((p) => p.route).join(', '));

  // One image per book page, and no card for a book that has no page.
  const ogBookDir = path.join(DIST, 'og/book');
  const ogBookFiles = fs.existsSync(ogBookDir) ? fs.readdirSync(ogBookDir).filter((f) => f.endsWith('.jpg')) : [];
  check(ogBookFiles.length === bookPages.length && bookPages.length === readBooks.length,
    `${ogBookFiles.length} book cards = ${bookPages.length} book pages = ${readBooks.length} read books`);
  const readSlugs = new Set(readBooks.map((b) => ledger[b.id]));
  const orphan = ogBookFiles.map((f) => f.replace(/\.jpg$/, '')).filter((slug) => !readSlugs.has(slug));
  check(orphan.length === 0, 'no OG card exists for a book that is not on the read shelf', orphan.slice(0, 3).join(', '));

  // Every paginated library page advertises the same card — they differ only by offset.
  const libUrls = new Set(libraryPagesArr.map((p) => ogImg(p.html)[0]));
  check(libUrls.size === 1, `all ${libraryPagesArr.length} /library pages share one image`, [...libUrls].slice(0, 2).join(' vs '));

  // /404 has no card of its own and borrows the home image.
  if (notFound) {
    check(ogImg(notFound.html)[0] === ogImg(pages.find((p) => p.route === '/').html)[0],
      '/404 falls back to the home image rather than a card of its own');
  }

  // The card palette is a hand-copy of the generator's. Assert it has not drifted.
  const litColors = (src) => {
    const m = /const THEME_COLORS = \{([\s\S]*?)\};/.exec(src);
    return m ? [...m[1].matchAll(/'([^']+)':\s*'(#[0-9a-f]{6})'/g)].map((x) => `${x[1]}=${x[2]}`).sort().join(',') : '';
  };
  const a = litColors(read(path.join(ROOT, 'tools/build.mjs')));
  const b = litColors(read(path.join(ROOT, 'tools/og/lib.mjs')));
  check(a !== '' && a === b, 'THEME_COLORS in tools/og/lib.mjs matches tools/build.mjs');

  // The year floor exists twice — once for the generated pages, once for the
  // client-side charts. They are in different languages and cannot import each
  // other, so the only thing keeping them honest is this check.
  const clientFloor = /const YEAR_FLOOR="(\d{4})";/.exec(read(path.join(SRC, 'assets/js/app.js')));
  check(!!clientFloor && +clientFloor[1] === YEAR_FLOOR,
    `YEAR_FLOOR in src/assets/js/app.js matches tools/build.mjs (${YEAR_FLOOR})`,
    clientFloor ? clientFloor[1] : 'not found');
}

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
