#!/usr/bin/env python3
"""
fetch_missing_covers.py — second-pass cover fetcher using Open Library search
Reads missing.csv and finds covers via title+author search (not just ISBN).
Run from your repo root after fetch_covers.py has already run once.
"""

import csv, json, os, re, time
import urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

MISSING_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "missing.csv")
COVERS_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "covers")
WORKERS     = 3    # lower concurrency to stay polite to Open Library
MIN_BYTES   = 800


def _fetch(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "AlexBookshelf/2.0 (alex@drost.us)"
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


def _ol_cover_by_id(cover_id, size="L"):
    """Fetch a cover from Open Library by its internal cover ID."""
    data, ct = _fetch(
        f"https://covers.openlibrary.org/b/id/{cover_id}-{size}.jpg?default=false"
    )
    return data if _is_image(data, ct) else None


def _ol_search(title, author):
    """
    Search Open Library for a book and return image bytes, or None.
    Uses /search.json which matches on any edition, not just a specific ISBN.
    """
    q = urllib.parse.urlencode({
        "title":  title,
        "author": author,
        "limit":  "5",
        "fields": "key,cover_i,isbn",
    })
    data, _ = _fetch(f"https://openlibrary.org/search.json?{q}")
    if not data:
        return None
    try:
        docs = json.loads(data).get("docs", [])
    except Exception:
        return None

    for doc in docs:
        # Try the direct cover_i field first
        cover_id = doc.get("cover_i")
        if cover_id:
            img = _ol_cover_by_id(cover_id, "L")
            if img:
                return img
            img = _ol_cover_by_id(cover_id, "M")
            if img:
                return img
            time.sleep(0.2)

        # Fall back to ISBNs listed on the work
        for isbn in (doc.get("isbn") or [])[:4]:
            d, ct = _fetch(
                f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"
            )
            if _is_image(d, ct):
                return d
            time.sleep(0.15)

    return None


def _google_books(title, author, isbn=""):
    """Google Books as a secondary fallback."""
    def _thumb(items):
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

    # by ISBN first
    if isbn:
        data, _ = _fetch(f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}")
        if data:
            try:
                thumb = _thumb(json.loads(data).get("items"))
                if thumb:
                    img, ct = _fetch(thumb)
                    if _is_image(img, ct):
                        return img
            except Exception:
                pass
        time.sleep(0.3)

    # by title + author
    q = urllib.parse.urlencode(
        {"q": f"intitle:{title} inauthor:{author}", "maxResults": "1"}
    )
    data, _ = _fetch(f"https://www.googleapis.com/books/v1/volumes?{q}")
    if data:
        try:
            thumb = _thumb(json.loads(data).get("items"))
            if thumb:
                img, ct = _fetch(thumb)
                if _is_image(img, ct):
                    return img
        except Exception:
            pass

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

    # 1. Open Library search (title + author → cover_id)
    img = _ol_search(title, author)
    time.sleep(0.5)

    # 2. Google Books fallback
    if not img:
        img = _google_books(title, author, isbn)
        time.sleep(0.3)

    with _lock:
        if img:
            os.makedirs(COVERS_DIR, exist_ok=True)
            with open(dest, "wb") as f:
                f.write(img)
            print(f"  ✓  {bid}  {title[:65]}")
            return "ok", row
        else:
            print(f"  ✗  {bid}  {title[:65]}")
            return "miss", row


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(MISSING_CSV):
        print(f"No missing.csv found — nothing to do.")
        return

    with open(MISSING_CSV, newline="", encoding="utf-8") as f:
        books = list(csv.DictReader(f))

    total = len(books)
    print(f"Second-pass cover fetch ({total} books, {WORKERS} workers)…\n")

    ok_n = miss_n = skip_n = 0
    still_missing = []

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(process_book, row): row for row in books}
        for fut in as_completed(futures):
            status, row = fut.result()
            if   status == "ok":   ok_n += 1
            elif status == "skip": skip_n += 1
            else:                  miss_n += 1; still_missing.append(row)

    with open(MISSING_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f, fieldnames=["Book Id", "Title", "Author", "ISBN", "Save as"]
        )
        w.writeheader()
        w.writerows(still_missing)

    print(f"""
=== Summary ===
  Found this run  : {ok_n}
  Skipped         : {skip_n} (already existed)
  Still missing   : {miss_n}

missing.csv updated — {miss_n} books remain unresolved.
""")


if __name__ == "__main__":
    main()
