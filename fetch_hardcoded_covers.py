#!/usr/bin/env python3
"""
fetch_hardcoded_covers.py
Downloads covers for books that the automated scripts couldn't find,
using cover IDs manually looked up from Open Library.

Run from your repo root:
    python3 fetch_hardcoded_covers.py
"""

import os, time
import urllib.request

COVERS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "covers")

# {book_id: open_library_cover_id}
# Cover URL: https://covers.openlibrary.org/b/id/<cover_id>-L.jpg
COVER_IDS = {
    # ── No-ISBN classics ─────────────────────────────────────────
    "37976541":  12735651,   # Bad Blood — Carreyrou
    "23692271":  8634250,    # Sapiens — Harari
    "27161156":  14846900,   # Hillbilly Elegy — Vance
    "40121378":  12539702,   # Atomic Habits — Clear
    "41881472":  10389354,   # The Psychology of Money — Housel
    "27833494":  8580954,    # Dark Money — Mayer
    "58203328":  12441275,   # Midnight in Washington — Schiff
    "58412441":  11421361,   # I Alone Can Fix It — Leonnig
    "31138556":  14060659,   # Homo Deus — Harari
    "2612":      10873292,   # The Tipping Point — Gladwell
    "11324722":  7256782,    # The Righteous Mind — Haidt
    "29342515":  12515817,   # The Coaching Habit — Stanier
    "20556323":  9319615,    # Complex PTSD — Walker
    "23500254":  10217748,   # The Power of Vulnerability — Brown
    "53642699":  13838236,   # The Mountain Is You — Wiest
    "35171984":  8823031,    # Fantasyland — Andersen
    "25602451":  12180447,   # Losing the Signal — McNish
    "40367623":  13709813,   # Dawn of the Code War — Carlin
    "56688463":  12620374,   # How to Train Your Mind — Bailey
    "32895535":  10286374,   # Why Buddhism Is True — Wright

    # ── ISBN books found via title/author search ──────────────────
    "54897158":  10409947,   # Donald Trump v. The United States — Schmidt
    "58485511":  13287664,   # The Lords of Easy Money — Leonard
    "44034135":  10327559,   # Kochland — Leonard
    "35276688":  11172854,   # Devil's Bargain — Green
    "60321052":  13768386,   # Profiles in Ignorance — Borowitz
    "53952310":  11048172,   # Authoritarian Nightmare — Dean
    "50696262":  9367049,    # The Room Where It Happened — Bolton
    "90590134":  15104845,   # The Coming Wave — Suleyman
    "54114950":  10190384,   # Too Much and Never Enough — M. Trump
    "54916250":  10357977,   # Disloyal — Cohen
    "35230469":  12560622,   # Fascism: A Warning — Albright
    "41939872":  9334071,    # The Threat — McCabe
    "41436213":  10105047,   # Sandworm — Greenberg
    "55723020":  11757830,   # Dopamine Nation — Lembke
    "182733784": 15143751,   # Nuclear War: A Scenario — Jacobsen
    "122769179": 15116376,   # Renegade — Kinzinger
    "50997029":  10693801,   # How to Do the Work — LePera
    "63029353":  13190057,   # The Trump Tapes — Woodward
    "36373587":  9227933,    # Pure — Klein
    "58684275":  13635239,   # Torn Apart — Roberts
    "26222932":  12962196,   # Content Inc. — Pulizzi
    "23878688":  9001263,    # The 5 Love Languages — Chapman
    "148365315": 14538955,   # Tired of Winning — Karl
    "52764767":  10497462,   # White Too Long — Jones
    "60462182":  12824209,   # Tracers in the Dark — Greenberg
    "43708708":  8467410,    # White Fragility — DiAngelo
    "41721428":  8305903,    # Can't Hurt Me — Goggins
    "199798785": 14629361,   # Challenger — Higginbotham
    "74892462":  14375060,   # Blowback — Taylor
    "55429560":  10544113,   # First Platoon — Jacobsen
    "39888196":  10447105,   # Trump / Russia — Hettena
    "205495275": 14652612,   # The Myth of American Idealism — Chomsky
    "220161058": 15151586,   # Apple in China — McGee
    "222733476": 15104457,   # The Idaho Four — Patterson
    "22699774":  14920188,   # The Lords of Creation — Allen
    "223736214": 15121652,   # Breakneck — Wang
}

MIN_BYTES = 800


def fetch(url, timeout=15):
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "AlexBookshelf/3.0 (alex@drost.us)"}
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


def main():
    os.makedirs(COVERS_DIR, exist_ok=True)
    total = len(COVER_IDS)
    found = skipped = failed = 0

    print(f"Downloading {total} manually-looked-up covers…\n")

    for book_id, cover_id in COVER_IDS.items():
        dest = os.path.join(COVERS_DIR, f"{book_id}.jpg")

        if os.path.exists(dest) and os.path.getsize(dest) > MIN_BYTES:
            skipped += 1
            continue

        url = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
        data = fetch(url)

        if data and len(data) > MIN_BYTES:
            with open(dest, "wb") as f:
                f.write(data)
            print(f"  ✓  {book_id}  (cover {cover_id})")
            found += 1
        else:
            # Try medium size as fallback
            url_m = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
            data = fetch(url_m)
            if data and len(data) > MIN_BYTES:
                with open(dest, "wb") as f:
                    f.write(data)
                print(f"  ✓  {book_id}  (cover {cover_id}, medium)")
                found += 1
            else:
                print(f"  ✗  {book_id}  (cover {cover_id} not available)")
                failed += 1

        time.sleep(0.25)

    print(f"""
=== Summary ===
  Downloaded : {found}
  Skipped    : {skipped} (already existed)
  Failed     : {failed}
""")


if __name__ == "__main__":
    main()
