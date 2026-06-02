#!/usr/bin/env python3
"""
fetch_missing_covers.py — second-pass cover fetcher
Reads missing.csv and tries additional sources for each book.
Run from your repo root after fetch_covers.py has already run once.

Sources tried (in order):
  1. Open Library by ISBN (large, then medium)
  2. bookcover.zone by ISBN
  3. Amazon image CDN by ISBN-10
  4. Google Books by ISBN
  5. Google Books by title + author
"""

import csv, json, os, re, time
import urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

MISSING_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "missing.csv")
COVERS_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "covers")
WORKERS     = 4    # lower than first pass to avoid rate limits
MIN_BYTES   = 800  # more lenient — some valid covers are small JPEGs


def _fetch(url, timeout=15):
    """GET url → (bytes, content-type) or (None, None)."""
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) "
                          "Chrome/120.0.0.0 Safari/537.36"
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), r.headers.get("Content-Type", "")
    except Exception:
        return None, None


def _is_image(data, ct=""):
    if not data or len(data) < MIN_BYTES:
        return False
    if ct and "image" in ct:
        return True
    return data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"


def _isbn13_to_isbn10(isbn13):
    """Convert ISBN-13 (978...) to ISBN-10."""
    if not isbn13 or len(isbn13) < 12 or not isbn13.startswith("978"):
        return None
    core = isbn13[3:12]
    total = sum((10 - i) * int(d) for i, d in enumerate(core))
    check = (11 - (total % 11)) % 11
    return core + ("X" if check == 10 else str(check))


def _google_thumb_url(items):
    if not items:
        return None
    il = items[0].get("volumeInfo", {}).get("imageLinks", {})
    url = il.get("thumbnail") or il.get("smallThumbnail")
    if not url:
        return None
    url = url.replace("http://", "https://")
    url = re.sub(r"&edge=curl", "", url)
    url = re.sub(r"zoom=1", "zoom=2", url)
    return url


def _try_all_sources(isbn, title, author):
    """Try every source in order; return image bytes on first hit, else None."""

    if isbn:
        # 1. Open Library large
        data, ct = _fetch(
            f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"
        )
        if _is_image(data, ct):
            return data
        time.sleep(0.4)

        # 2. Open Library medium (some ISBNs only have a medium cover)
        data, ct = _fetch(
            f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg?default=false"
        )
        if _is_image(data, ct):
            return data
        time.sleep(0.3)

        # 3. bookcover.zone
        data, ct = _fetch(f"https://bookcover.zone/jpg/large/{isbn}.jpg")
        if _is_image(data, ct):
            return data
        time.sleep(0.3)

        # 4. Amazon image CDN (uses ISBN-10)
        isbn10 = _isbn13_to_isbn10(isbn)
        if isbn10:
            data, ct = _fetch(
                f"https://images-na.ssl-images-amazon.com/images/P/{isbn10}.01.LZZZZZZZ.jpg"
            )
            if _is_image(data, ct):
                return data
            time.sleep(0.3)

        # 5. Google Books by ISBN
        data, _ = _fetch(
            f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
        )
        if data:
            try:
                thumb = _google_thumb_url(json.loads(data).get("items"))
                if thumb:
                    img, ct = _fetch(thumb)
                    if _is_image(img, ct):
                        return img
            except Exception:
                pass
        time.sleep(0.4)

    # 6. Google Books by title + author (works even without ISBN)
    q = urllib.parse.urlencode(
        {"q": f"intitle:{title} inauthor:{author}", "maxResults": "1"}
    )
    data, _ = _fetch(f"https://www.googleapis.com/books/v1/volumes?{q}")
    if data:
        try:
            thumb = _google_thumb_url(json.loads(data).get("items"))
            if thumb:
                img, ct = _fetch(thumb)
                if _is_image(img, ct):
                    return img
        except Exception:
            pass
    time.sleep(0.3)

    return None


# ── Per-book worker ───────────────────────────────────────────────────────────
_lock = Lock()


def process_book(row):
    bid    = row["Book Id"]
    title  = row["Title"]
    author = row["Author"]
    isbn   = row.get("ISBN", "").strip()
    dest   = os.path.join(COVERS_DIR, f"{bid}.jpg")

    if os.path.exists(dest) and os.path.getsize(dest) > MIN_BYTES:
        return "skip", row

    img = _try_all_sources(isbn, title, author)

    with _lock:
        if img:
            os.makedirs(COVERS_DIR, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(img)
            print(f"  ✓  {bid}  {title[:60]}")
            return "ok", row
        else:
            print(f"  ✗  {bid}  {title[:60]}")
            return "miss", row


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(MISSING_CSV):
        print(f"No missing.csv found at {MISSING_CSV} — nothing to do.")
        return

    with open(MISSING_CSV, newline="", encoding="utf-8") as f:
        books = list(csv.DictReader(f))

    total = len(books)
    print(f"Second-pass cover fetch for {total} books  ({WORKERS} workers)…\n")

    ok_count = miss_count = skip_count = 0
    still_missing = []

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process_book, row): row for row in books}
        for fut in as_completed(futures):
            status, row = fut.result()
            if status == "ok":
                ok_count += 1
            elif status == "skip":
                skip_count += 1
            else:
                miss_count += 1
                still_missing.append(row)

    # Overwrite missing.csv with only the books still unresolved
    with open(MISSING_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["Book Id", "Title", "Author", "ISBN", "Save as"]
        )
        w.writeheader()
        w.writerows(still_missing)

    print(f"""
=== Summary ===
  Found this run  : {ok_count}
  Skipped         : {skip_count} (already existed)
  Still missing   : {miss_count}

missing.csv updated — now contains only the {miss_count} books with no cover found.
""")


if __name__ == "__main__":
    main()
