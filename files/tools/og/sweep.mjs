// tools/og/sweep.mjs — PHASE 1 VERIFICATION, not a deliverable.
//
//   node tools/og/sweep.mjs [--render]
//
// Renders the text column of every read book's card at its real width into an
// unclipped canvas and measures how tall it actually comes out. The middle row of a
// card is 434px; anything taller would collide with the footer rule. This is the only
// part of the card that can overflow — the cover is capped at 418px and the footer is
// pinned by a flex spacer. The budget dropped from 483 when the brand lockup took a
// band off the top of every card, so this sweep is what proves the new geometry.
//
// With --render it also rasterises all 327 cards, which is the real Phase 2 timing.

import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { ROOT, SRC, fonts, h, C, splitTitle, titleSize, readLine, renderCard } from './lib.mjs';
import { buildBookCard } from './cards/book.mjs';

const MIDDLE_ROW_H = 434;     // see the header comment
const TEXT_COL_W = 736;       // 1200 - 2*56 padding - 300 cover box - 52 gap
const DO_RENDER = process.argv.includes('--render');

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'data/books.json'), 'utf8'));
const themesCfg = JSON.parse(fs.readFileSync(path.join(SRC, 'data/themes.json'), 'utf8')).themes;
const DISPLAY = Object.fromEntries(themesCfg.map((t) => [t.source, t.name]));
const coversDir = path.join(SRC, 'covers');

const read = data.books.filter((b) => b.shelf === 'read').map((b) => ({
  ...b,
  themesSource: b.themes || [],
  themes: (b.themes || []).map((t) => DISPLAY[t] || t),
  hasCover: fs.existsSync(path.join(coversDir, `${b.id}.jpg`)),
}));

fonts();

/** Natural height of the text column, measured by rendering it unclipped. */
async function textHeight(book) {
  const { main, sub } = splitTitle(book.title);
  const size = sub.length > 70 ? Math.min(titleSize(main), 72) : titleSize(main);
  const subSize = sub.length > 130 ? 29 : sub.length > 80 ? 33 : Math.max(30, Math.round(size * 0.44));
  const when = readLine(book.dateRead);
  const tree = h('div', { style: { display: 'flex', flexDirection: 'column', width: TEXT_COL_W, backgroundColor: '#ffffff', alignItems: 'flex-start' } },
    h('div', { style: { display: 'block', fontFamily: 'Archivo', fontWeight: 800, fontSize: size, lineHeight: 1.06, letterSpacing: '-0.022em', color: '#000', lineClamp: 3 } }, main),
    sub ? h('div', { style: { display: 'block', fontFamily: 'Archivo', fontWeight: 600, fontSize: subSize, lineHeight: 1.22, letterSpacing: '-0.01em', color: '#000', marginTop: 12, lineClamp: 4 } }, sub) : null,
    h('div', { style: { display: 'block', fontFamily: 'Inter', fontWeight: 500, fontSize: 26, color: '#000', marginTop: 20, lineClamp: 2 } }, book.author || ''),
    // Theme chips are gone from the real card, so they are gone from the measurement
    // too — measuring a row the card no longer draws would report false headroom.
    when ? h('div', { style: { display: 'flex', fontFamily: 'Inter', fontWeight: 400, fontSize: 22, color: '#000', marginTop: 18 } }, when) : null);

  const svg = await satori(tree, { width: TEXT_COL_W, height: 1400, fonts: fonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: TEXT_COL_W } }).render().asPng();
  // resvg leaves everything outside the root div transparent; greyscaling RGBA without
  // flattening turns those pixels black and every card 'overflows'. Flatten onto white first.
  const { data: px, info } = await sharp(png).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let last = 0;
  for (let y = info.height - 1; y >= 0; y--) {
    let ink = false;
    for (let x = 0; x < info.width; x++) if (px[y * info.width + x] < 200) { ink = true; break; }
    if (ink) { last = y; break; }
  }
  return last + 1;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

console.log(`\nmeasuring the text column of ${read.length} book cards (budget ${MIDDLE_ROW_H}px)\n`);
const t0 = Date.now();
const heights = await pool(read, 4, async (b) => ({ b, hpx: await textHeight(b) }));
heights.sort((x, y) => y.hpx - x.hpx);

const over = heights.filter((x) => x.hpx > MIDDLE_ROW_H);
console.log('  tallest text columns:');
for (const { b, hpx } of heights.slice(0, 8)) {
  const flag = hpx > MIDDLE_ROW_H ? ' <-- OVERFLOWS' : '';
  console.log(`    ${String(hpx).padStart(4)}px  ${b.title.slice(0, 72)}${flag}`);
}
const pct = (p) => heights[Math.floor(heights.length * (1 - p))].hpx;
console.log(`\n  max ${heights[0].hpx}px · p95 ${pct(0.95)}px · median ${pct(0.5)}px · min ${heights.at(-1).hpx}px`);
console.log(`  over budget: ${over.length} of ${read.length}`);
console.log(`  measured in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (DO_RENDER) {
  console.log(`\nrendering all ${read.length} cards (concurrency 4)\n`);
  const t1 = Date.now();
  const sizes = await pool(read, 4, async (b) => (await renderCard(await buildBookCard(b))).length);
  const secs = (Date.now() - t1) / 1000;
  sizes.sort((a, b) => b - a);
  const total = sizes.reduce((a, b) => a + b, 0);
  console.log(`  ${read.length} cards in ${secs.toFixed(1)}s  (${(secs / read.length * 1000).toFixed(0)}ms each, wall clock)`);
  console.log(`  largest ${(sizes[0] / 1024).toFixed(0)} kB · median ${(sizes[Math.floor(sizes.length / 2)] / 1024).toFixed(0)} kB · total ${(total / 1e6).toFixed(1)} MB`);
  console.log(`  over 250 kB: ${sizes.filter((s) => s > 250 * 1024).length} · over 300 kB: ${sizes.filter((s) => s > 300 * 1024).length}`);
}
console.log('');
