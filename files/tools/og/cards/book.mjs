// tools/og/cards/book.mjs — the card for /book/{slug}.
//
// Layout is flexbox only: Satori implements a subset of CSS and no grid.
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ ▔▔ theme accent bar                                      │
//   │  ▮▮▯ Alex’s Bookshelf / A READING LIBRARY                │
//   │  ┌────────┐   Main Title Segment                         │
//   │  │ cover  │   Subtitle after the first colon             │
//   │  │        │   Author Name                                │
//   │  └────────┘   Read March 2026                            │
//   │  ─────────────────────────────────────────────────────── │
//   │  bookshelf.drost.us                                      │
//   └──────────────────────────────────────────────────────────┘

import { h, C, THEME_COLORS, shade, rgba, splitTitle, titleSize, readLine, loadCover, brandLockup, cardFooter, W, H } from '../lib.mjs';

/** Hard stop on subtitle lines. The spec said 2; the longest real subtitle in the
 *  catalogue runs to four at 30px and still leaves the footer clear, so cutting at two
 *  would truncate real information for no layout reason. See the Phase 1 report. */
const SUB_LINES = 4;

const PAD = 56;
// The vertical budget, since the lockup now takes a band off the top and the cover
// collided with it at the old 464:
//   630 total - 8 accent - 38 pad-top - 35 lockup - 24 gap - 47 footer - 44 pad-bottom
//   = 434 for the content row. The cover is bounded by BOTH dimensions (fit: inside),
//   so 418 leaves the row a little air rather than filling it exactly.
const COVER_W = 300;
const COVER_H = 418;
const GAP = 52;
const LOCKUP_GAP = 24;

const themeColor = (themes) => THEME_COLORS[(themes || [])[0]] || THEME_COLORS.Other;

/** Mirrors the site's `.ph` block: the same 140deg gradient in the same theme colour,
 *  title and author centred in white. A book with no cover looks the same here as on
 *  the page it links to. */
function placeholder(book, w, hgt) {
  const c = themeColor(book.themes);
  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      width: w, height: hgt, padding: 26, borderRadius: 6, textAlign: 'center',
      backgroundImage: `linear-gradient(140deg, ${shade(c, 12)}, ${shade(c, -18)})`,
      boxShadow: '0 12px 34px rgba(31,37,48,.22)',
    },
  },
  h('div', { style: { display: 'block', fontFamily: 'Archivo', fontWeight: 700, fontSize: 27, lineHeight: 1.2, color: '#ffffff', lineClamp: 5 } }, book.title),
  h('div', { style: { display: 'block', fontFamily: 'Inter', fontWeight: 400, fontSize: 19, marginTop: 14, color: 'rgba(255,255,255,.84)', lineClamp: 2 } }, book.author || ''));
}

/**
 * @param book  { id, title, author, dateRead, themes(display names), hasCover }
 * @param cover result of loadCover(), or null for the placeholder
 */
export function bookCard(book, cover) {
  const accent = themeColor(book.themesSource || book.themes);
  const { main, sub } = splitTitle(book.title);
  // A long subtitle steps the type down rather than being truncated, so the card keeps
  // the whole subtitle wherever it can. Measured across all 327 read books, this keeps
  // the tallest text column at 434px inside a 483px row — see tools/og/sweep.mjs.
  const size = sub.length > 70 ? Math.min(titleSize(main), 72) : titleSize(main);
  const subSize = sub.length > 130 ? 29 : sub.length > 80 ? 33 : Math.max(30, Math.round(size * 0.44));
  const when = readLine(book.dateRead);

  const coverBox = cover
    // The hairline matters: a cover with a white background has no edge against the
    // paper ground at feed size, where the shadow alone is too soft to read.
    ? h('div', { style: { display: 'flex', width: cover.width, height: cover.height, borderRadius: 6, boxShadow: '0 12px 34px rgba(31,37,48,.22)' } },
        h('img', { src: cover.uri, width: cover.width, height: cover.height,
          style: { borderRadius: 6, border: '1px solid rgba(31,37,48,.13)' } }))
    : placeholder(book, Math.round(COVER_H * (2 / 3)), COVER_H);

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: W, height: H,
      backgroundColor: C.paper,
      backgroundImage: `radial-gradient(115% 85% at 92% 6%, ${rgba(accent, 0.13)} 0%, rgba(246,245,241,0) 58%), radial-gradient(85% 65% at 2% 96%, rgba(198,145,63,.07) 0%, rgba(246,245,241,0) 52%)`,
      fontFamily: 'Inter',
    },
  },
    // theme accent — the one place the card takes a colour from the book
    h('div', { style: { display: 'flex', width: W, height: 8, backgroundColor: accent } }),

    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, paddingLeft: PAD, paddingRight: PAD, paddingTop: PAD - 18, paddingBottom: PAD - 12 } },

      brandLockup({ scale: 0.86 }),
      h('div', { style: { display: 'flex', height: LOCKUP_GAP } }),

      h('div', { style: { display: 'flex', flexDirection: 'row', flex: 1, alignItems: 'center' } },
        h('div', { style: { display: 'flex', width: COVER_W, minWidth: COVER_W, alignItems: 'center', justifyContent: 'center' } }, coverBox),

        h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, marginLeft: GAP, justifyContent: 'center' } },
          h('div', {
            style: {
              display: 'block', fontFamily: 'Archivo', fontWeight: 800, fontSize: size,
              lineHeight: 1.06, letterSpacing: '-0.022em', color: C.ink, lineClamp: 3,
            },
          }, main),

          sub ? h('div', {
            style: {
              display: 'block', fontFamily: 'Archivo', fontWeight: 600,
              fontSize: subSize, lineHeight: 1.22,
              letterSpacing: '-0.01em', color: C.ink2, marginTop: 12, lineClamp: SUB_LINES,
            },
          }, sub) : null,

          h('div', {
            style: {
              display: 'block', fontFamily: 'Inter', fontWeight: 500, fontSize: 26,
              color: C.ink2, marginTop: 20, lineClamp: 2,
            },
          }, book.author || ''),

          // Theme chips used to sit here. Removed at Alex's request — the accent bar
          // already says which theme the book belongs to, and the chips were the
          // busiest thing on an otherwise quiet card.
          when ? h('div', { style: { display: 'flex', fontFamily: 'Inter', fontWeight: 400, fontSize: 22, color: C.muted, marginTop: 18 } }, when) : null
        )
      ),

      ...cardFooter()
    )
  );
}

/** Resolve the cover (or fall back) and hand back the finished tree. */
export async function buildBookCard(book) {
  const cover = book.hasCover === false ? null : await loadCover(book.id, COVER_W, COVER_H);
  return bookCard(book, cover);
}

export const BOOK_COVER_BOX = { COVER_W, COVER_H };
