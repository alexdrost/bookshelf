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
  ['/about/', 'about'], ['/reading/', 'reading'], ['/picks/', 'picks'], ['/up-next/', 'up-next'], ['/404.html', '404'],
];

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let ok = true;

async function visit(route, label, width, shoot = false) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const errors = [];
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 120)}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 120)}`));
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
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
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

await browser.close();
server.close();
console.log(ok ? '\n\x1b[1mVISUAL + RUNTIME CHECK PASSED\x1b[0m\n' : '\n\x1b[1mCHECK FAILED\x1b[0m\n');
process.exit(ok ? 0 : 1);
