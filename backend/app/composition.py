"""Deck composition: fetch a deck's cards from Moxfield, ensure each card is
tagged (reusing the shared `cards` table as the tag cache, tagging only cards
we've never seen), apply a curated set of rules, and cache the result.

Rules-only, no manual overrides. A card counts in every category it matches,
so the percentages can exceed 100%.
"""
import re
import time
import urllib.parse
import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.routers.collection import _scryfall_card_to_dict, _upsert_card

# Only the tags the composition rules actually use — fetching just these (not
# the full ~47 ORACLE_TAGS) keeps card tagging ~4x cheaper against Scryfall.
COMPOSITION_TAGS = [
    "ramp", "mana-dork", "draw", "card-advantage", "spot-removal",
    "board-wipe", "counterspell", "tutor", "recursion", "reanimation", "protection",
]

# Curated deck-composition categories → the underlying Scryfall oracle tags.
# Each card lands in every category whose rule it satisfies.
CATEGORY_RULES = {
    "Ramp":          lambda tl, tg: ("ramp" in tg or "mana-dork" in tg),
    "Card Draw":     lambda tl, tg: ("draw" in tg or "card-advantage" in tg),
    "Spot Removal":  lambda tl, tg: "spot-removal" in tg,
    "Board Wipes":   lambda tl, tg: "board-wipe" in tg,
    "Counterspells": lambda tl, tg: "counterspell" in tg,
    # Real tutors only — exclude land tutors (Evolving Wilds) and mana tutors (Cultivate).
    "Tutors":        lambda tl, tg: ("tutor" in tg and "Land" not in tl and "ramp" not in tg),
    "Recursion":     lambda tl, tg: ("recursion" in tg or "reanimation" in tg),
    "Protection":    lambda tl, tg: "protection" in tg,
}
CATEGORY_ORDER = list(CATEGORY_RULES.keys())

_MOX_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en;q=0.9",
    "Origin": "https://www.moxfield.com",
    "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}


