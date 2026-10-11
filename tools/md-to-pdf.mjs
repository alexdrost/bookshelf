// tools/md-to-pdf.mjs — render a project markdown doc to PDF.
//
//   node tools/md-to-pdf.mjs GO-LIVE.md "bookshelf.drost.us" "Go-Live Runbook" "subtitle" out.pdf
//
// Uses Chromium's print engine rather than a PDF drawing library, so tables, code blocks
// and long prose lay out properly and hyphenate. Typography is the site's own — Archivo
// and Inter, embedded from src/assets/fonts so the PDF is self-contained — and the colours
// are the same tokens the site uses.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , mdPath, brand = 'bookshelf.drost.us', titleArg = '', subtitle = '', outArg] = process.argv;
if (!mdPath) { console.error('usage: node tools/md-to-pdf.mjs <file.md> [brand] [title] [subtitle] [out.pdf]'); process.exit(1); }
const out = outArg || mdPath.replace(/\.md$/, '.pdf');

const fontFace = (family, weight, file) => {
  const p = path.join(ROOT, 'src/assets/fonts', file);
  if (!fs.existsSync(p)) return '';
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:block;` +
    `src:url(data:font/woff2;base64,${fs.readFileSync(p).toString('base64')}) format("woff2")}`;
};
const FONTS = [
  fontFace('Archivo', 600, 'archivo-latin-600-normal.woff2'),
  fontFace('Archivo', 700, 'archivo-latin-700-normal.woff2'),
  fontFace('Archivo', 800, 'archivo-latin-800-normal.woff2'),
  fontFace('Inter', 400, 'inter-latin-400-normal.woff2'),
  fontFace('Inter', 600, 'inter-latin-600-normal.woff2'),
].join('\n');

const raw = fs.readFileSync(path.join(ROOT, mdPath), 'utf8');
// Drop the H1 — the cover block below carries the title.
const body = marked.parse(raw.replace(/^#\s+.*\n/, ''), { mangle: false, headerIds: false });
const title = titleArg || (/^#\s+(.*)$/m.exec(raw) || [, path.basename(mdPath, '.md')])[1];
const today = new Date(fs.statSync(path.join(ROOT, mdPath)).mtime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
${FONTS}
:root{
  --blue-d:#2c5680; --blue:#3a6ea5; --blue-br:#6b9bc8; --blue-lt:#aecbe2; --blue-tint:#e9f0f7;
  --green:#2f9e6b; --amber:#d98c1f; --amber-lt:#f0b850;
  --paper:#f6f5f1; --paper2:#ecebe4; --card:#ffffff;
  --ink:#1f2530; --ink2:#3d4654; --muted:#6b7480; --faint:#a3abb5; --line:#e6e3da;
}
@page{size:Letter;margin:17mm 16mm 20mm}
*{box-sizing:border-box}
body{margin:0;font-family:"Inter",system-ui,sans-serif;font-size:9.7pt;line-height:1.5;color:var(--ink2);
  -webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1,h2,h3,h4{font-family:"Archivo",system-ui,sans-serif;letter-spacing:-.02em;color:var(--ink);break-after:avoid}
h2{font-size:14pt;font-weight:800;margin:22pt 0 7pt;padding-bottom:5pt;border-bottom:2px solid var(--blue-lt)}
h2:first-of-type{margin-top:4pt}
h3{font-size:11pt;font-weight:700;margin:15pt 0 5pt;color:var(--blue-d)}
h4{font-size:9.8pt;font-weight:700;margin:12pt 0 4pt}
p{margin:0 0 7pt}
strong{color:var(--ink);font-weight:600}
a{color:var(--blue-d);text-decoration:none;border-bottom:.5px solid var(--blue-lt)}
ul,ol{margin:0 0 8pt;padding-left:15pt}
li{margin-bottom:3.5pt}
li::marker{color:var(--blue-br)}
hr{border:0;border-top:1px solid var(--line);margin:16pt 0}

code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:8.4pt;background:var(--paper2);
  color:var(--blue-d);padding:1pt 3.5pt;border-radius:3px}
pre{background:var(--ink);color:#e8eaed;border-radius:6px;padding:9pt 11pt;margin:0 0 9pt;overflow:hidden;
  break-inside:avoid;font-size:8.2pt;line-height:1.45}
pre code{background:none;color:inherit;padding:0;font-size:8.2pt}

table{width:100%;border-collapse:collapse;margin:0 0 10pt;font-size:8.9pt;break-inside:avoid}
th{font-family:"Archivo",sans-serif;font-weight:700;font-size:7.6pt;text-transform:uppercase;letter-spacing:.05em;
  color:var(--muted);text-align:left;padding:5pt 7pt;border-bottom:1.5px solid var(--line)}
td{padding:5pt 7pt;border-bottom:.5px solid var(--line);vertical-align:top;color:var(--ink2)}
tbody tr:nth-child(even){background:#faf9f6}
td code{font-size:8pt}

blockquote{margin:0 0 9pt;padding:7pt 12pt;border-left:3px solid var(--amber);background:var(--paper2);
  border-radius:0 5px 5px 0;color:var(--ink2)}
blockquote p:last-child{margin-bottom:0}

/* cover block */
.cover{border-bottom:3px solid var(--blue);padding-bottom:11pt;margin-bottom:16pt;break-after:avoid}
.cover .kick{font-family:"Archivo",sans-serif;text-transform:uppercase;letter-spacing:.2em;font-weight:600;
  font-size:7.2pt;color:var(--blue)}
.cover h1{font-size:23pt;font-weight:800;line-height:1.08;margin:7pt 0 5pt}
.cover .sub{font-size:10pt;color:var(--muted)}
.cover .meta{font-size:7.8pt;color:var(--faint);margin-top:8pt;font-family:"Archivo",sans-serif;
  text-transform:uppercase;letter-spacing:.08em;font-weight:600}
.logo{display:inline-flex;gap:2px;vertical-align:-2px;margin-right:6px}
.logo i{display:block;width:5px;border-radius:1px}
</style></head><body>
<div class="cover">
  <div class="kick"><span class="logo"><i style="height:13px;background:#2e6fb5"></i><i style="height:11px;background:#5b97d4"></i><i style="height:14px;background:#2f9e6b"></i></span>${brand}</div>
  <h1>${title}</h1>
  ${subtitle ? `<div class="sub">${subtitle}</div>` : ''}
  <div class="meta">${today}</div>
</div>
${body}
</body></html>`;

const tmp = path.join(ROOT, '.pdf-src.html');
fs.writeFileSync(tmp, html);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
await page.goto('file://' + tmp, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: path.join(ROOT, out),
  format: 'Letter',
  printBackground: true,
  margin: { top: '17mm', bottom: '20mm', left: '16mm', right: '16mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `<div style="width:100%;font-family:Inter,sans-serif;font-size:7pt;color:#a3abb5;padding:0 16mm;display:flex;justify-content:space-between">
      <span>${brand} &middot; ${title}</span><span class="pageNumber"></span></div>`,
});
await browser.close();
fs.unlinkSync(tmp);
const kb = (fs.statSync(path.join(ROOT, out)).size / 1024).toFixed(0);
console.log(`✓ ${out}  (${kb} kB)`);
