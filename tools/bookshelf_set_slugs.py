# bookshelf_set_slugs.py — Colab. Writes the permanent URL slug onto every book in Notion.
#
# Matches the conventions of the other scripts in this project: CONFIG block at the top,
# DRY_RUN defaults ON, Notion API version 2025-09-03, /data_sources/{id}/query (NOT
# /databases/{id}/query, which 404s), rate limiting, and a verification pass at the end.
#
# WHAT IT DOES
#   Reads slug_map.csv (goodreads_id,title,slug,shelf) and writes `slug` onto the matching
#   Notion row, matched on Goodreads ID.
#
# WHAT IT WILL NOT DO
#   Overwrite a slug that is already set. A slug is a published URL; changing one needs a
#   redirect, not a script. Rows that already have a different slug are REPORTED and SKIPPED.
#
# ---------------------------------------------------------------------------- CONFIG
NOTION_TOKEN = ""                 # paste in Colab only — never into chat or a file
DATA_SOURCE_ID = "f387f744-b4f6-46f8-83d4-22b60a9722c5"
CSV_PATH = "slug_map.csv"
NOTION_VERSION = "2025-09-03"
DRY_RUN = True                    # flip to False once the dry run looks right
ONLY_PUBLIC = True                # slugs are URLs; only books that reach the site need one
SLEEP = 0.35                      # ~3 requests/sec, comfortably under Notion's limit
# -----------------------------------------------------------------------------------

import csv, json, time, sys
import requests

H = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
}
BASE = "https://api.notion.com/v1"


def rich_text(prop):
    """Read a text-type property. Title lives under `title`, everything else under `rich_text`."""
    if not prop:
        return ""
    if prop.get("type") == "title":
        return "".join(t.get("plain_text", "") for t in prop.get("title", [])).strip()
    return "".join(t.get("plain_text", "") for t in prop.get("rich_text", [])).strip()


def fetch_all_rows():
    """Every row in the data source, paginated."""
    rows, cursor = [], None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        r = requests.post(f"{BASE}/data_sources/{DATA_SOURCE_ID}/query", headers=H, json=body, timeout=60)
        r.raise_for_status()
        j = r.json()
        rows.extend(j["results"])
        if not j.get("has_more"):
            return rows
        cursor = j["next_cursor"]


def main():
    if not NOTION_TOKEN:
        sys.exit("Set NOTION_TOKEN first.")

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        wanted = {r["goodreads_id"]: r for r in csv.DictReader(f)}
    print(f"slug_map.csv .......... {len(wanted)} books")

    rows = fetch_all_rows()
    print(f"notion rows ........... {len(rows)}")

    to_write, already, conflicts, missing_id, not_public, unmatched = [], [], [], [], [], []

    for page in rows:
        props = page["properties"]
        gid = rich_text(props.get("Goodreads ID"))
        title = rich_text(props.get("Title"))
        current = rich_text(props.get("Slug"))
        is_public = bool(props.get("Public?", {}).get("checkbox"))

        if not gid:
            missing_id.append(title)
            continue
        row = wanted.get(gid)
        if not row:
            unmatched.append((gid, title))
            continue
        if ONLY_PUBLIC and not is_public:
            not_public.append((gid, title))
            continue
        if current == row["slug"]:
            already.append(gid)
        elif current:
            # Never silently move a published URL.
            conflicts.append((gid, title, current, row["slug"]))
        else:
            to_write.append((page["id"], gid, title, row["slug"]))

    print(f"\nalready correct ....... {len(already)}")
    print(f"to write .............. {len(to_write)}")
    print(f"conflicts (SKIPPED) ... {len(conflicts)}")
    print(f"not public (skipped) .. {len(not_public)}")
    print(f"no goodreads id ....... {len(missing_id)}")
    print(f"in notion, not in csv . {len(unmatched)}")

    if conflicts:
        print("\n!! These rows already have a DIFFERENT slug. Changing a published slug moves a")
        print("   live URL and needs a redirect, so nothing was written. Resolve by hand:")
        for gid, title, cur, new in conflicts:
            print(f"   {gid}  {title[:44]:46} {cur}  ->  {new}")

    # A duplicate slug would collide two book pages onto one URL.
    seen = {}
    dupes = []
    for _, gid, title, slug in to_write:
        if slug in seen:
            dupes.append((slug, seen[slug], gid))
        seen[slug] = gid
    if dupes:
        sys.exit(f"\nABORT: duplicate slugs in the write set: {dupes}")

    if DRY_RUN:
        print("\nDRY_RUN is on — nothing written. First 15 that would be written:")
        for _, gid, title, slug in to_write[:15]:
            print(f"   {gid:>12}  {slug:<52} {title[:40]}")
        print("\nSet DRY_RUN = False to apply.")
        return

    print("\nwriting…")
    ok = fail = 0
    for i, (page_id, gid, title, slug) in enumerate(to_write, 1):
        payload = {"properties": {"Slug": {"rich_text": [{"type": "text", "text": {"content": slug}}]}}}
        try:
            r = requests.patch(f"{BASE}/pages/{page_id}", headers=H, json=payload, timeout=60)
            if r.status_code == 429:                      # rate limited — back off and retry once
                time.sleep(float(r.headers.get("Retry-After", 2)))
                r = requests.patch(f"{BASE}/pages/{page_id}", headers=H, json=payload, timeout=60)
            r.raise_for_status()
            ok += 1
        except Exception as e:
            fail += 1
            print(f"   FAIL {gid} {slug}: {e}")
        if i % 25 == 0:
            print(f"   {i}/{len(to_write)}")
        time.sleep(SLEEP)
    print(f"\nwrote {ok}, failed {fail}")

    # ---- verification pass: re-read and confirm every slug landed --------------
    print("\nverifying…")
    rows = fetch_all_rows()
    bad = []
    for page in rows:
        props = page["properties"]
        gid = rich_text(props.get("Goodreads ID"))
        if gid not in wanted:
            continue
        if ONLY_PUBLIC and not bool(props.get("Public?", {}).get("checkbox")):
            continue
        got = rich_text(props.get("Slug"))
        if got != wanted[gid]["slug"]:
            bad.append((gid, wanted[gid]["slug"], got))
    if bad:
        print(f"!! {len(bad)} rows do not match:")
        for gid, want, got in bad[:20]:
            print(f"   {gid}  want {want!r}  got {got!r}")
    else:
        print("all slugs verified ✓")


main()