def ensure_table(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS deck_compositions (
            deck_id     INTEGER PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
            total_cards INTEGER NOT NULL,
            lands       INTEGER NOT NULL,
            categories  JSONB   NOT NULL,
            synced_at   TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    db.commit()


def _fetch_moxfield_cards(mox_url: str) -> list[dict]:
    """Return [{name, scryfall_id, type_line, quantity}] for mainboard+commanders."""
    m = re.search(r'moxfield\.com/decks/([A-Za-z0-9_-]+)', mox_url or "")
    if not m:
        raise ValueError("Invalid Moxfield URL")
    mid = m.group(1)
    headers = {**_MOX_HEADERS, "Referer": f"https://www.moxfield.com/decks/{mid}"}
    data = None
    for attempt in range(5):
        r = httpx.get(f"https://api2.moxfield.com/v3/decks/all/{mid}",
                      headers=headers, timeout=20, follow_redirects=True)
        if r.status_code == 200 and r.text.strip().startswith("{"):
            data = r.json()
            break
        time.sleep(2 * (attempt + 1))
    if data is None:
        raise RuntimeError("Moxfield is not responding (it rate-limits server requests); try again shortly")

    out = []
    for bname, board in data.get("boards", {}).items():
        if bname not in ("mainboard", "commanders"):
            continue
        for entry in board.get("cards", {}).values():
            c = entry.get("card", {})
            out.append({
                "name": c.get("name", ""),
                "scryfall_id": c.get("scryfall_id"),
                "type_line": c.get("type_line") or "",
                "quantity": entry.get("quantity", 1),
            })
    return out


def _scry_get(client: httpx.Client, url: str):
    """Scryfall GET. 404 → None (no cards match — legitimate). Persistent
    rate-limiting → raise, so the build fails cleanly instead of caching
    partial/wrong tags. Short capped backoff (no multi-minute stalls)."""
    for attempt in range(4):
        r = client.get(url)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 404:
            return None
        if r.status_code == 429:
            time.sleep(min(5 * (attempt + 1), 20))
            continue
        time.sleep(2)
    raise RuntimeError("Scryfall is rate-limiting; try the build again shortly")


def _ensure_cards_tagged(db: Session, cards: list[dict]) -> dict[str, tuple[str, set]]:
    """Return {name: (type_line, {tags})}. Cards already in the `cards` table are
    read from there; unseen cards are resolved from Scryfall, tagged across the
    full ORACLE_TAGS set, upserted (so it's a one-time cost), then included."""
    names = sorted({c["name"] for c in cards if c["name"]})
    rows = db.execute(text("SELECT name, type_line, oracle_tags FROM cards WHERE name = ANY(:ns)"),
                      {"ns": names}).fetchall()
    known = {r.name: (r.type_line or "", set(r.oracle_tags or [])) for r in rows}
    missing = [c for c in cards if c["name"] not in known and c.get("scryfall_id")]

    if missing:
        with httpx.Client(timeout=25, headers={"User-Agent": "MTGTracker/1.0"}) as client:
            # 1) resolve card data by scryfall id (batches of 75) and upsert
            resolved = {}  # name -> card dict
            ids = [c["scryfall_id"] for c in missing]
            for i in range(0, len(ids), 75):
                batch = [{"id": x} for x in ids[i:i + 75]]
                for attempt in range(4):
                    r = client.post("https://api.scryfall.com/cards/collection",
                                    json={"identifiers": batch})
                    if r.status_code == 200:
                        for c in r.json().get("data", []):
                            resolved[c["name"]] = _scryfall_card_to_dict(c)
                        break
                    if r.status_code == 429:
                        time.sleep(min(5 * (attempt + 1), 20)); continue
                    time.sleep(2)
                else:
                    raise RuntimeError("Scryfall could not resolve deck cards (rate-limited); try again shortly")
                time.sleep(0.12)

            # 2) tag the new cards via batched exact-name oracletag queries
            new_names = sorted(resolved.keys())
            tags_by_name = {n: set() for n in new_names}
            for tag in COMPOSITION_TAGS:
                for j in range(0, len(new_names), 15):
                    grp = new_names[j:j + 15]
                    q = f'oracletag:{tag} (' + " or ".join(f'!"{n}"' for n in grp) + ')'
                    url = "https://api.scryfall.com/cards/search?unique=cards&q=" + urllib.parse.quote(q)
                    while url:
                        data = _scry_get(client, url)
                        if not data:
                            break
                        for c in data.get("data", []):
                            if c["name"] in tags_by_name:
                                tags_by_name[c["name"]].add(tag)
                        url = data.get("next_page")
                        time.sleep(0.12)

            # 3) upsert with tags, add to `known`
            for name, card in resolved.items():
                card["oracle_tags"] = sorted(tags_by_name.get(name, set()))
                _upsert_card(db, card)
                known[name] = (card.get("type_line") or "", set(card["oracle_tags"]))
        db.commit()

    return known


def _compute(cards: list[dict], tagmap: dict[str, tuple[str, set]]) -> dict:
    total = sum(c["quantity"] for c in cards)
    lands = sum(c["quantity"] for c in cards if "Land" in c["type_line"])
    categories = {cat: [] for cat in CATEGORY_ORDER}
    seen = set()
    for c in cards:
        name = c["name"]
        if name in seen:
            continue
        seen.add(name)
        tl, tg = tagmap.get(name, (c["type_line"], set()))
        tl = tl or c["type_line"]
        for cat, rule in CATEGORY_RULES.items():
            if rule(tl, tg):
                categories[cat].append(name)
    for cat in categories:
        categories[cat].sort()
    return {"total_cards": total, "lands": lands, "categories": categories}


def _snapshot_to_response(deck_id: int, row) -> dict:
    total = row.total_cards
    lands = row.lands
    nonland = max(total - lands, 1)
    cats = row.categories
    return {
        "deck_id": deck_id,
        "total_cards": total,
        "lands": lands,
        "nonland": total - lands,
        "synced_at": row.synced_at.isoformat() if row.synced_at else None,
        "categories": [
            {"name": cat, "count": len(cats.get(cat, [])),
             "pct_of_nonland": round(100 * len(cats.get(cat, [])) / nonland),
             "cards": cats.get(cat, [])}
            for cat in CATEGORY_ORDER
        ],
    }


def get_composition(db: Session, deck, refresh: bool = False) -> dict:
    """Return a deck's composition, rebuilding from Moxfield when missing, stale,
    or when refresh=True. Requires deck.moxfield_url."""
    ensure_table(db)
    if not deck.moxfield_url:
        raise ValueError("No Moxfield URL set for this deck")

    if not refresh:
        # Snapshot-first: always serve an existing snapshot (any age) so a deck
        # page never blocks on Moxfield. Staleness is shown via synced_at; the
        # user rebuilds explicitly with refresh=True. Only build when none exists.
        row = db.execute(text("""
            SELECT total_cards, lands, categories, synced_at
            FROM deck_compositions WHERE deck_id = :id
        """), {"id": deck.id}).fetchone()
        if row:
            return _snapshot_to_response(deck.id, row)

    cards = _fetch_moxfield_cards(deck.moxfield_url)
    tagmap = _ensure_cards_tagged(db, cards)
    result = _compute(cards, tagmap)

    import json
    db.execute(text("""
        INSERT INTO deck_compositions (deck_id, total_cards, lands, categories, synced_at)
        VALUES (:id, :total, :lands, CAST(:cats AS jsonb), now())
        ON CONFLICT (deck_id) DO UPDATE SET
            total_cards = EXCLUDED.total_cards, lands = EXCLUDED.lands,
            categories = EXCLUDED.categories, synced_at = now()
    """), {"id": deck.id, "total": result["total_cards"], "lands": result["lands"],
           "cats": json.dumps(result["categories"])})
    db.commit()

    row = db.execute(text("""
        SELECT total_cards, lands, categories, synced_at FROM deck_compositions WHERE deck_id = :id
    """), {"id": deck.id}).fetchone()
    return _snapshot_to_response(deck.id, row)
