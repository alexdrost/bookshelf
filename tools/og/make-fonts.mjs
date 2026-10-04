// tools/og/make-fonts.mjs — regenerate tools/og/fonts/*.ttf from the site's own WOFF2.
//
//   node tools/og/make-fonts.mjs
//
// Satori cannot read WOFF2 and mishandles variable fonts, so the cards need static TTF
// instances. Rather than download Archivo and Inter from upstream — which would risk
// the cards drifting to a different cut of the typeface than the pages use — these are
// converted losslessly from the exact files in src/assets/fonts/.
//
// This is an AUTHORING step, run by hand when the site's fonts change. It is never part
// of `npm run build`: the TTFs are committed, and the build must not touch the network.
//
// inter-latin-400-italic.ttf is the one exception. The site ships no italic face and the
// home card's standfirst is italic, so it comes from @fontsource/inter — the same
// upstream the site's Inter files come from. Fetch it once with:
//
//   npm pack @fontsource/inter && tar xf fontsource-inter-*.tgz
//   cp package/files/inter-latin-400-italic.woff2 /tmp/
//
// then point WOFF2_EXTRA at it. Without it the script leaves the existing file alone.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_FONTS = path.join(ROOT, 'src/assets/fonts');
const OUT = path.join(ROOT, 'tools/og/fonts');
const WOFF2_EXTRA = process.env.WOFF2_EXTRA || '';

// Only the weights the cards actually use, to keep the committed bytes down.
const WANTED = [
  'archivo-latin-600-normal', 'archivo-latin-700-normal', 'archivo-latin-800-normal',
  'inter-latin-400-normal', 'inter-latin-500-normal', 'inter-latin-600-normal',
];

fs.mkdirSync(OUT, { recursive: true });

const PY = `
import sys
from fontTools.ttLib.woff2 import decompress
from fontTools.ttLib import TTFont
src, dst = sys.argv[1], sys.argv[2]
decompress(src, dst)
t = TTFont(dst)
assert 'fvar' not in t, dst + ' is a variable font; satori needs a static instance'
cmap = t.getBestCmap()
need = {'curly quote': 0x2019, 'em dash': 0x2014, 'ellipsis': 0x2026, 'middot': 0x00B7, 'e-acute': 0x00E9}
missing = [k for k, v in need.items() if v not in cmap]
print(('  MISSING ' + ', '.join(missing)) if missing else '  glyphs ok')
`;

let n = 0;
for (const base of WANTED) {
  const src = path.join(SRC_FONTS, `${base}.woff2`);
  if (!fs.existsSync(src)) { console.log(`  SKIP ${base} — not in src/assets/fonts`); continue; }
  const dst = path.join(OUT, `${base}.ttf`);
  process.stdout.write(`${base}.ttf\n`);
  console.log(execFileSync('python3', ['-c', PY, src, dst], { encoding: 'utf8' }).trimEnd());
  n++;
}

if (WOFF2_EXTRA && fs.existsSync(WOFF2_EXTRA)) {
  const dst = path.join(OUT, 'inter-latin-400-italic.ttf');
  process.stdout.write('inter-latin-400-italic.ttf (from WOFF2_EXTRA)\n');
  console.log(execFileSync('python3', ['-c', PY, WOFF2_EXTRA, dst], { encoding: 'utf8' }).trimEnd());
  n++;
} else if (!fs.existsSync(path.join(OUT, 'inter-latin-400-italic.ttf'))) {
  console.log('  WARNING inter-latin-400-italic.ttf is missing and WOFF2_EXTRA is unset.');
  console.log('          The home card standfirst will render roman instead of italic.');
}

console.log(`\n${n} fonts written to tools/og/fonts/`);
console.log('Requires: pip install fonttools brotli');
