// tools/patch-index.mjs — SESSION 1 Steps 2, 3 and 8, applied to the live index.html.
//
// Every edit below is an EXACT find/replace and asserts it matched exactly once.
// If the live file drifts, this fails loudly rather than silently mangling the SPA.
//
//   node tools/patch-index.mjs index.html.orig src/index.html

import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) { console.error('usage: node tools/patch-index.mjs <in> <out>'); process.exit(1); }

let html = fs.readFileSync(inPath, 'utf8');
const log = [];

function replaceOnce(label, find, replace, { expect = 1 } = {}) {
  const n = html.split(find).length - 1;
  if (n !== expect) {
    console.error(`\n✗ ${label}: expected ${expect} match(es), found ${n}`);
    console.error(`  FIND: ${find.slice(0, 160)}${find.length > 160 ? '…' : ''}`);
    process.exit(1);
  }
  html = html.split(find).join(replace);
  log.push(`✓ ${label} (${n}×)`);
}

// ---------------------------------------------------------------- Step 3 — fonts
replaceOnce('Step 3 · remove Google Fonts stylesheet',
  `<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" media="print" onload="this.media='all'">\n`,
  '');
replaceOnce('Step 3 · remove preconnect to fonts.googleapis.com',
  `<link rel="preconnect" href="https://fonts.googleapis.com">\n`, '');
replaceOnce('Step 3 · remove preconnect to fonts.gstatic.com',
  `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n`, '');

// ---------------------------------------------------------------- Step 2 — CSS out of the file
{
  const open = html.indexOf('<style>');
  const close = html.indexOf('</style>');
  if (open < 0 || close < 0) { console.error('✗ Step 2: <style> block not found'); process.exit(1); }
  html = html.slice(0, open)
    + '<link rel="stylesheet" href="/styles/tokens.css">\n<link rel="stylesheet" href="/styles/site.css">'
    + html.slice(close + '</style>'.length);
  log.push('✓ Step 2 · <style> block replaced with tokens.css + site.css links');
}

// ---------------------------------------------------------------- Step 8a — title
replaceOnce('Step 8a · title',
  `<title>Alex&rsquo;s Bookshelf</title>`,
  `<title>Alex Drost&rsquo;s Bookshelf &mdash; 300+ Books, Annotated and Connected</title>`);

// ---------------------------------------------------------------- Step 8b — H1
replaceOnce('Step 8b · H1',
  `<h1>A shelf of <em id="heroCount">300+</em> books I&rsquo;ve read.</h1>`,
  `<h1>Alex Drost&rsquo;s bookshelf &mdash; <em id="heroCount">300+</em> books, annotated and connected.</h1>`);

// ---------------------------------------------------------------- Step 8c — OG + Twitter
replaceOnce('Step 8c · og:title',
  `<meta property="og:title" content="Alex's Bookshelf">`,
  `<meta property="og:title" content="Alex Drost's Bookshelf">`);
replaceOnce('Step 8c · og:site_name',
  `<meta property="og:site_name" content="Alex's Bookshelf">`,
  `<meta property="og:site_name" content="Alex Drost's Bookshelf">`);
replaceOnce('Step 8c · twitter:title',
  `<meta name="twitter:title" content="Alex's Bookshelf">`,
  `<meta name="twitter:title" content="Alex Drost's Bookshelf">`);

// ---------------------------------------------------------------- Step 8d + 8e — canonical + Person
const PERSON = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': 'https://bookshelf.drost.us/#alexdrost',
  name: 'Alex Drost',
  jobTitle: 'Advisor & Speaker',
  image: 'https://alexdrost.com/alex-drost.jpg',
  url: 'https://bookshelf.drost.us/about',
  address: { '@type': 'PostalAddress', addressLocality: 'Detroit', addressRegion: 'MI', addressCountry: 'US' },
  sameAs: [
    'https://alexdrost.com',
    'https://drost.us',
    'https://alex.drost.us',
    'https://bookshelf.drost.us',
    'https://vibe.drost.us',
    'https://thebusinessofaccounting.com',
    'https://connection.builders',
    'https://www.linkedin.com/in/adrost/',
  ],
};
replaceOnce('Step 8d+8e · canonical + Person JSON-LD',
  `<link rel="icon" href="data:image/svg+xml,`,
  `<link rel="canonical" href="https://bookshelf.drost.us/">\n<script type="application/ld+json">\n${JSON.stringify(PERSON, null, 2)}\n</script>\n<link rel="icon" href="data:image/svg+xml,`);

// ---------------------------------------------------------------- Step 8f — footer
// §15 requires four real anchors: alexdrost.com · drost.us · LinkedIn · Goodreads.
// Goodreads and LinkedIn already exist here; alexdrost.com and drost.us are new —
// the site currently has no link to any other Drost property. The existing
// "Recommend a book" control is retained (SESSION 2 Step 7 requires it, unchanged).
replaceOnce('Step 8f · footer portfolio links',
  `<div class="ft-links"><button type="button" class="ft-li ft-rec"`,
  `<div class="ft-links"><a class="ft-li" href="https://alexdrost.com"><span>alexdrost.com</span></a><a class="ft-li" href="https://drost.us"><span>drost.us</span></a><button type="button" class="ft-li ft-rec"`);

// ---------------------------------------------------------------- guards
for (const banned of ['fonts.googleapis.com', 'fonts.gstatic.com']) {
  if (html.includes(banned)) { console.error(`✗ ${banned} still present in output`); process.exit(1); }
}
if (!html.includes('rel="canonical"')) { console.error('✗ canonical missing'); process.exit(1); }
if (html.includes('<style>')) { console.error('✗ inline <style> block still present'); process.exit(1); }

fs.writeFileSync(outPath, html);
console.log(log.join('\n'));
console.log(`\n✓ wrote ${outPath} (${html.length.toLocaleString('en-US')} bytes, was ${fs.readFileSync(inPath, 'utf8').length.toLocaleString('en-US')})`);
