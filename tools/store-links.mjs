// tools/store-links.mjs — where a book's "buy / listen" links come from.
//
// Pure functions, no I/O, so tools/qa.mjs can import and test them against real rows
// rather than against the HTML they happen to produce.
//
// The site has always derived the Goodreads URL from the Goodreads ID rather than
// syncing Notion's `Goodreads link` formula. These two follow that precedent for the
// same reason: a formula is read-only and can be edited out from under the site, an ID
// is just data. So Notion syncs `Amazon ASIN` and `Audible ASIN`, and the URLs are
// built here.
//
// A link that cannot be built is omitted. It is never guessed, and never pointed at a
// search page as a consolation — a wrong product link is worse than no link, which is
// the same rule the catalog already applies to Goodreads IDs.

/**
 * ISBN-13 -> ISBN-10, which is what Amazon uses as the print ASIN in /dp/.
 * Only defined for the 978 prefix: 979 ISBNs have no ISBN-10 equivalent at all,
 * because the 979 range was added after ISBN-10 ran out.
 * @returns the 10-character ISBN, or '' if the input is not a convertible ISBN-13.
 */
export function isbn13to10(isbn13) {
  const d = String(isbn13 || '').replace(/[^0-9Xx]/g, '');
  if (d.length !== 13 || !d.startsWith('978')) return '';
  const core = d.slice(3, 12);
  if (!/^\d{9}$/.test(core)) return '';
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

/** An ISBN-10 or Amazon ASIN: 10 chars, last one may be X. */
const looksLikeAsin = (s) => /^[0-9A-Za-z]{9}[0-9A-Za-z]$/.test(String(s || '').trim());

/**
 * Amazon product URL.
 *
 * Mirrors the `Amazon link` formula in Notion, which is the documented behaviour of
 * the `Amazon ASIN` field: it is an OVERRIDE, filled only when the ISBN is missing or
 * points at the wrong edition. Everything else derives from the ISBN.
 *
 * A 979 ISBN yields nothing here. Notion's formula falls back to an Amazon search for
 * those; a search page is not a product link, so the site shows no link instead and
 * the build names the book so the ASIN can be filled in.
 */
export function amazonUrl({ amazonAsin, isbn } = {}) {
  const override = String(amazonAsin || '').trim();
  if (override) return looksLikeAsin(override) ? `https://www.amazon.com/dp/${override}` : '';

  const d = String(isbn || '').replace(/[^0-9Xx]/g, '');

  // An ISBN-10 sitting in the ISBN field already IS the Amazon print ASIN, so use it
  // rather than rejecting it for not being an ISBN-13. One book on the shelf is like
  // this (Can't Hurt Me, a Lioncrest title) and it needed no override at all.
  if (/^\d{9}[\dXx]$/.test(d)) return `https://www.amazon.com/dp/${d.toUpperCase()}`;

  const ten = isbn13to10(d);
  if (ten) return `https://www.amazon.com/dp/${ten}`;

  // 979 ISBNs have no ISBN-10 and therefore no /dp/ id, which is most of the recent
  // US trade titles. Notion's `Amazon link` formula falls back to an exact-ISBN search
  // for these, and matching that is the right call: it is Alex's stated design, and an
  // exact-ISBN query resolves to the one product rather than to a list of guesses.
  if (/^979\d{10}$/.test(d)) return `https://www.amazon.com/s?k=${d}&i=stripbooks`;

  return '';
}

/** True when the Amazon URL is the 979 search fallback rather than a product page. */
export function isAmazonSearch(url) {
  return /^https:\/\/www\.amazon\.com\/s\?/.test(String(url || ''));
}

/** Audible product URL. The ASIN is the only source — there is nothing to derive from. */
export function audibleUrl({ audibleAsin } = {}) {
  const asin = String(audibleAsin || '').trim();
  return looksLikeAsin(asin) ? `https://www.audible.com/pd/${asin}` : '';
}

export function goodreadsUrl({ id } = {}) {
  const gid = String(id || '').trim();
  return /^\d+$/.test(gid) ? `https://www.goodreads.com/book/show/${gid}` : '';
}

/**
 * Every store link for one book, plus the reasons any are missing.
 *
 * `notes` is for the build report, not the page. It is how a blank Audible link stays
 * visible as "not filled in yet" rather than disappearing into a silently empty row.
 */
export function storeLinks(book) {
  const links = {
    goodreads: goodreadsUrl(book),
    amazon: amazonUrl(book),
    audible: audibleUrl(book),
  };
  const notes = [];
  const asin = String(book.audibleAsin || '').trim();
  const amz = String(book.amazonAsin || '').trim();
  if (asin && !looksLikeAsin(asin)) notes.push(`audible ASIN is malformed: ${asin}`);
  // Audible ASINs are product ids and nearly always start with B0. A 10-digit numeric
  // is the shape of a print ISBN-10, which is the easiest wrong thing to paste into
  // that field — worth naming, because it would link to a real page for another edition.
  else if (asin && /^\d{10}$/.test(asin)) notes.push(`audible ASIN looks like an ISBN-10, not a B0 product id: ${asin}`);
  if (amz && !looksLikeAsin(amz)) notes.push(`amazon ASIN override is malformed: ${amz}`);
  if (!links.amazon && !amz) {
    const d = String(book.isbn || '').replace(/[^0-9Xx]/g, '');
    if (!d) notes.push('no amazon link: no ISBN and no ASIN override');
    else notes.push(`no amazon link: ISBN is neither an ISBN-10 nor a convertible ISBN-13 (${d})`);
  } else if (isAmazonSearch(links.amazon)) {
    // Not a defect — just worth seeing, since an ASIN override would upgrade it to a
    // direct product link.
    notes.push('amazon link is an exact-ISBN search (979 ISBN); an Amazon ASIN would make it direct');
  }
  return { links, notes };
}
