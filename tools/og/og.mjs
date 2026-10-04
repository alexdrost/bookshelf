// tools/og/og.mjs — the build-time OG image layer.
//
// Two calls, and build.mjs needs nothing else:
//
//   const og = buildOgManifest({ ... })   // route -> { url, file, alt, ... }, no rendering
//   await renderOgImages(og, DIST)        // rasterise everything the manifest describes
//
// The manifest is built early so `emit()` can hang `page.og` off every route; the images
// are rendered at the end, after the HTML is on disk. Nothing here reaches the network.

import fs from 'node:fs';
import path from 'node:path';
import {
  W, H, THEME_COLORS, vhash, coverHash, loadCover, renderCard, renderCardPng,
  fonts, warn, warnings,
} from './lib.mjs';
import { buildBookCard } from './cards/book.mjs';
import { sectionCard, artFor } from './cards/section.mjs';
import { homeCard, recentFour } from './cards/home.mjs';

/**
 * Where the images are advertised from.
 *
 * Production everywhere, EXCEPT on a Cloudflare Pages preview build, where the branch
 * deploy serves its own copies and pointing at production would preview the wrong
 * images. Only og:image and twitter:image ever move — canonical, og:url and every
 * JSON-LD @id stay on the production origin, because those are identity claims.
 */
export function ogOrigin(productionOrigin) {
  const branch = process.env.CF_PAGES_BRANCH;
  const url = process.env.CF_PAGES_URL;
  if (branch && branch !== 'main' && url) return url.replace(/\/$/, '');
  return productionOrigin;
}

const JPEG = { type: 'image/jpeg', w: W, h: H };

/**
 * @returns {{ get(route): object|undefined, jobs: Array, count: number, origin: string }}
 */
