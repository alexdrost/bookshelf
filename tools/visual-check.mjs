// tools/visual-check.mjs — runtime + layout verification across every page type.
//
// SESSION 1's pixel-identity test compared the SPA with its CSS inline vs extracted and
// passed; SESSION 2 retires the SPA as the front door, so that comparison no longer has
// a subject. What matters now is the risk introduced by the JS split: the original
// bindings assumed every view was in the DOM. This loads one page of each type and fails
// on ANY console error, page error, or failed request — which is precisely the failure
// mode a guarded extraction could still have.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, '.visual');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(DIST, p);
  // Mirror Cloudflare Pages: a directory URL resolves to its index.html.
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  else if (p.endsWith('/')) f = path.join(DIST, p, 'index.html');
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

// One representative route per template.
const firstBook = fs.readdirSync(path.join(DIST, 'book'))[0];
const firstTheme = fs.readdirSync(path.join(DIST, 'themes')).find((d) => fs.statSync(path.join(DIST, 'themes', d)).isDirectory());
const ROUTES = [
  ['/', 'home'], ['/library/', 'library'], ['/library/2/', 'library-2'],
  ['/themes/', 'themes-hub'], [`/themes/${firstTheme}/`, 'theme'],
  ['/timeline/', 'timeline'], ['/2025/', 'year'],
  ['/connections/', 'connections'], ['/analytics/', 'analytics'],
  [`/book/${firstBook}/`, 'book'],
  // /reading and /picks were renamed to /up-next and /recommendations in SESSION 3.
  // This list still asked for the old routes, so two of every run's "console error"
  // lines were the harness requesting pages that have not existed since.
  ['/about/', 'about'], ['/recommendations/', 'recommendations'], ['/up-next/', 'up-next'], ['/404.html', '404'],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ok = true;

async function visit(route, label, width, shoot = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  const page = await ctx.newPage();
  /* A 404 arrives as a `response`, which carries a URL, AND as a console line that
     does not ("Failed to load resource: …"). Only the response event can be filtered,
     so that is the one that fails the run; the bare console duplicate is dropped.
     Cover 404s are expected by design: a client-rendered card always requests
     /covers/{id}.jpg and swaps in the themed placeholder on error, so every book
     without a cover file legitimately produces one. */
  const HTTP_ERR = /^Failed to load resource: the server responded with a status of \d+/;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (HTTP_ERR.test(m.text())) return;
    errors.push(`console: ${m.text().slice(0, 120)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
  page.on('response', (r) => {
    if (r.status() < 400 || r.url().includes('/covers/')) return;
    errors.push(`http ${r.status()}: ${r.url().replace(base, '')}`);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.includes('/covers/')) return;     // covers are not staged in this workspace
    errors.push(`requestfailed: ${u.replace(base, '')}`);
  });
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const h1 = await page.evaluate(() => { const e = document.querySelector('h1'); return e ? getComputedStyle(e).fontFamily.split(',')[0] : '—'; });
  if (shoot) await page.screenshot({ path: path.join(OUT, `page-${label}-${width}.png`), fullPage: false });
  await ctx.close();
  return { overflow, h1, errors };
}

console.log('\nruntime + layout check — one page per template\n' + '='.repeat(70));
console.log('route'.padEnd(26) + 'w'.padEnd(7) + 'overflow'.padEnd(11) + 'h1 font'.padEnd(11) + 'errors');
for (const [route, label] of ROUTES) {
  for (const width of [390, 1440]) {
    const r = await visit(route, label, width, width === 1440);
    const bad = r.overflow > 0 || r.errors.length > 0;
    if (bad) ok = false;
    console.log(
      route.padEnd(26) + String(width).padEnd(7) +
      (r.overflow > 0 ? `\x1b[1m${r.overflow}px\x1b[0m` : '0px').padEnd(11) +
      r.h1.replace(/"/g, '').padEnd(11) +
      (r.errors.length ? `\x1b[1m${r.errors.join(' | ')}\x1b[0m` : 'none')
    );
  }
}

// The interactive layers must actually produce output, not just fail silently.
console.log('\ninteractive smoke tests');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/analytics/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const filled = await page.evaluate(() => ({
    stats: document.querySelectorAll('#statCards .stat').length,
    records: document.querySelectorAll('#records .rec').length,
    lag: document.querySelectorAll('#lagBars .mc').length,
    cum: document.querySelectorAll('#cumChart path').length,
    pace: document.querySelectorAll('#paceChart .dot').length,
    stack: document.querySelectorAll('#themeStack .stackcol').length,
    heat: document.querySelectorAll('#heatGrid .hm-cell').length,
  }));
  console.log('  /analytics panels rendered:', JSON.stringify(filled));
  if (Object.values(filled).some((n) => n === 0)) { ok = false; console.log('  \x1b[1m✗ an analytics panel rendered nothing\x1b[0m'); }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + '/connections/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => {
    const c = document.querySelector('#graphCanvas');
    return { canvasW: c ? c.width : 0, legend: document.querySelectorAll('#graphLegend .it').length };
  });
  // path finder end to end
  await page.fill('#pfA', 'Chip War');
  await page.waitForTimeout(350);
  await page.click('#pfListA li');
  await page.fill('#pfB', 'Empire of Pain');
  await page.waitForTimeout(350);
  await page.click('#pfListB li');
  await page.click('#pfGo');
  await page.waitForTimeout(300);
  const chain = await page.evaluate(() => document.querySelectorAll('#pfResult .pf-chain a').length);
  console.log(`  /connections graph canvas ${g.canvasW}px · legend ${g.legend} themes · path finder chain ${chain} books`);
  if (!g.canvasW || !g.legend || chain < 2) { ok = false; console.log('  \x1b[1m✗ connections interactive layer did not initialise\x1b[0m'); }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(base + '/connections/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const ego = await page.evaluate(() => ({ open: !!document.querySelector('#egoPanel.open'), items: document.querySelectorAll('#egoPanel .ego-item').length }));
  console.log(`  /connections on 390px: ego view ${ego.open ? 'open' : 'CLOSED'} with ${ego.items} neighbours`);
  if (!ego.open || ego.items === 0) { ok = false; console.log('  \x1b[1m✗ mobile ego view did not open\x1b[0m'); }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + '/connections/', { waitUntil: 'domcontentloaded' });
  const noJs = await page.evaluate(() => ({ words: document.body.innerText.trim().split(/\s+/).length, matrix: document.querySelectorAll('.matrix td').length, bridges: document.querySelectorAll('.pickcard').length }));
  console.log(`  /connections with JS disabled: ${noJs.words} words, ${noJs.matrix} matrix cells, ${noJs.bridges} bridge cards`);
  if (noJs.words < 300 || !noJs.matrix) { ok = false; console.log('  \x1b[1m✗ /connections is not meaningful without JavaScript\x1b[0m'); }
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + '/library/', { waitUntil: 'domcontentloaded' });
  const p = await page.evaluate(() => ({ cards: document.querySelectorAll('.book').length, next: !!document.querySelector('a[rel="next"]'), more: !!document.querySelector('#loadMore') }));
  console.log(`  /library with JS disabled: ${p.cards} cards, next anchor ${p.next}, load-more ${p.more}`);
  if (p.cards !== 24 || !p.next || !p.more) { ok = false; console.log('  \x1b[1m✗ library does not degrade to real pagination\x1b[0m'); }
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
  // Same rule as visit(): a cover 404 is the coverless-book placeholder path, not a fault.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of \d+/.test(m.text())) return;
    errs.push(m.text().slice(0, 120));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/covers/')) errs.push(`http ${r.status()}: ${r.url().replace(base, '')}`);
  });
  await page.goto(base + '/library/', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => document.querySelectorAll('#grid .book').length);
  await page.click('#loadMore');                       // infinite scroll
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => document.querySelectorAll('#grid .book').length);
  const url = page.url().replace(base, '');
  await page.click('#sortBtns button[data-s="title"]'); // hands over to renderBrowse
  await page.waitForTimeout(1600);
  const sorted = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#grid .book .t')].map((e) => e.textContent);
    return { n: t.length, first: t[0], ordered: t.slice(0, 30).every((x, i, a) => i === 0 || a[i - 1].localeCompare(x) <= 0) };
  });
  console.log(`  /library: ${before} -> ${after} cards after Load more (url ${url}); sort by title -> ${sorted.n} cards, first "${String(sorted.first).slice(0, 28)}", ordered ${sorted.ordered}`);
  if (after <= before || sorted.n < 300 || !sorted.ordered || errs.length) { ok = false; console.log('  \x1b[1m✗ library interaction failed\x1b[0m ' + errs.join(' | ')); }
  await ctx.close();
}

/* ============================================================================
   SESSION 5 — the behaviours that can break silently.
   Every check here exists because something in this family shipped broken before:
   an empty observeCovers() that left every client-rendered card without an <img>,
   a Jinja-ism that rendered 100 empty matrix cells, and a client-side BOOKS array
   that counted TBR books in the analytics. None of those failed a build.

   Expectations are derived from the built books.json, never hardcoded.
   ========================================================================== */
{
  const data = JSON.parse(fs.readFileSync(path.join(DIST, 'books.json'), 'utf8'));
  const READ = data.books.filter((b) => b.shelf === 'read').length;
  const UNREAD = data.books.filter((b) => b.shelf !== 'read');
  const PAIRS = new Set();
  {
    const idx = new Map(data.books.map((b, i) => [i, b]));
    for (const [a, b] of data.edges) {
      const A = idx.get(a), B = idx.get(b);
      if (A && B && A.shelf === 'read' && B.shelf === 'read') PAIRS.add(a < b ? `${a}-${b}` : `${b}-${a}`);
    }
  }
  console.log(`\nsession-5 interactions  (books.json: ${READ} read · ${UNREAD.length} unread · ${PAIRS.size} read-to-read pairs)`);

  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    // Turns off html{scroll-behavior:smooth}. Without it a scrollIntoView is still
    // animating when the pointer is placed, the page slides under a stationary cursor,
    // and the resulting mouseleave closes the popover mid-assertion.
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const check = (pass, msg) => { if (!pass) ok = false; console.log(`  ${pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`); };

  // ---- the shelf gate. Nothing but shelf:"read" may reach any client-side surface.
  await page.goto(base + '/analytics/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const gate = await page.evaluate(() => ({
    n: BOOKS.length,
    shelves: [...new Set(BOOKS.map((b) => b.shelf))],
    edgesResolve: EDGES.every(([a, b]) => a >= 0 && b >= 0 && a < BOOKS.length && b < BOOKS.length),
    pairs: new Set(EDGES.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`))).size,
  }));
  check(gate.n === READ, `BOOKS narrowed to ${gate.n} (books.json has ${READ} read)`);
  check(gate.shelves.length === 1 && gate.shelves[0] === 'read', `only shelf reaching the client: ${JSON.stringify(gate.shelves)}`);
  check(gate.edgesResolve, 'every remapped edge index resolves inside the narrowed BOOKS');
  check(gate.pairs === PAIRS.size, `${gate.pairs} undirected pairs survive the remap (expected ${PAIRS.size})`);
  if (UNREAD.length) {
    const leaked = await page.evaluate((titles) => titles.filter((t) => BOOKS.some((b) => b.title === t)),
      UNREAD.map((b) => b.title));
    check(!leaked.length, `no unread book reaches analytics${leaked.length ? ': ' + leaked.join(', ') : ''}`);
  }

  // ---- the year stack: full width, anchored popover, rows that are real links
  const seg = async () => {
    await page.evaluate(() => document.querySelector('#themeStack').closest('.panel').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const box = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#themeStack .seg')]
        .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(420);
  };
  const width = await page.evaluate(() => {
    const s = document.querySelector('#themeStack');
    return { side: !!document.querySelector('#stackDetail'),
      stack: s.getBoundingClientRect().width, panel: s.closest('.panel').getBoundingClientRect().width };
  });
  check(!width.side && width.stack > width.panel - 90,
    `hero stack runs full width: ${Math.round(width.stack)}px of ${Math.round(width.panel)}px, no side panel`);
  await seg();
  const pop = await page.evaluate(() => {
    const lp = document.querySelector('#listpop');
    const col = document.querySelector('#themeStack .stackcol.col-hot');
    const lr = lp.getBoundingClientRect(), cr = col && col.getBoundingClientRect();
    return { shown: lp.classList.contains('show'), rows: lp.querySelectorAll('a.mbk-row').length,
      covers: lp.querySelectorAll('a.mbk-row img').length, hot: !!col,
      href: lp.querySelector('a.mbk-row')?.getAttribute('href') || '',
      anchored: cr ? Math.abs((lr.left + lr.width / 2) - (cr.left + cr.width / 2)) < 160 : false };
  });
  check(pop.shown && pop.rows > 0, `hovering a band opens the popover (${pop.rows} rows)`);
  check(pop.covers === pop.rows, `every popover row carries a cover (${pop.covers}/${pop.rows})`);
  check(/^\/book\//.test(pop.href), `popover rows are book links (${pop.href})`);
  check(pop.hot, 'the hovered column is highlighted');
  check(pop.anchored, 'the popover is anchored over its column, not the cursor');
  const held = await (async () => {
    const r = await page.evaluate(() => {
      const b = document.querySelector('#listpop a.mbk-row').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(r.x, r.y, { steps: 6 });
    await page.waitForTimeout(320);
    return page.evaluate(() => document.querySelector('#listpop').classList.contains('show'));
  })();
  check(held, 'the popover survives the pointer moving into it, so its links are reachable');
  await page.mouse.move(4, 4);
  await page.waitForTimeout(400);
  const cleared = await page.evaluate(() => ({
    hot: document.querySelectorAll('.col-hot,.seg-hot').length,
    shown: document.querySelector('#listpop').classList.contains('show') }));
  check(cleared.hot === 0 && !cleared.shown, 'moving away clears the highlight and the popover');

  // ---- /library after the theme pills were removed: every control still works
  await page.goto(base + '/library/', { waitUntil: 'networkidle' });
  check(!(await page.$('#themeChips')), 'theme pill row is gone from /library');
  check(!!(await page.$('#activeFilters')), '#activeFilters survives (renderBrowse writes into it unconditionally)');
  await page.click('#sortBtns button[data-s="title"]');
  await page.waitForTimeout(1500);
  const sortedAll = await page.evaluate(() => document.querySelectorAll('#grid a.book').length);
  check(sortedAll === READ, `sorting still renders the whole shelf without the chips: ${sortedAll}`);
  await page.click('#browseReset');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => document.querySelectorAll('#grid a.book').length) === READ, 'reset restores the full grid');
  if (UNREAD.length) {
    const term = UNREAD[0].title.split(/[:\s]/).filter((w) => w.length > 4)[0] || UNREAD[0].title;
    await page.evaluate(() => openSearch());
    await page.waitForTimeout(500);
    await page.fill('#searchInput', term);
    await page.waitForTimeout(500);
    const hit = await page.evaluate((t) => (document.querySelector('#searchResults').textContent || '').includes(t), UNREAD[0].title);
    check(!hit, `site search does not surface unread books (searched "${term}")`);
  }

  // ---- /connections: order, the idle panel, and the deep link off a book page
  await page.goto(base + '/connections/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const conn = await page.evaluate(() => ({
    order: [...document.querySelectorAll('.pagesec h2')].map((h) => h.textContent.trim()),
    idle: !!document.querySelector('#egoPanel .ego-idle'),
    h: Math.round(document.querySelector('#egoPanel').getBoundingClientRect().height) }));
  check(conn.order[1] === 'How two books connect' && conn.order[2] === 'Explore the map',
    `section order: ${conn.order.join(' → ')}`);
  check(conn.idle && conn.h > 40, `focus panel shows its placeholder on arrival (${conn.h}px, never a 0px gap)`);

  // pick a book that actually has connections, so the assertions have something to bite on
  const slugs = JSON.parse(fs.readFileSync(path.join(DIST, 'data', 'slugs.json'), 'utf8'));
  const linked = data.books.find((b) => b.shelf === 'read' && (b.conn || []).length >= 3 && slugs[b.id]);
  if (linked) {
    await page.goto(`${base}/book/${slugs[linked.id]}/`, { waitUntil: 'networkidle' });
    const href = await page.getAttribute('.mapbtn', 'href');
    check(href === `/connections#book=${linked.id}`, `book page map link: ${href}`);
    await page.click('.mapbtn');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1600);
    const ego = await page.evaluate(() => {
      const p = document.querySelector('#egoPanel');
      const r = p.getBoundingClientRect();
      const head = p.closest('.pagesec').querySelector('h2').getBoundingClientRect();
      return { focused: p.classList.contains('focused'),
        title: p.querySelector('.ego-title')?.textContent.trim() || '',
        cover: !!p.querySelector('.ego-focus-cov img'),
        rows: p.querySelectorAll('.ego-item').length,
        rowCovers: p.querySelectorAll('.ego-item .ego-cov img').length,
        authorOnly: !/·/.test(p.querySelector('.ego-a')?.textContent || ''),
        inView: r.top > -40 && r.top < 460, headClear: head.top >= 58 && head.top < 300 };
    });
    check(ego.focused && ego.title.startsWith(linked.title.split(':')[0]), `deep link focuses the right book: "${ego.title.slice(0, 40)}"`);
    check(ego.cover, 'the focused book shows its own cover');
    check(ego.rows > 0 && ego.rowCovers === ego.rows, `every connection row has a cover (${ego.rowCovers}/${ego.rows})`);
    check(ego.authorOnly, 'connection rows show the author only, no shared-theme tail');
    check(ego.inView && ego.headClear, 'the page scrolls to the map section, heading clear of the sticky nav');
    await page.click('#egoBack');
    await page.waitForTimeout(300);
    const back = await page.evaluate(() => ({ idle: !!document.querySelector('#egoPanel .ego-idle'),
      h: Math.round(document.querySelector('#egoPanel').getBoundingClientRect().height) }));
    check(back.idle && back.h > 40, `clearing focus restores the placeholder rather than collapsing (${back.h}px)`);
  }

  // ---- one number everywhere. publicCount counts TBR; readCount is what the site says.
  const feet = [];
  for (const r of ['/', '/library/', '/connections/', '/analytics/', '/up-next/']) {
    await page.goto(base + r, { waitUntil: 'domcontentloaded' });
    feet.push((await page.textContent('.ft-sub')).trim());
  }
  const consistent = feet.every((t) => t.includes(String(READ))) && new Set(feet).size === 1;
  check(consistent, `footer says ${READ} on every page: "${feet[0]}"`);

  await ctx.close();
}

await browser.close();
server.close();
console.log(ok ? '\n\x1b[1mVISUAL + RUNTIME CHECK PASSED\x1b[0m\n' : '\n\x1b[1mCHECK FAILED\x1b[0m\n');
process.exit(ok ? 0 : 1);
