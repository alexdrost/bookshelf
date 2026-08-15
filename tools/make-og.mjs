// tools/make-og.mjs — render src/share.png (the og:image) from live data.
//
//   node tools/make-og.mjs
//
// The card shows the four most recently finished books, each on its own theme-coloured
// cluster. Generating it rather than hand-designing it means the "RECENTLY READ" label
// stays true: re-run after any sync and the card is current. 1200×630 at 2× → 2400×1260.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const books = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/books.json'), 'utf8')).books;

// The site's own theme palette.
const THEME_COLORS = {
  'Politics & Power': '#3a6ea5', 'Business & Finance': '#c6913f', 'History & Foreign Affairs': '#9c7b57',
  'Personal Growth & Leadership': '#88a04a', 'Memoir & Biography': '#8268a6', 'Psychology & Mind': '#3a8fb0',
  'Society & Culture': '#b06a93', 'Religion & Faith': '#b3864c', 'Tech & Future': '#5a66ad',
  'Crime & Justice': '#b3564c', 'Other': '#9aa0a6',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const recent = books
  .filter((b) => b.shelf === 'read' && b.dateRead && b.public !== false)
  .sort((a, b) => b.dateRead.localeCompare(a.dateRead))
  .slice(0, 4)
  .map((b) => {
    const [y, m] = b.dateRead.split('/');
    return {
      title: b.title.split(':')[0],
      author: b.author.split(',')[0].trim(),
      when: `${MONTHS[+m - 1]} ${y}`,
      color: THEME_COLORS[(b.themes || [])[0]] || THEME_COLORS.Other,
    };
  });

const fontFace = (family, weight, file) => {
  const p = path.join(ROOT, 'src/assets/fonts', file);
  return `@font-face{font-family:"${family}";font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format("woff2")}`;
};
const FONTS = [
  fontFace('Archivo', 600, 'archivo-latin-600-normal.woff2'),
  fontFace('Archivo', 700, 'archivo-latin-700-normal.woff2'),
  fontFace('Archivo', 800, 'archivo-latin-800-normal.woff2'),
  fontFace('Inter', 400, 'inter-latin-400-normal.woff2'),
  fontFace('Inter', 500, 'inter-latin-500-normal.woff2'),
  fontFace('Inter', 600, 'inter-latin-600-normal.woff2'),
].join('\n');

// Hand-placed clusters, in the 1200×630 coordinate space. Deterministic by design —
// a random layout would make every rebuild produce a different image.
const CLUSTERS = [
  { hub: [1058, 205], sats: [[1140, 168], [1006, 262], [1120, 262], [990, 150], [1152, 228]], card: [636, 100] },
  { hub: [1006, 348], sats: [[1092, 322], [960, 300], [1080, 392], [946, 402]], card: [616, 258] },
  { hub: [1064, 470], sats: [[1148, 448], [1000, 440], [1136, 522], [1006, 516], [1070, 556]], card: [616, 396] },
  { hub: [1002, 572], sats: [[1088, 588], [920, 560], [1078, 528], [946, 610]], card: [636, 512] },
];

const dots = (c, i) => {
  const col = recent[i].color;
  const [hx, hy] = c.hub;
  return c.sats.map(([x, y]) =>
    `<line x1="${hx}" y1="${hy}" x2="${x}" y2="${y}" stroke="${col}" stroke-opacity=".38" stroke-width="1.6"/>`
  ).join('') +
    c.sats.map(([x, y], j) =>
      `<circle cx="${x}" cy="${y}" r="${j % 2 ? 8 : 10}" fill="${col}" fill-opacity="${j % 2 ? 0.42 : 0.72}"/>`
    ).join('') +
    `<circle cx="${hx}" cy="${hy}" r="21" fill="none" stroke="${col}" stroke-opacity=".3" stroke-width="7"/>` +
    `<circle cx="${hx}" cy="${hy}" r="14" fill="${col}"/><circle cx="${hx}" cy="${hy}" r="14" fill="none" stroke="#fff" stroke-width="3.5"/>`;
};

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${FONTS}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;position:relative;
  font-family:"Inter",sans-serif;-webkit-font-smoothing:antialiased;
  background:
    radial-gradient(120% 90% at 88% 8%, rgba(58,110,165,.13) 0%, transparent 55%),
    radial-gradient(90% 70% at 4% 92%, rgba(198,145,63,.10) 0%, transparent 50%),
    #f6f5f1;}
.grid{position:absolute;inset:0;
  background-image:linear-gradient(rgba(31,37,48,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(31,37,48,.045) 1px,transparent 1px);
  background-size:48px 48px}
.left{position:absolute;left:74px;top:62px;width:520px}
.brand{display:flex;align-items:center;gap:14px}
.brand .bt{font-family:"Archivo";font-weight:800;font-size:29px;color:#1f2530;letter-spacing:-.02em;line-height:1}
.brand .bs{font-family:"Archivo";font-weight:600;font-size:12.5px;letter-spacing:.22em;color:#3a6ea5;margin-top:7px}
h1{font-family:"Archivo";font-weight:800;font-size:78px;line-height:.99;letter-spacing:-.035em;color:#1f2530;margin-top:118px}
h1 em{font-style:normal;color:#3a6ea5}
.sub{font-size:22px;line-height:1.4;color:#3d4654;font-style:italic;margin-top:30px;max-width:430px}
.pill{position:absolute;left:74px;top:512px;border:1.5px solid #aecbe2;border-radius:32px;padding:14px 30px;
  font-family:"Archivo";font-weight:700;font-size:19px;color:#2c5680;background:rgba(255,255,255,.6)}
.kick{position:absolute;right:74px;top:70px;display:flex;align-items:center;gap:13px;
  font-family:"Archivo";font-weight:600;font-size:12.5px;letter-spacing:.22em;color:#6b7480}
.kick i{display:block;width:34px;height:1.5px;background:#a3abb5}
svg{position:absolute;inset:0}
.card{position:absolute;width:322px;background:#fff;border-radius:13px;padding:12px 18px 13px 14px;
  box-shadow:0 5px 22px rgba(31,37,48,.13),0 1px 3px rgba(31,37,48,.07);display:flex;gap:13px;align-items:center}
.card .n{width:29px;height:29px;border-radius:50%;flex:none;color:#fff;font-family:"Archivo";font-weight:700;
  font-size:14px;display:flex;align-items:center;justify-content:center}
.card .t{display:block;font-family:"Archivo";font-weight:700;font-size:18.5px;color:#1f2530;line-height:1.16;letter-spacing:-.01em;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .m{display:block;font-size:14px;color:#6b7480;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .body{min-width:0;flex:1}
</style></head><body>
<div class="grid"></div>
<svg width="1200" height="630">${CLUSTERS.map(dots).join('')}</svg>
<div class="kick"><i></i>RECENTLY READ</div>
<div class="left">
  <div class="brand">
    <svg width="40" height="40" viewBox="0 0 40 40" style="position:static;flex:none">
      <rect x="8" y="9" width="9" height="23" rx="1.5" fill="#2e6fb5"/>
      <rect x="17.5" y="11" width="8" height="21" rx="1.5" fill="#5b97d4"/>
      <rect x="25" y="8" width="8" height="24" rx="1.5" transform="rotate(7 29 20)" fill="#2f9e6b"/>
    </svg>
    <div><div class="bt">Alex&rsquo;s Bookshelf</div><div class="bs">A READING LIBRARY</div></div>
  </div>
  <h1>What I&rsquo;ve<br>been <em>reading.</em></h1>
  <div class="sub">A small history of the books I&rsquo;ve lived with.</div>
</div>
<div class="pill">bookshelf.drost.us</div>
${recent.map((b, i) => `<div class="card" style="left:${CLUSTERS[i].card[0]}px;top:${CLUSTERS[i].card[1]}px">
  <span class="n" style="background:${b.color}">${i + 1}</span>
  <span class="body"><span class="t">${esc(b.title)}</span><span class="m">${esc(b.author)} &middot; ${b.when}</span></span>
</div>`).join('')}
</body></html>`;

const tmp = path.join(ROOT, '.og.html');
fs.writeFileSync(tmp, html);
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ROOT, 'src/share.png') });
await browser.close();
fs.unlinkSync(tmp);
console.log('✓ src/share.png — four most recent reads:');
for (const [i, b] of recent.entries()) console.log(`   ${i + 1}. ${b.title} · ${b.author} · ${b.when}`);
console.log(`   ${(fs.statSync(path.join(ROOT, 'src/share.png')).size / 1024).toFixed(0)} kB, 2400×1260`);
