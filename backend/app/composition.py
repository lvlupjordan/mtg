"""Deck composition: fetch a deck's cards from Moxfield, ensure each card is
tagged (reusing the shared `cards` table as the tag cache, tagging only cards
we've never seen), apply a curated set of rules, and cache the result.

Rules-only, no manual overrides. A card counts in every category it matches,
so the percentages can exceed 100%.
"""
import re
import json
import time
import logging
import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.routers.collection import _scryfall_card_to_dict, _upsert_card, _fetch_tags_for_new_cards

log = logging.getLogger("composition")

# App-wide advisory-lock key: at most ONE composition build runs at a time
# across the whole app, so concurrent builds can't pile onto Scryfall/Moxfield.
GLOBAL_BUILD_KEY = 918273645

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


def _ensure_cards_tagged(db: Session, cards: list[dict]) -> dict[str, tuple[str, set]]:
    """Return {name: (type_line, {tags})} for the deck's cards.

    Cards already in `cards` are read from there. Cards we've never seen are
    added to `cards` (invisible to the collection — no collection_entry) and
    tagged with the SAME proven, gentle collection tagger. Composition itself
    never runs its own Scryfall tagging; it just reads what that produced. Once
    a card is tagged it's cached in `cards` for every future deck."""
    names = sorted({c["name"] for c in cards if c["name"]})
    rows = db.execute(text("SELECT name, type_line, oracle_tags FROM cards WHERE name = ANY(:ns)"),
                      {"ns": names}).fetchall()
    known = {r.name: (r.type_line or "", set(r.oracle_tags or [])) for r in rows}
    missing_ids = list({c["scryfall_id"] for c in cards
                        if c["name"] not in known and c.get("scryfall_id")})
    if not missing_ids:
        return known

    # 1) Resolve the unseen cards by Scryfall id and add them to `cards`.
    new_oracle_to_ids: dict[str, list[str]] = {}
    with httpx.Client(timeout=25, headers={"User-Agent": "MTGTracker/1.0"}) as client:
        for i in range(0, len(missing_ids), 75):
            batch = [{"id": x} for x in missing_ids[i:i + 75]]
            resp = None
            for attempt in range(3):
                resp = client.post("https://api.scryfall.com/cards/collection", json={"identifiers": batch})
                if resp.status_code != 429:
                    break
                log.warning("scryfall 429 (resolve, attempt %s)", attempt + 1)
                time.sleep(3 * (attempt + 1))
            if resp is None or resp.status_code != 200:
                raise RuntimeError("Scryfall is busy resolving cards; try again shortly")
            for c in resp.json().get("data", []):
                card = _scryfall_card_to_dict(c)
                _upsert_card(db, card)
                oid = card.get("oracle_id")
                if oid:
                    new_oracle_to_ids.setdefault(oid, []).append(card["id"])
            time.sleep(0.1)
    db.commit()

    # 2) Tag the new cards with the proven collection tagger (gentle, tag-centric).
    n_new = sum(len(v) for v in new_oracle_to_ids.values())
    log.info("composition: tagging %s new cards via collection tagger", n_new)
    tags_by_id = _fetch_tags_for_new_cards(new_oracle_to_ids)
    for card_id, tags in tags_by_id.items():
        db.execute(text("UPDATE cards SET oracle_tags = :t WHERE id = :id"), {"t": tags, "id": card_id})
    db.commit()

    # 3) Re-read the now-present cards into `known`.
    missing_names = [c["name"] for c in cards if c["name"] not in known]
    rows2 = db.execute(text("SELECT name, type_line, oracle_tags FROM cards WHERE name = ANY(:ns)"),
                       {"ns": missing_names}).fetchall()
    for r in rows2:
        known[r.name] = (r.type_line or "", set(r.oracle_tags or []))
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


def _read_snapshot(db: Session, deck_id: int):
    return db.execute(text("""
        SELECT total_cards, lands, categories, synced_at
        FROM deck_compositions WHERE deck_id = :id
    """), {"id": deck_id}).fetchone()


def _save_snapshot(db: Session, deck_id: int, result: dict):
    db.execute(text("""
        INSERT INTO deck_compositions (deck_id, total_cards, lands, categories, synced_at)
        VALUES (:id, :total, :lands, CAST(:cats AS jsonb), now())
        ON CONFLICT (deck_id) DO UPDATE SET
            total_cards = EXCLUDED.total_cards, lands = EXCLUDED.lands,
            categories = EXCLUDED.categories, synced_at = now()
    """), {"id": deck_id, "total": result["total_cards"], "lands": result["lands"],
           "cats": json.dumps(result["categories"])})
    db.commit()


def _building_response(deck_id: int, row=None, queued: bool = False) -> dict:
    if row:
        resp = _snapshot_to_response(deck_id, row)
        resp["building"] = True
        resp["queued"] = queued
        return resp
    return {"deck_id": deck_id, "building": True, "queued": queued, "total_cards": 0, "lands": 0,
            "nonland": 0, "synced_at": None,
            "categories": [{"name": c, "count": 0, "pct_of_nonland": 0, "cards": []}
                           for c in CATEGORY_ORDER]}


def get_composition(db: Session, deck, refresh: bool = False) -> dict:
    """Return a deck's composition. Snapshot-first: an existing snapshot is served
    instantly (staleness shown via synced_at); rebuilds happen only on first-ever
    view or refresh=True. Single-flight per deck via a Postgres advisory lock —
    concurrent requests (a refresh, a second viewer) get a `building` status
    instead of starting a duplicate build. Requires deck.moxfield_url."""
    ensure_table(db)
    if not deck.moxfield_url:
        raise ValueError("No Moxfield URL set for this deck")

    if not refresh:
        row = _read_snapshot(db, deck.id)
        if row:
            return _snapshot_to_response(deck.id, row)

    # Single-flight: only one build per deck at a time. The advisory lock is held
    # on a DEDICATED connection for the whole build — the session's connection can
    # change across the commits below, so we must not lock/unlock through it.
    lock_conn = db.get_bind().connect()
    got_deck = lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": deck.id}).scalar()
    if not got_deck:
        lock_conn.close()
        log.info("composition build already in progress deck=%s", deck.id)
        return _building_response(deck.id, _read_snapshot(db, deck.id), queued=False)

    # Global serialization: at most one build runs app-wide. If another deck is
    # building, don't start a second — return a queued status and let the client
    # poll until its turn (no concurrent builds piling onto Scryfall/Moxfield).
    got_global = lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": GLOBAL_BUILD_KEY}).scalar()
    if not got_global:
        lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": deck.id})
        lock_conn.close()
        log.info("composition build queued deck=%s (another build running)", deck.id)
        return _building_response(deck.id, _read_snapshot(db, deck.id), queued=True)

    t0 = time.time()
    try:
        log.info("composition build start deck=%s", deck.id)
        cards = _fetch_moxfield_cards(deck.moxfield_url)
        tagmap = _ensure_cards_tagged(db, cards)
        result = _compute(cards, tagmap)
        _save_snapshot(db, deck.id, result)
        log.info("composition build done deck=%s in %.1fs (total=%s)", deck.id, time.time() - t0, result["total_cards"])
    except Exception as e:
        log.warning("composition build FAILED deck=%s after %.1fs: %s", deck.id, time.time() - t0, e)
        raise
    finally:
        try:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": GLOBAL_BUILD_KEY})
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": deck.id})
        finally:
            lock_conn.close()  # closing the connection also releases both locks

    return _snapshot_to_response(deck.id, _read_snapshot(db, deck.id))
