// tools/og/prototype.mjs — PHASE 1 ONLY. Renders the stress set and a contact sheet.
//
//   node tools/og/prototype.mjs
//
// Nothing here writes into dist/ or touches the build. Every stress case is SELECTED BY
// CODE from books.json rather than hand-picked, so the set stays honest as the data grows.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT, SRC, fonts, renderCard, renderCardPng, warnings, THEME_COLORS, C } from './lib.mjs';
import { buildBookCard } from './cards/book.mjs';
import { sectionCard, artFor } from './cards/section.mjs';
import { homeCard, recentFour } from './cards/home.mjs';

const OUT = path.join(ROOT, 'og-prototype');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data/books.json'), 'utf8'));
const themesCfg = JSON.parse(fs.readFileSync(path.join(SRC, 'data/themes.json'), 'utf8')).themes;
const DISPLAY = Object.fromEntries(themesCfg.map((t) => [t.source, t.name]));

const coversDir = path.join(SRC, 'covers');
const hasCover = (id) => fs.existsSync(path.join(coversDir, `${id}.jpg`));

const read = data.books
  .filter((b) => b.shelf === 'read')
  .map((b) => ({
    ...b,
    themesSource: b.themes || [],
    themes: (b.themes || []).map((t) => DISPLAY[t] || t),
    hasCover: hasCover(b.id),
  }));
const ordered = read.slice().sort((a, b) => String(b.dateRead || '').localeCompare(String(a.dateRead || '')));

