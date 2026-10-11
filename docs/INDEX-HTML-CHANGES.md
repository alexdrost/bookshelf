# `index.html` — exact find/replace blocks

Every block below was applied by `tools/patch-index.mjs` against the `index.html` Alex supplied
on 9 Aug 2026, and **each one asserted exactly one match**. If any find string matches zero or
two times, the file has drifted — stop and re-derive rather than forcing it.

The finished file is delivered as `index.html` (ready for GitHub web-UI upload) and lives in the
repo at `src/index.html`. Re-run with:

```
node tools/patch-index.mjs index.html.orig src/index.html
```

**Verified after patching:** the remaining inline `<script>` passes `node --check`, and the page
renders **pixel-identical** at 390px and 1440px against the same markup with the CSS still inline.

---

## Do not change

- The `<style>` block contents. It was moved byte-for-byte. Do not reformat, reorder, merge
  duplicate rules, convert units, or rename variables.
- `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `twitter:image`,
  `twitter:image:alt` — left exactly as they were.
- The favicon data URI.
- The Formspree endpoint `mbderepk`, the "Recommend a book" control, and all SPA JavaScript.
- The literal `300+`. SESSION 2 replaces it with the computed count in all three places, once
  the home page is generated. Leaving it is correct for now.

---

## 1 · Fonts (Step 3) — three deletions

**Find** (delete entirely, including the trailing newline):
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
```

**Find** (delete entirely):
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
```

**Find** (delete entirely):
```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
```

QA fails on any surviving reference to either host.

## 2 · CSS (Step 2)

Replace the entire `<style> … </style>` block — opening tag through closing tag — with:

```html
<link rel="stylesheet" href="/styles/tokens.css">
<link rel="stylesheet" href="/styles/site.css">
```

`tokens.css` must load **first**: it carries the `@font-face` declarations and the `:root` block,
and `site.css` depends on those custom properties. Order is load-bearing.

## 3 · Title (Step 8a)

**Find**
```html
<title>Alex&rsquo;s Bookshelf</title>
```
**Replace**
```html
<title>Alex Drost&rsquo;s Bookshelf &mdash; 300+ Books, Annotated and Connected</title>
```

## 4 · H1 (Step 8b)

**Find**
```html
<h1>A shelf of <em id="heroCount">300+</em> books I&rsquo;ve read.</h1>
```
**Replace**
```html
<h1>Alex Drost&rsquo;s bookshelf &mdash; <em id="heroCount">300+</em> books, annotated and connected.</h1>
```

`id="heroCount"` must survive — `renderHome()` writes the live count into it.

## 5 · Open Graph and Twitter (Step 8c) — three edits

**Find** → **Replace**
```html
<meta property="og:title" content="Alex's Bookshelf">
<meta property="og:title" content="Alex Drost's Bookshelf">
```
```html
<meta property="og:site_name" content="Alex's Bookshelf">
<meta property="og:site_name" content="Alex Drost's Bookshelf">
```
```html
<meta name="twitter:title" content="Alex's Bookshelf">
<meta name="twitter:title" content="Alex Drost's Bookshelf">
```

Note these three use a straight apostrophe (`'`), not `&rsquo;` — matching the file as it stands.

## 6 · Canonical + Person schema (Steps 8d, 8e)

**Find** (the favicon line; match on its opening only):
```html
<link rel="icon" href="data:image/svg+xml,
```
**Replace with** — insert before it, leaving the favicon line intact:
```html
<link rel="canonical" href="https://bookshelf.drost.us/">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Person",
  "@id": "https://bookshelf.drost.us/#alexdrost",
  "name": "Alex Drost",
  "jobTitle": "Advisor & Speaker",
  "image": "https://alexdrost.com/alex-drost.jpg",
  "url": "https://bookshelf.drost.us/about",
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Detroit",
    "addressRegion": "MI",
    "addressCountry": "US"
  },
  "sameAs": [
    "https://alexdrost.com",
    "https://drost.us",
    "https://alex.drost.us",
    "https://bookshelf.drost.us",
    "https://vibe.drost.us",
    "https://thebusinessofaccounting.com",
    "https://connection.builders",
    "https://www.linkedin.com/in/adrost/"
  ]
}
</script>
<link rel="icon" href="data:image/svg+xml,
```

**Guardrails on this block:** the `@id` must be byte-identical on all five pages — it is what
tells search engines the site is one entity. The `sameAs` array is an identity assertion, not an
editorial list: **do not add or remove nodes**, and note it is deliberately different from the
visible footer. No `email`, no `telephone`. `hasCredential` and `alumniOf` appear on `/about`
only, never here.

## 7 · Footer portfolio links (Step 8f)

The footer already carries Goodreads and LinkedIn. This adds the two missing §15 links —
the site currently has no link to any other Drost property.

**Find**
```html
<div class="ft-links"><button type="button" class="ft-li ft-rec"
```
**Replace**
```html
<div class="ft-links"><a class="ft-li" href="https://alexdrost.com"><span>alexdrost.com</span></a><a class="ft-li" href="https://drost.us"><span>drost.us</span></a><button type="button" class="ft-li ft-rec"
```

The existing "Recommend a book" button is deliberately retained — SESSION 2 Step 7 requires it
unchanged. All four required links (`alexdrost.com`, `drost.us`, LinkedIn, Goodreads) are real
`<a href>` elements, as §15 requires.

---

## Post-change QA

- [ ] No `fonts.googleapis.com` or `fonts.gstatic.com` anywhere in the file
- [ ] No inline `<style>` block remains
- [ ] `rel="canonical"` present
- [ ] JSON-LD parses; Person `@id` is `https://bookshelf.drost.us/#alexdrost`
- [ ] No `Review`, `aggregateRating`, or any rating field
- [ ] Inline `<script>` passes `node --check`
- [ ] Renders identically at 390px and 1440px
- [ ] `/styles/tokens.css`, `/styles/site.css`, and `/assets/fonts/*.woff2` are deployed alongside

**Deploy note:** this file now depends on `/styles/` and `/assets/fonts/`. Uploading `index.html`
on its own will ship an unstyled site. Upload the whole `dist/` payload together.
