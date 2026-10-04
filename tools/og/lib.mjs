// tools/og/lib.mjs — shared pieces for build-time OG card rendering.
//
// Renderer: satori lays the card out (element tree + fonts -> SVG with text as paths),
// @resvg/resvg-js rasterises, sharp encodes the JPEG and normalises covers. No headless
// browser: Chromium is not on the Cloudflare Pages build image and downloading it at
// build time would also break the "no network during build" rule.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SRC = path.join(ROOT, 'src');

/** Bump whenever the card DESIGN changes. It is hashed into every ?v=, so a bump
 *  re-cuts every URL and makes LinkedIn, Slack and X re-fetch the images. */
export const OG_TEMPLATE_VERSION = 1;

export const W = 1200;
export const H = 630;

// ---------------------------------------------------------------- palette
// Mirrors :root in src/styles/tokens.css. Kept as literals because the cards are
// rasterised outside the browser and never load the stylesheet.
export const C = {
  paper: '#f6f5f1', paper2: '#ecebe4', card: '#ffffff',
  ink: '#1f2530', ink2: '#3d4654', muted: '#6b7480', faint: '#a3abb5',
  line: '#e6e3da', blue: '#3a6ea5', blueD: '#2c5680', blueLt: '#aecbe2',
};

// The site's theme palette. CANONICAL COPY lives in tools/build.mjs (const THEME_COLORS);
// this is a deliberate duplicate because build.mjs is a script with side effects and
// cannot be imported. tools/qa.mjs asserts the two stay identical.
export const THEME_COLORS = {
  'Politics & Power': '#3a6ea5', 'Business & Finance': '#c6913f',
  'History & Foreign Affairs': '#9c7b57', 'Personal Growth & Leadership': '#88a04a',
  'Memoir & Biography': '#8268a6', 'Psychology & Mind': '#3a8fb0',
  'Society & Culture': '#b06a93', 'Religion & Faith': '#b3864c',
  'Tech & Future': '#5a66ad', 'Crime & Justice': '#b3564c', 'Other': '#9aa0a6',
};

/** The site's own shade(), from src/assets/js/app.js — used so a placeholder cover here
 *  is the same gradient the site paints for a book with no cover file. */
export function shade(hex, p) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = p / 100;
  r = Math.round(r + (p < 0 ? r : 255 - r) * f);
  g = Math.round(g + (p < 0 ? g : 255 - g) * f);
  b = Math.round(b + (p < 0 ? b : 255 - b) * f);
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}

/** rgba() from a hex — Satori accepts rgba strings, and chips need transparency. */
export function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------------------------------------------------------------- fonts
// Static TTF instances converted losslessly from the WOFF2 files the site already
// serves (src/assets/fonts), so the cards use byte-identical typefaces to the pages.
// Satori cannot read WOFF2 and mishandles variable fonts, hence the conversion.
const FONT_FILES = [
  ['archivo-latin-600-normal.ttf', 'Archivo', 600],
  ['archivo-latin-700-normal.ttf', 'Archivo', 700],
  ['archivo-latin-800-normal.ttf', 'Archivo', 800],
  ['inter-latin-400-normal.ttf', 'Inter', 400],
  ['inter-latin-500-normal.ttf', 'Inter', 500],
  ['inter-latin-600-normal.ttf', 'Inter', 600],
  // The one face the site does not itself serve. Taken from @fontsource/inter, the same
  // upstream the site's WOFF2 files come from, and converted the same lossless way. The
  // home card's standfirst is italic and Satori will not synthesise an oblique.
  ['inter-latin-400-italic.ttf', 'Inter', 400, 'italic'],
];
let _fonts = null;
export function fonts() {
  if (_fonts) return _fonts;
  const dir = path.join(ROOT, 'tools/og/fonts');
  _fonts = FONT_FILES.map(([file, name, weight, style = 'normal']) => {
    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      throw new Error(`OG font missing: ${p}\nRun tools/og/make-fonts.mjs to regenerate from src/assets/fonts.`);
    }
    return { name, weight, style, data: fs.readFileSync(p) };
  });
  return _fonts;
}

// ---------------------------------------------------------------- element helper
/** Satori takes React-like element objects. This is the whole of what we need. */
export const h = (type, props = {}, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
};

// ---------------------------------------------------------------- text rules
/** Title split (handoff §2c). A short title stays whole even when it has a colon, so
 *  "Code Name: Pale Horse" is not demoted into a subtitle. */
export function splitTitle(title, wholeUpTo = 40) {
  const t = String(title || '').trim();
  if (t.length <= wholeUpTo) return { main: t, sub: '' };
  const i = t.indexOf(':');
  if (i === -1) return { main: t, sub: '' };
  return { main: t.slice(0, i).trim(), sub: t.slice(i + 1).trim() };
}