// ---------------------------------------------------------------- stress selection
const magic = (id) => {
  const f = path.join(coversDir, `${id}.jpg`);
  if (!fs.existsSync(f)) return null;
  const b = Buffer.alloc(12);
  const fd = fs.openSync(f, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  return 'other';
};

const withCover = read.filter((b) => b.hasCover);
const byLen = (f) => (a, b) => f(a).length - f(b).length;
const title = (b) => b.title || '';
const author = (b) => b.author || '';

const ratios = await Promise.all(withCover.map(async (b) => {
  try { const m = await sharp(path.join(coversDir, `${b.id}.jpg`)).metadata(); return { b, r: m.width / m.height, w: m.width, h: m.height, fmt: m.format }; }
  catch { return null; }
}));
const ok = ratios.filter(Boolean);
const widest = ok.slice().sort((x, y) => y.r - x.r)[0];
const tallest = ok.slice().sort((x, y) => x.r - y.r)[0];

const colon = (b) => title(b).includes(':');
const pick = (label, book, note = '', mutate = (x) => x) => book ? { label, note, book: mutate({ ...book }) } : null;

const CASES = [
  pick('Shortest title', read.slice().sort(byLen(title))[0], 'min title length'),
  pick('Longest title', read.slice().sort(byLen(title)).at(-1), 'max title length'),
  pick('Short title WITH a colon', read.filter((b) => colon(b) && title(b).length <= 40).sort(byLen(title)).at(-1),
    'must stay whole — no subtitle demotion'),
  pick('Long title with a colon', read.filter((b) => colon(b) && title(b).length > 40).sort(byLen(title)).at(-1),
    'splits on the first colon'),
  pick('Longest author string', read.slice().sort(byLen(author)).at(-1), 'multiple authors, comma separated'),
  pick('Non-JPEG cover under a .jpg name', withCover.find((b) => magic(b.id) && magic(b.id) !== 'jpeg'),
    `sharp sniffs the real format (${(() => { const b = withCover.find((x) => magic(x.id) && magic(x.id) !== 'jpeg'); return b ? magic(b.id) : 'n/a'; })()})`),
  pick('Curly apostrophe / em dash in title', read.find((b) => /[’—“”]/.test(title(b))), 'glyph coverage'),
  pick('Religion & Faith', read.find((b) => (b.themesSource || []).includes('Religion & Faith')),
    'Notion stores "Religion & Faith", the card must show "Theology & Faith"'),
  pick('No read date', read.find((b) => !b.dateRead), 'the Read line is omitted entirely'),
  widest ? pick('Widest cover', widest.b, `${widest.w}x${widest.h}, ratio ${widest.r.toFixed(2)}`) : null,
  tallest ? pick('Tallest cover', tallest.b, `${tallest.w}x${tallest.h}, ratio ${tallest.r.toFixed(2)}`) : null,
  pick('Missing cover (forced)', ordered[3], 'falls back to the site’s own .ph gradient', (b) => ({ ...b, hasCover: false })),
].filter(Boolean);

// ---------------------------------------------------------------- render
const results = [];
async function shoot(name, label, note, tree) {
  const t0 = process.hrtime.bigint();
  const jpg = await renderCard(tree);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const file = `${name}.jpg`;
  fs.writeFileSync(path.join(OUT, file), jpg);
  const meta = await sharp(jpg).metadata();
  results.push({ file, label, note, kb: jpg.length / 1024, ms, dim: `${meta.width}x${meta.height}` });
  process.stdout.write(`  ${label.padEnd(38)} ${String(Math.round(jpg.length / 1024)).padStart(4)} kB  ${ms.toFixed(0).padStart(4)} ms\n`);
}

console.log('\nBOOK CARDS — stress set selected from books.json');
fonts();
for (const [i, c] of CASES.entries()) {
  await shoot(`book-${String(i + 1).padStart(2, '0')}`, c.label,
    `${c.note} · “${c.book.title}”`, await buildBookCard(c.book));
}

console.log('\nSECTION CARDS');
const themeSrc = 'History & Foreign Affairs';
const themeBooks = ordered.filter((b) => (b.themesSource || []).includes(themeSrc));
await shoot('section-theme', 'Theme page', `/themes/history-and-foreign-affairs · ${themeBooks.length} books`,
  sectionCard({
    kicker: 'Theme', title: DISPLAY[themeSrc] || themeSrc,
    subline: `${themeBooks.length} books`, accent: THEME_COLORS[themeSrc],
    art: await artFor(themeBooks, 6),
  }));

const YEAR = '2025';
const yearBooks = ordered.filter((b) => String(b.dateRead || '').startsWith(YEAR));
await shoot('section-year', 'Year page', `/${YEAR} · ${yearBooks.length} books read`,
  sectionCard({
    kicker: 'Year in reading', title: YEAR,
    subline: `${yearBooks.length} books read`,
    art: await artFor(yearBooks, 8, 150, 225),
  }));

const pairs = new Set();
for (const b of read) for (const c of (b.conn || [])) pairs.add([b.id, c].sort().join('-'));
const degree = new Map();
for (const b of read) degree.set(b.id, (b.conn || []).length);
const topLinked = read.slice().sort((a, b) =>
  (degree.get(b.id) - degree.get(a.id)) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
await shoot('section-connections', 'Connections', `/connections · ${pairs.size} links`,
  sectionCard({
    kicker: 'Connections', title: 'The web of connections',
    subline: `${pairs.size.toLocaleString('en-US')} hand-made links between books`,
    art: await artFor(topLinked, 6),
  }));

// ---------------------------------------------------------------- home card port
// The riskiest item in the handoff: share.png is currently rendered by Chromium and the
// brief says to port the design "exactly". Rendered here so the port can be compared to
// the original side by side before Phase 3 commits to it.
console.log('\nHOME CARD (port of tools/make-og.mjs)');
{
  const t0 = process.hrtime.bigint();
  const png = await renderCardPng(homeCard(recentFour(data.books)));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeFileSync(path.join(OUT, 'home-satori.png'), png);
  const meta = await sharp(png).metadata();
  results.push({ file: 'home-satori.png', label: 'Home card — Satori port',
    note: 'porting src/share.png off Chromium · compare with the current file below',
    kb: png.length / 1024, ms, dim: `${meta.width}x${meta.height}` });
  process.stdout.write(`  ${'Satori port'.padEnd(38)} ${String(Math.round(png.length / 1024)).padStart(4)} kB  ${ms.toFixed(0).padStart(4)} ms\n`);

  fs.copyFileSync(path.join(SRC, 'share.png'), path.join(OUT, 'home-current.png'));
  const cur = await sharp(path.join(SRC, 'share.png')).metadata();
  results.push({ file: 'home-current.png', label: 'Home card — what ships today',
    note: 'src/share.png, committed, rendered by Chromium via tools/make-og.mjs',
    kb: fs.statSync(path.join(SRC, 'share.png')).size / 1024, ms: 0, dim: `${cur.width}x${cur.height}` });
  process.stdout.write(`  ${'current share.png (Chromium)'.padEnd(38)} ${String(Math.round(fs.statSync(path.join(SRC, 'share.png')).size / 1024)).padStart(4)} kB\n`);
}

// ---------------------------------------------------------------- contact sheet
const rows = results.map((r) => `
  <section class="row">
    <div class="meta">
      <h2>${r.label}</h2>
      <p class="note">${r.note.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>
      <p class="stat">${r.dim} · ${r.kb.toFixed(0)} kB · ${r.ms.toFixed(0)} ms · <code>${r.file}</code></p>
    </div>
    <div class="shots">
      <figure><figcaption>1200 &times; 630 — full size</figcaption><img class="full" src="${r.file}"></figure>
      <figure><figcaption>600 &times; 315 — how most feeds show it</figcaption><img class="half" src="${r.file}"></figure>
    </div>
  </section>`).join('');

fs.writeFileSync(path.join(OUT, 'contact-sheet.html'), `<!doctype html><html><head><meta charset="utf-8">
<title>OG card prototype — bookshelf.drost.us</title><style>
:root{--ink:#1f2530;--ink2:#3d4654;--muted:#6b7480;--line:#e6e3da;--paper:#f6f5f1}
*{box-sizing:border-box}
body{margin:0;padding:40px 44px 80px;background:var(--paper);color:var(--ink);
  font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
h1{font-size:34px;letter-spacing:-.02em;margin:0 0 6px}
.lede{color:var(--ink2);max-width:74ch;margin:0 0 10px}
.warn{color:#b3564c;max-width:74ch;margin:0 0 28px;font-size:14px}
.row{display:flex;gap:30px;align-items:flex-start;padding:26px 0;border-top:1px solid var(--line)}
.meta{width:270px;flex:none;position:sticky;top:20px}
.meta h2{font-size:17px;margin:0 0 6px;letter-spacing:-.01em}
.note{color:var(--ink2);font-size:13.5px;margin:0 0 8px}
.stat{color:var(--muted);font-size:12.5px;margin:0;font-variant-numeric:tabular-nums}
code{font-size:12px;background:#ecebe4;padding:1px 5px;border-radius:4px}
.shots{display:flex;gap:26px;align-items:flex-start;flex-wrap:wrap}
figure{margin:0}
figcaption{font-size:11.5px;color:var(--muted);margin-bottom:6px;letter-spacing:.04em;text-transform:uppercase}
img{display:block;border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 20px rgba(31,37,48,.08)}
img.full{width:600px}
img.half{width:300px}
</style></head><body>
<h1>OG card prototype</h1>
<p class="lede">${results.length} cards. Every book case was selected by code from
<code>books.json</code>, not chosen by hand. Images are shown at half their real pixel size
(the &ldquo;full size&rdquo; column is a 1200&times;630 card displayed at 600px) and again at
300px, which is roughly how a card appears in a LinkedIn or Slack feed.</p>
<p class="warn">Phase 1 of the OG handoff. Nothing is wired into the build yet and no meta
tags have changed.</p>
${rows}
</body></html>`);

const total = results.reduce((n, r) => n + r.kb, 0);
console.log(`\n  ${results.length} cards · ${total.toFixed(0)} kB total · largest ${Math.max(...results.map((r) => r.kb)).toFixed(0)} kB`);
console.log(`  slowest ${Math.max(...results.map((r) => r.ms)).toFixed(0)} ms · mean ${(results.reduce((n, r) => n + r.ms, 0) / results.length).toFixed(0)} ms`);
const w = warnings();
console.log(`  warnings: ${w.length}${w.length ? '\n    - ' + w.join('\n    - ') : ''}`);
console.log(`\n  -> og-prototype/contact-sheet.html\n`);
