// tools/og/cards/home.mjs — the home card, /share.png.
//
// A PORT, not a redesign. Alex designed this layout in tools/make-og.mjs, which builds
// an HTML string and screenshots it with Chromium. Chromium is not available on the
// Cloudflare Pages build image, so the same layout is rebuilt here as a Satori tree:
// identical coordinates, colours, type sizes and copy, only the renderer changes.
//
// Everything the original leans on turned out to be supported — layered radial
// gradients, the 48px grid, box shadows, and the inline SVG constellation. The two
// things that are not are `<br>` and inline `<em>`, so the headline is three stacked
// rows instead of one element with markup.

import { h, THEME_COLORS, brandLockup, W, H } from '../lib.mjs';

// Hand-placed clusters in the 1200x630 space, copied verbatim from make-og.mjs.
// Deterministic by design — a random layout would change the image on every rebuild.
const CLUSTERS = [
  { hub: [1058, 205], sats: [[1140, 168], [1006, 262], [1120, 262], [990, 150], [1152, 228]], card: [636, 100] },
  { hub: [1006, 348], sats: [[1092, 322], [960, 300], [1080, 392], [946, 402]], card: [616, 258] },
  { hub: [1064, 470], sats: [[1148, 448], [1000, 440], [1136, 522], [1006, 516], [1070, 556]], card: [616, 396] },
  { hub: [1002, 572], sats: [[1088, 588], [920, 560], [1078, 528], [946, 610]], card: [636, 512] },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The four most recent finished books, exactly as make-og.mjs picks them. */
export function recentFour(books) {
  return books
    .filter((b) => b.shelf === 'read' && b.dateRead && b.public !== false)
    .sort((a, b) => String(b.dateRead).localeCompare(String(a.dateRead)))
    .slice(0, 4)
    .map((b) => {
      const [y, m] = b.dateRead.split('/');
      return {
        title: String(b.title).split(':')[0],
        author: String(b.author || '').split(',')[0].trim(),
        when: `${MONTHS[+m - 1]} ${y}`,
        color: THEME_COLORS[(b.themes || [])[0]] || THEME_COLORS.Other,
      };
    });
}

/** One constellation, as SVG children. Satori renders inline SVG elements directly. */
function cluster(c, color) {
  const [hx, hy] = c.hub;
  return [
    ...c.sats.map(([x, y], i) => h('line', { key: `l${i}`, x1: hx, y1: hy, x2: x, y2: y, stroke: color, strokeOpacity: 0.38, strokeWidth: 1.6 })),
    ...c.sats.map(([x, y], i) => h('circle', { key: `s${i}`, cx: x, cy: y, r: i % 2 ? 8 : 10, fill: color, fillOpacity: i % 2 ? 0.42 : 0.72 })),
    h('circle', { key: 'ring', cx: hx, cy: hy, r: 21, fill: 'none', stroke: color, strokeOpacity: 0.3, strokeWidth: 7 }),
    h('circle', { key: 'hub', cx: hx, cy: hy, r: 14, fill: color }),
    h('circle', { key: 'hubr', cx: hx, cy: hy, r: 14, fill: 'none', stroke: '#fff', strokeWidth: 3.5 }),
  ];
}

function bookCardlet(b, i) {
  const [left, top] = CLUSTERS[i].card;
  return h('div', {
    key: i,
    style: {
      position: 'absolute', left, top, width: 322, display: 'flex', flexDirection: 'row',
      alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 13,
      paddingTop: 12, paddingRight: 18, paddingBottom: 13, paddingLeft: 14,
      boxShadow: '0 5px 22px rgba(31,37,48,.13), 0 1px 3px rgba(31,37,48,.07)',
    },
  },
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 29, height: 29, borderRadius: 15, backgroundColor: b.color, color: '#fff',
        fontFamily: 'Archivo', fontWeight: 700, fontSize: 14, marginRight: 13,
      },
    }, String(i + 1)),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } },
      h('div', { style: { display: 'block', fontFamily: 'Archivo', fontWeight: 700, fontSize: 18.5, color: '#1f2530', lineHeight: 1.16, letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, b.title),
      h('div', { style: { display: 'block', fontFamily: 'Inter', fontWeight: 400, fontSize: 14, color: '#6b7480', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `${b.author} · ${b.when}`)));
}

export function homeCard(recent) {
  return h('div', {
    style: {
      position: 'relative', display: 'flex', width: W, height: H, overflow: 'hidden',
      fontFamily: 'Inter',
      backgroundColor: '#f6f5f1',
      backgroundImage: [
        'radial-gradient(120% 90% at 88% 8%, rgba(58,110,165,.13) 0%, rgba(246,245,241,0) 55%)',
        'radial-gradient(90% 70% at 4% 92%, rgba(198,145,63,.10) 0%, rgba(246,245,241,0) 50%)',
      ].join(', '),
    },
  },
    // the 48px graph-paper grid
    h('div', {
      style: {
        position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex',
        backgroundImage: 'linear-gradient(rgba(31,37,48,.045) 1px, rgba(0,0,0,0) 1px), linear-gradient(90deg, rgba(31,37,48,.045) 1px, rgba(0,0,0,0) 1px)',
        backgroundSize: '48px 48px',
      },
    }),

    // the constellations
    h('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, style: { position: 'absolute', left: 0, top: 0 } },
      ...CLUSTERS.flatMap((c, i) => cluster(c, recent[i] ? recent[i].color : THEME_COLORS.Other))),

    // RECENTLY READ
    h('div', { style: { position: 'absolute', right: 74, top: 70, display: 'flex', flexDirection: 'row', alignItems: 'center' } },
      h('div', { style: { display: 'flex', width: 34, height: 1.5, backgroundColor: '#a3abb5', marginRight: 13 } }),
      h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 600, fontSize: 12.5, letterSpacing: '0.22em', color: '#6b7480' } }, 'RECENTLY READ')),

    // brand + headline
    h('div', { style: { position: 'absolute', left: 74, top: 62, width: 520, display: 'flex', flexDirection: 'column' } },
      // The lockup now lives in lib.mjs, because Alex asked for it on every card.
      // This is the full-size instance; the book and section cards use scale 0.86.
      brandLockup({ scale: 1 }),

      // `<br>` and inline `<em>` are the two things Satori will not take, so the
      // headline is stacked rows and the accent word is its own coloured element.
      h('div', { style: { display: 'flex', flexDirection: 'column', marginTop: 118 } },
        h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 800, fontSize: 78, lineHeight: 0.99, letterSpacing: '-0.035em', color: '#1f2530' } }, 'What I’ve'),
        h('div', { style: { display: 'flex', flexDirection: 'row', fontFamily: 'Archivo', fontWeight: 800, fontSize: 78, lineHeight: 0.99, letterSpacing: '-0.035em' } },
          h('div', { style: { display: 'flex', color: '#1f2530' } }, 'been '),
          h('div', { style: { display: 'flex', color: '#3a6ea5' } }, 'reading.'))),

      h('div', { style: { display: 'block', fontSize: 22, lineHeight: 1.4, color: '#3d4654', fontStyle: 'italic', marginTop: 30, width: 430 } },
        'A small history of the books that have informed my thinking.')),

    // the domain pill
    h('div', {
      style: {
        position: 'absolute', left: 74, top: 512, display: 'flex',
        border: '1.5px solid #aecbe2', borderRadius: 32,
        paddingTop: 14, paddingBottom: 14, paddingLeft: 30, paddingRight: 30,
        fontFamily: 'Archivo', fontWeight: 700, fontSize: 19, color: '#2c5680',
        backgroundColor: 'rgba(255,255,255,.6)',
      },
    }, 'bookshelf.drost.us'),

    ...recent.map(bookCardlet));
}