export function buildOgManifest({
  origin, orderedRead, themeIndex, yearIndex, currentlyReading, tbr,
  site, libraryPages, picks,
}) {
  const ogOrig = ogOrigin(origin);
  const byRoute = new Map();
  const jobs = [];

  /** Register one image and point one or more routes at it. */
  const add = ({ routes, file, alt, v, render, type = JPEG.type, w = JPEG.w, h = JPEG.h }) => {
    const entry = { file, alt, v, type, w, h, url: `${ogOrig}/${file}?v=${v}` };
    for (const r of routes) byRoute.set(r, entry);
    jobs.push({ file, render });
    return entry;
  };

  // Covers chosen for section art must be DETERMINISTIC — the ids feed the hash, and a
  // shuffle on every build would re-cut every URL and defeat social caching.
  const artIds = (list, n) => list.slice(0, n).map((b) => b.id);
  const artHash = (ids) => ids.map((id) => `${id}:${coverHash(id)}`);

  // ---------------------------------------------------------------- book cards
  for (const b of orderedRead) {
    const v = vhash(['book', b.title, b.author, b.dateRead || '', (b.themes || []).join('|'), coverHash(b.id)]);
    add({
      routes: [`/book/${b.slug}`],
      file: `og/book/${b.slug}.jpg`,
      alt: `${b.title} by ${b.author}`,
      v,
      render: () => buildBookCard(b).then(renderCard),
    });
  }

  // ---------------------------------------------------------------- theme pages
  for (const t of themeIndex) {
    const books = t.books;                       // already newest-first from build.mjs
    const ids = artIds(books.filter((b) => b.hasCover), 6);
    add({
      routes: [`/themes/${t.slug}`],
      file: `og/themes/${t.slug}.jpg`,
      alt: `Books on ${t.name}, from Alex Drost’s Bookshelf`,
      v: vhash(['theme', t.name, books.length, ...artHash(ids)]),
      render: async () => renderCard(sectionCard({
        kicker: 'Theme', title: t.name,
        subline: `${books.length} book${books.length === 1 ? '' : 's'}`,
        accent: THEME_COLORS[t.source] || THEME_COLORS.Other,
        art: await artFor(books.filter((b) => b.hasCover), 6),
      })),
    });
  }

  // ---------------------------------------------------------------- year pages
  for (const y of yearIndex) {
    const ids = artIds(y.books.filter((b) => b.hasCover), 8);
    add({
      routes: [`/${y.year}`],
      file: `og/year/${y.year}.jpg`,
      alt: `The ${y.books.length} books Alex Drost finished in ${y.year}`,
      v: vhash(['year', y.year, y.books.length, ...artHash(ids)]),
      render: async () => renderCard(sectionCard({
        kicker: 'Year in reading', title: String(y.year),
        subline: `${y.books.length} book${y.books.length === 1 ? '' : 's'} read`,
        art: await artFor(y.books.filter((b) => b.hasCover), 8, 150, 225),
      })),
    });
  }

  // ---------------------------------------------------------------- singles
  const withCover = orderedRead.filter((b) => b.hasCover);

  const single = ({ route, name, kicker, title, subline, accent, source, count, extra = [] }) => {
    const ids = artIds(source, count);
    add({
      routes: Array.isArray(route) ? route : [route],
      file: `og/${name}.jpg`,
      alt: `${title} — Alex Drost’s Bookshelf`,
      v: vhash([name, title, subline, ...extra, ...artHash(ids)]),
      render: async () => renderCard(sectionCard({
        kicker, title, subline, accent,
        art: await artFor(source, count),
      })),
    });
  };

  // /library and every /library/N share one image — the pages differ only by offset.
  single({
    route: ['/library', ...Array.from({ length: libraryPages - 1 }, (_, i) => `/library/${i + 2}`)],
    name: 'library', kicker: 'Library', title: 'My library',
    subline: `${site.readCount} books read`,
    source: withCover, count: 8, extra: [site.readCount],
  });

  // One most-recent cover per theme, in the hub's own editorial order.
  //
  // DEDUPED, and that is not optional: a book carries up to two themes, so the newest read
  // in "Politics & Power" is often also the newest in "History & Foreign Affairs". Taking
  // each theme's first cover blindly put the same jacket on the card twice, which reads as
  // a rendering bug rather than an editorial choice. Each theme falls through to its next
  // unused cover instead, so ten themes still yield ten distinct jackets.
  {
    const used = new Set();
    const ids = themeIndex.map((t) => {
      const pick = t.books.find((b) => b.hasCover && !used.has(b.id));
      if (pick) used.add(pick.id);
      return (pick || {}).id;
    }).filter(Boolean);
    add({
      routes: ['/themes'],
      file: 'og/themes.jpg',
      alt: `Ten themes across Alex Drost’s ${site.readCount} books`,
      v: vhash(['themes-hub', site.readCount, themeIndex.length, ...artHash(ids)]),
      render: async () => renderCard(sectionCard({
        kicker: 'Themes', title: 'Ten themes',
        subline: `${site.readCount} books across ${themeIndex.length} themes`,
        art: await artFor(ids.map((id) => orderedRead.find((b) => b.id === id)).filter(Boolean), 10, 120, 180),
      })),
    });
  }

  {
    const years = yearIndex.map((y) => y.year);
    single({
      route: '/timeline', name: 'timeline', kicker: 'Timeline', title: 'Reading over time',
      subline: years.length ? `${years[0]}–${years[years.length - 1]}` : '',
      source: withCover, count: 8, extra: years,
    });
  }

  // Highest-degree books, ties broken by Goodreads ID so the pick never drifts.
  {
    const ranked = orderedRead.filter((b) => b.hasCover).slice().sort((a, b) =>
      ((b.conn || []).length - (a.conn || []).length)
      || String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
    single({
      route: '/connections', name: 'connections', kicker: 'Connections',
      title: 'The web of connections',
      subline: `${site.uniqueConnections.toLocaleString('en-US')} hand-made links between books`,
      source: ranked, count: 6, extra: [site.uniqueConnections],
    });
  }

  single({
    route: '/analytics', name: 'analytics', kicker: 'Analytics', title: 'Reading analytics',
    subline: `${site.readCount} books · ${site.totalPages.toLocaleString('en-US')} pages`,
    source: withCover, count: 6, extra: [site.readCount, site.totalPages],
  });

  // Up next shows both shelves, because the page does. Covers only — no unread
  // enrichment reaches a card, and these covers are already public on /up-next.
  {
    const art = [...currentlyReading, ...tbr].filter((b) => b.hasCover);
    const parts = [];
    if (currentlyReading.length) parts.push(`${currentlyReading.length} currently reading`);
    if (tbr.length) parts.push(`${tbr.length} on deck`);
    single({
      route: '/up-next', name: 'up-next', kicker: 'Up next', title: 'Up next',
      subline: parts.join(' · '),
      source: art, count: 6, extra: [currentlyReading.length, tbr.length],
    });
  }

  single({
    route: '/recommendations', name: 'recommendations', kicker: 'Recommendations',
    title: 'Books I’d actually recommend', subline: '',
    source: (picks || []).filter((b) => b.hasCover), count: 6,
  });

  // ---------------------------------------------------------------- home
  // /share.png keeps its path AND its format, so every share posted before today keeps
  // resolving. /404 borrows it rather than getting a card of its own, and so does
  // /about — Alex preferred the home card there to the bespoke portrait one, which is
  // the right call: About is the page a new reader lands on, and the home card is the
  // better introduction to the shelf than a headshot is.
  {
    const four = recentFour(orderedRead);
    add({
      routes: ['/', '/404', '/about'],
      file: 'share.png',
      type: 'image/png', w: 2400, h: 1260,
      alt: 'Alex Drost’s Bookshelf — recent reads visualized as a constellation of connected books.',
      v: vhash(['home', ...four.map((b) => `${b.title}|${b.author}|${b.when}|${b.color}`)]),
      render: () => renderCardPng(homeCard(four)),
    });
  }

  return { get: (route) => byRoute.get(route), jobs, count: jobs.length, origin: ogOrig };
}

/** Render every job in the manifest into DIST. Concurrency 4; one bad cover warns. */
export async function renderOgImages(manifest, DIST) {
  fonts();                                  // fail loudly and early if a face is missing
  const t0 = Date.now();
  let bytes = 0, largest = { file: '', size: 0 };
  const jobs = manifest.jobs;
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const out = path.join(DIST, job.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      try {
        const buf = await job.render();
        fs.writeFileSync(out, buf);
        bytes += buf.length;
        if (buf.length > largest.size) largest = { file: job.file, size: buf.length };
      } catch (e) {
        warn(`${job.file}: ${e.message}`);
      }
    }
  }));
  // Every file the manifest promised must exist. src/share.png is no longer committed,
  // so a silently skipped home card would leave the site advertising a 404 as its
  // og:image — worse than a failed build, which changes nothing on Pages.
  const absent = jobs.map((j) => j.file).filter((f) => !fs.existsSync(path.join(DIST, f)));
  if (absent.length) {
    throw new Error(`OG render did not write ${absent.length} file(s): ${absent.slice(0, 5).join(', ')}`);
  }
  return {
    count: jobs.length, bytes, largest,
    seconds: (Date.now() - t0) / 1000,
    warnings: warnings(),
  };
}
