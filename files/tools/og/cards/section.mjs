// tools/og/cards/section.mjs — cards for the ~25 non-book pages.
//
// One shape for all of them: kicker, title, a computed subline, then a deterministic
// strip of covers. Every number on these cards is the number the page itself already
// computes, so a card can never disagree with the page it represents.
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ ▔▔ accent                                                │
//   │  ▮▮▯ Alex’s Bookshelf / A READING LIBRARY                │
//   │  THEME                                                   │
//   │  History & Foreign Affairs                               │
//   │  86 books                                                │
//   │  [cov][cov][cov][cov][cov][cov]                          │
//   │  ─────────────────────────────────────────────────────── │
//   │  bookshelf.drost.us                                      │
//   └──────────────────────────────────────────────────────────┘

import { h, C, THEME_COLORS, shade, rgba, loadCover, brandLockup, cardFooter, W, H } from '../lib.mjs';

const PAD = 56;
const STRIP_H = 246;

function miniPlaceholder(book, w, hgt) {
  const c = THEME_COLORS[(book.themesSource || book.themes || [])[0]] || THEME_COLORS.Other;
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      width: w, height: hgt, padding: 10, borderRadius: 4, textAlign: 'center',
      backgroundImage: `linear-gradient(140deg, ${shade(c, 12)}, ${shade(c, -18)})`,
      boxShadow: '0 8px 22px rgba(31,37,48,.18)',
    },
  }, h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 700, fontSize: 14, lineHeight: 1.18, color: '#ffffff', lineClamp: 4 } }, book.title));
}

/**
 * @param opts.kicker   small uppercase label
 * @param opts.title    the headline
 * @param opts.subline  one computed line, or '' to omit
 * @param opts.accent   hex; defaults to the site blue
 * @param opts.art      [{ book, cover }] already resolved, in display order
 * @param opts.portrait optional { uri, width, height } shown instead of the strip
 */
export function sectionCard({ kicker, title, subline, accent = C.blue, art = [], portrait = null }) {
  const n = Math.max(art.length, 1);
  const gap = n >= 8 ? 16 : 20;
  const cw = Math.floor((W - PAD * 2 - gap * (n - 1)) / n);
  const ch = Math.min(STRIP_H, Math.round(cw * 1.5));

  const strip = portrait
    ? h('div', { style: { display: 'flex', marginTop: 28 } },
        h('img', { src: portrait.uri, width: portrait.width, height: portrait.height, style: { borderRadius: 10, boxShadow: '0 12px 30px rgba(31,37,48,.2)' } }))
    : h('div', { style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', marginTop: 28 } },
        ...art.map(({ book, cover }, i) => h('div', {
          key: i,
          style: { display: 'flex', marginRight: i === art.length - 1 ? 0 : gap },
        }, cover
          ? h('img', { src: cover.uri, width: Math.min(cw, cover.width), height: Math.round(Math.min(cw, cover.width) * (cover.height / cover.width)), style: { borderRadius: 4, boxShadow: '0 8px 22px rgba(31,37,48,.18)' } })
          : miniPlaceholder(book, cw, ch))));

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: W, height: H,
      backgroundColor: C.paper,
      backgroundImage: `radial-gradient(115% 85% at 92% 6%, ${rgba(accent, 0.13)} 0%, rgba(246,245,241,0) 58%), radial-gradient(85% 65% at 2% 96%, rgba(198,145,63,.07) 0%, rgba(246,245,241,0) 52%)`,
      fontFamily: 'Inter',
    },
  },
    h('div', { style: { display: 'flex', width: W, height: 8, backgroundColor: accent } }),
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, paddingLeft: PAD, paddingRight: PAD, paddingTop: PAD - 20, paddingBottom: PAD - 14 } },

      brandLockup({ scale: 0.86 }),

      h('div', { style: { display: 'flex', fontFamily: 'Archivo', fontWeight: 600, fontSize: 17, letterSpacing: '0.20em', color: shade(accent, -18), textTransform: 'uppercase', marginTop: 26 } }, kicker),

      h('div', {
        style: {
          display: 'flex', fontFamily: 'Archivo', fontWeight: 800,
          fontSize: title.length > 26 ? 60 : 76, lineHeight: 1.04,
          letterSpacing: '-0.028em', color: C.ink, marginTop: 12, lineClamp: 2,
        },
      }, title),

      subline ? h('div', { style: { display: 'flex', fontFamily: 'Inter', fontWeight: 400, fontSize: 27, color: C.ink2, marginTop: 16 } }, subline) : null,

      h('div', { style: { display: 'flex', flex: 1 } }),
      strip,
      h('div', { style: { display: 'flex', height: 30 } }),
      ...cardFooter()
    )
  );
}

/** Resolve covers for a list of books, newest first, capped at `count`. */
export async function artFor(books, count, cw = 170, ch = 255) {
  const picked = books.slice(0, count);
  // A cover strip that repeats a jacket reads as a rendering fault, not an editorial pick,
  // and it is the kind of thing nobody notices until it is on LinkedIn. The themes hub hit
  // this for real: a book carries up to two themes, so one jacket was the newest read in
  // two of them. Every caller now has to hand over a deduped list.
  const ids = picked.map((b) => b.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) {
    throw new Error(`OG section art repeats a book: ${[...new Set(dupes)].join(', ')}`);
  }
  return Promise.all(picked.map(async (book) => ({ book, cover: book.hasCover === false ? null : await loadCover(book.id, cw, ch) })));
}