/** Starting points from the handoff; tuned against the stress set. */
export function titleSize(main) {
  const n = main.length;
  if (n <= 18) return 88;
  if (n <= 40) return 72;
  if (n <= 70) return 56;
  return 48;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
/** `Read March 2026` from `2026/03/14`. Hardcoded months, not Intl — the build must be
 *  deterministic regardless of the locale of the machine running it. */
export function readLine(dateRead) {
  const m = /^(\d{4})\/(\d{2})/.exec(String(dateRead || ''));
  if (!m) return '';
  return `Read ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// ---------------------------------------------------------------- covers
const _coverCache = new Map();
/**
 * Load a cover for Satori. sharp sniffs the real format from the bytes, which is what
 * makes the PNG/WebP files sitting under a .jpg name work. Returns null when the file
 * is absent or will not decode — callers fall back to the placeholder.
 */
export async function loadCover(id, maxW, maxH) {
  const key = `${id}|${maxW}x${maxH}`;
  if (_coverCache.has(key)) return _coverCache.get(key);
  const file = path.join(SRC, 'covers', `${id}.jpg`);
  let out = null;
  if (fs.existsSync(file)) {
    try {
      const buf = await sharp(file).resize({ width: maxW, height: maxH, fit: 'inside', withoutEnlargement: false }).png().toBuffer();
      const meta = await sharp(buf).metadata();
      out = { uri: `data:image/png;base64,${buf.toString('base64')}`, width: meta.width, height: meta.height,
        bytes: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16) };
    } catch (e) {
      out = null;
      warn(`cover ${id}.jpg failed to decode: ${e.message}`);
    }
  }
  _coverCache.set(key, out);
  return out;
}

/** The byte hash of a cover file, for cache-busting, without decoding it. */
export function coverHash(id) {
  const file = path.join(SRC, 'covers', `${id}.jpg`);
  if (!fs.existsSync(file)) return 'nocover';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

const _warnings = [];
export function warn(msg) { _warnings.push(msg); }
export function warnings() { return _warnings.slice(); }

// ---------------------------------------------------------------- hashing
/** First 10 hex of sha256 over the template version plus everything that affects pixels. */
export function vhash(parts) {
  const s = JSON.stringify([OG_TEMPLATE_VERSION, ...parts]);
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);
}

// ---------------------------------------------------------------- render
export async function renderCard(tree, { width = W, height = H, quality = 82 } = {}) {
  const svg = await satori(tree, { width, height, fonts: fonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng();
  return sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
}

/** PNG output, for /share.png which keeps its existing path and format.
 *  resvg writes an unoptimised PNG; a lossless pass through sharp takes 2400x1260 from
 *  about 350 kB to about 213 kB, which is what keeps it inside the 300 kB QA budget. */
export async function renderCardPng(tree, { width = W, height = H, scale = 2 } = {}) {
  const svg = await satori(tree, { width, height, fonts: fonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width * scale } }).render().asPng();
  return sharp(png).png({ compressionLevel: 9, effort: 10 }).toBuffer();
}

// ---------------------------------------------------------------- brand lockup
/**
 * The icon + wordmark from the home card, as a reusable block so every card
 * carries the same mark. Alex asked for it on all of them; it was previously
 * only on /share.png.
 *
 * The three bars are the same geometry as tools/og/cards/home.mjs used inline —
 * two blue spines and one green one tipped 7 degrees, which reads as books on a
 * shelf at feed size without needing a literal shelf.
 *
 * @param scale 1 is the home card's size; the smaller cards use 0.72.
 */
export function brandLockup({ scale = 1, tagline = true } = {}) {
  // 0.72 made the tagline 9px, which rendered as a blue smudge rather than words.
  // 0.86 is the floor at which 'A READING LIBRARY' still reads as text.
  const s = (n) => Math.round(n * scale * 100) / 100;
  const box = s(40);
  return h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center' } },
    h('svg', { width: box, height: box, viewBox: '0 0 40 40' },
      h('rect', { x: 8, y: 9, width: 9, height: 23, rx: 1.5, fill: '#2e6fb5' }),
      h('rect', { x: 17.5, y: 11, width: 8, height: 21, rx: 1.5, fill: '#5b97d4' }),
      h('rect', { x: 25, y: 8, width: 8, height: 24, rx: 1.5, transform: 'rotate(7 29 20)', fill: '#2f9e6b' })),
    h('div', { style: { display: 'flex', flexDirection: 'column', marginLeft: s(14) } },
      h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: s(29), color: C.ink, letterSpacing: '-0.02em', lineHeight: 1 } }, 'Alex’s Bookshelf'),
      tagline
        ? h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 600, fontSize: s(12.5), letterSpacing: '0.22em', color: C.blue, marginTop: s(7) } }, 'A READING LIBRARY')
        : null));
}

/**
 * The footer every non-home card carries. Alex asked for the domain alone —
 * the wordmark used to sit here too, and now that the lockup is at the top of
 * every card, repeating the name at the bottom was saying it twice.
 */
export function cardFooter() {
  return [
    h('div', { style: { display: 'flex', width: '100%', height: 1, backgroundColor: C.line } }),
    h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 16 } },
      h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 700, fontSize: 24, color: C.ink2, letterSpacing: '-0.005em' } }, 'bookshelf.drost.us')),
  ];
}
