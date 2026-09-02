"""Deck composition: fetch a deck's cards from Moxfield, ensure each card is
tagged (reusing the shared `cards` table as the tag cache, tagging only cards
we've never seen), apply a curated set of rules, and cache the result.

Rules-only, no manual overrides. A card counts in every category it matches,
so the percentages can exceed 100%.
"""
import re
import json
import math
import time
import logging
import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.routers.collection import _scryfall_card_to_dict, _upsert_card, ORACLE_TAGS

log = logging.getLogger("composition")

# App-wide advisory-lock key: at most ONE composition build runs at a time
# across the whole app, so concurrent builds can't pile onto Scryfall/Moxfield.
GLOBAL_BUILD_KEY = 918273645
# Separate lock for the background tagger — only one tag pass runs at a time,
# but it does NOT block fast builds (which no longer tag inline).
TAGGER_LOCK_KEY = 918273646

# Approx count of EDHREC-ranked cards — the reference for turning a card's
# edhrec_rank (1 = most-played) into a 0-100 popularity percentile.
EDHREC_MAX = 30000

# Scryfall's tags are inconsistent for fogs and single-target protection (it
# tagged Respite `protection` but not the near-identical Riot Control), so these
# categories also match the rules text. Fog = "prevent all damage this turn";
# Protection = protect a permanent (hexproof/indestructible/shroud, protection
# from, phase out).
_FOG_TEXT = re.compile(r"prevent all [^.]*damage", re.IGNORECASE)
_PROTECTION_TEXT = re.compile(
    r"gains?\b[^.]*\b(hexproof|indestructible|shroud)"
    r"|protection from"
    r"|phases? out",
    re.IGNORECASE,
)

def _is_land(type_line: str) -> bool:
    """True only if the card's FRONT face is a land. A modal double-faced card
    whose back is a land — e.g. 'Legendary Creature — God // Land' (Ojer Kaslem)
    — is cast from the front, so it's not a land for our purposes."""
    front = (type_line or "").split("//")[0]
    return "Land" in front


# Curated deck-composition categories. Each rule takes (type_line, oracle_text,
# tags); a card lands in every category it satisfies.
CATEGORY_RULES = {
    "Ramp":           lambda tl, txt, tg: ("ramp" in tg or "mana-dork" in tg),
    "Card Draw":      lambda tl, txt, tg: ("draw" in tg or "card-advantage" in tg),
    "Spot Removal":   lambda tl, txt, tg: "spot-removal" in tg,
    "Board Wipes":    lambda tl, txt, tg: "board-wipe" in tg,
    "Counterspells":  lambda tl, txt, tg: "counterspell" in tg,
    # Real tutors only — exclude land tutors (Evolving Wilds) and mana tutors (Cultivate).
    "Tutors":         lambda tl, txt, tg: ("tutor" in tg and not _is_land(tl) and "ramp" not in tg),
    "Recursion":      lambda tl, txt, tg: ("recursion" in tg or "reanimation" in tg),
    # Protection = protect a permanent; a fog tagged `protection` goes to Fog, not here.
    "Protection":     lambda tl, txt, tg: (bool(_PROTECTION_TEXT.search(txt or ""))
                                           or ("protection" in tg and not _FOG_TEXT.search(txt or ""))),
    "Fog":            lambda tl, txt, tg: bool(_FOG_TEXT.search(txt or "")),
    "Graveyard Hate": lambda tl, txt, tg: "graveyard-hate" in tg,
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
    # Cards awaiting background tagging at build time (0 = fully tagged).
    db.execute(text("ALTER TABLE deck_compositions ADD COLUMN IF NOT EXISTS pending_tags INTEGER NOT NULL DEFAULT 0"))
    # EDHREC popularity score (0-100, mean per-card percentile); NULL until computed.
    db.execute(text("ALTER TABLE deck_compositions ADD COLUMN IF NOT EXISTS popularity_score REAL"))
    # cards.edhrec_rank feeds the score above; ensure it exists before any build.
    db.execute(text("ALTER TABLE cards ADD COLUMN IF NOT EXISTS edhrec_rank INTEGER"))
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


def _read_known(db: Session, names: list[str]) -> dict[str, tuple[str, str, set, bool]]:
    """{name: (type_line, oracle_text, {tags}, tagged?)}. tagged? is False when
    oracle_tags IS NULL (never tagged — awaiting the background tagger); an empty
    array means tagged with no matching tags."""
    rows = db.execute(text("SELECT name, type_line, oracle_text, oracle_tags FROM cards WHERE name = ANY(:ns)"),
                      {"ns": names}).fetchall()
    return {r.name: (r.type_line or "", r.oracle_text or "",
                     set(r.oracle_tags or []), r.oracle_tags is not None) for r in rows}


def _ensure_cards_present(db: Session, cards: list[dict]) -> tuple[dict[str, tuple[str, str, set, bool]], int]:
    """Make sure every deck card exists in `cards`, then return (known, pending).

    Cards we've never seen are RESOLVED by Scryfall id (fast, one call) and
    inserted with oracle_tags = NULL — i.e. present but untagged. The slow
    47-search tagging happens later, off the request path, in the background
    tagger. `pending` is the number of distinct deck cards still untagged, so the
    caller can tell the client to poll until the background tagger fills them in.
    """
    names = sorted({c["name"] for c in cards if c["name"]})
    known = _read_known(db, names)
    missing_ids = list({c["scryfall_id"] for c in cards
                        if c["name"] not in known and c.get("scryfall_id")})

    if missing_ids:
        # Resolve unseen cards by Scryfall id and insert them UNTAGGED (NULL).
        resolved: dict[str, dict] = {}
        with httpx.Client(timeout=25, headers={"User-Agent": "MTGTracker/1.0"}) as client:
            for i in range(0, len(missing_ids), 75):
                batch = [{"id": x} for x in missing_ids[i:i + 75]]
                resp = None
                for attempt in range(4):
                    resp = client.post("https://api.scryfall.com/cards/collection", json={"identifiers": batch})
                    if resp.status_code != 429:
                        break
                    log.warning("scryfall 429 (resolve, attempt %s)", attempt + 1)
                    time.sleep(3 * (attempt + 1))
                if resp is None or resp.status_code != 200:
                    raise RuntimeError("Scryfall is busy resolving cards; try again shortly")
                for c in resp.json().get("data", []):
                    resolved[c["id"]] = _scryfall_card_to_dict(c)
                time.sleep(0.1)
        for card in resolved.values():
            card["oracle_tags"] = None      # NULL = untagged; the tagger will fill it
            _upsert_card(db, card)
        db.commit()
        known = _read_known(db, names)

    deck_names = {c["name"] for c in cards if c["name"]}
    pending = sum(1 for n in deck_names if not known.get(n, ("", "", set(), True))[3])
    return known, pending


def _popularity_score(db: Session, nonland_names: list[str]) -> float | None:
    """A deck's 0-100 EDHREC popularity score: the mean per-card percentile of
    its non-land cards, where a card's percentile is 100·(1 − ln(rank)/ln(MAX))
    (rank 1 = most-played → ~100; obscure → ~0). Cards with no edhrec_rank are
    skipped; returns None if none of the deck's cards are ranked. Higher = more
    staple-heavy. Popularity, not raw power."""
    if not nonland_names:
        return None
    rows = db.execute(text("SELECT edhrec_rank FROM cards WHERE name = ANY(:ns) AND edhrec_rank IS NOT NULL"),
                      {"ns": nonland_names}).fetchall()
    denom = math.log(EDHREC_MAX)
    scores = [100 * (1 - math.log(r.edhrec_rank) / denom)
              for r in rows if r.edhrec_rank and r.edhrec_rank > 0]
    if not scores:
        return None
    raw = sum(scores) / len(scores)
    # Rescale so a typical deck (~30 raw) reads ~50, with wider, more legible
    # spread; the log-percentile alone bunches real decks in the teens-to-40s.
    adj = 50.0 + (raw - 30.0) * 2.3
    return round(max(0.0, min(100.0, adj)), 1)


def _compute(cards: list[dict], tagmap: dict[str, tuple[str, set]]) -> dict:
    total = sum(c["quantity"] for c in cards)
    lands = sum(c["quantity"] for c in cards if _is_land(c["type_line"]))
    categories = {cat: [] for cat in CATEGORY_ORDER}
    seen = set()
    for c in cards:
        name = c["name"]
        if name in seen:
            continue
        seen.add(name)
        tl, txt, tg, _tagged = tagmap.get(name, (c["type_line"], "", set(), True))
        tl = tl or c["type_line"]
        for cat, rule in CATEGORY_RULES.items():
            if rule(tl, txt, tg):
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
        "pending_tags": getattr(row, "pending_tags", 0) or 0,
        "popularity_score": getattr(row, "popularity_score", None),
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
        SELECT total_cards, lands, categories, synced_at, pending_tags, popularity_score
        FROM deck_compositions WHERE deck_id = :id
    """), {"id": deck_id}).fetchone()


def _save_snapshot(db: Session, deck_id: int, result: dict, pending: int = 0, popularity: float | None = None):
    db.execute(text("""
        INSERT INTO deck_compositions (deck_id, total_cards, lands, categories, synced_at, pending_tags, popularity_score)
        VALUES (:id, :total, :lands, CAST(:cats AS jsonb), now(), :pending, :popularity)
        ON CONFLICT (deck_id) DO UPDATE SET
            total_cards = EXCLUDED.total_cards, lands = EXCLUDED.lands,
            categories = EXCLUDED.categories, synced_at = now(),
            pending_tags = EXCLUDED.pending_tags, popularity_score = EXCLUDED.popularity_score
    """), {"id": deck_id, "total": result["total_cards"], "lands": result["lands"],
           "cats": json.dumps(result["categories"]), "pending": pending, "popularity": popularity})
    db.commit()


def _building_response(deck_id: int, row=None, queued: bool = False) -> dict:
    if row:
        resp = _snapshot_to_response(deck_id, row)
        resp["building"] = True
        resp["queued"] = queued
        return resp
    return {"deck_id": deck_id, "building": True, "queued": queued, "total_cards": 0, "lands": 0,
            "nonland": 0, "pending_tags": 0, "popularity_score": None, "synced_at": None,
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
        tagmap, pending = _ensure_cards_present(db, cards)
        result = _compute(cards, tagmap)
        nonland_names = list({c["name"] for c in cards if c["name"] and not _is_land(c["type_line"])})
        popularity = _popularity_score(db, nonland_names)
        _save_snapshot(db, deck.id, result, pending, popularity)
        if pending:
            log.info("composition deck=%s has %s cards awaiting background tagging", deck.id, pending)
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


# ---------------------------------------------------------------------------
# Background tagger — the slow 47-search Scryfall pass, off the request path.
# ---------------------------------------------------------------------------

def _tag_pass(db: Session) -> int:
    """One patient pass: tag every untagged (oracle_tags IS NULL) card in `cards`,
    then rebuild any deck snapshots that were waiting on them. Returns the number
    of cards that gained tags. Single-flight via TAGGER_LOCK_KEY so only one pass
    runs at a time app-wide; it does NOT hold the build lock, so fast builds keep
    working while it runs. Tagging 1 card or 500 costs the same ~25 min (47 full
    Scryfall searches), so batching every untagged card into one pass amortises it.
    """
    lock_conn = db.get_bind().connect()
    if not lock_conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": TAGGER_LOCK_KEY}).scalar():
        lock_conn.close()
        return 0
    try:
        rows = db.execute(text(
            "SELECT id, oracle_id FROM cards "
            "WHERE oracle_tags IS NULL AND oracle_id IS NOT NULL")).fetchall()
        if not rows:
            return 0
        oid_to_ids: dict[str, list[str]] = {}
        for r in rows:
            oid_to_ids.setdefault(str(r.oracle_id), []).append(str(r.id))
        processed_ids = [str(r.id) for r in rows]
        log.info("tagger: pass over %s untagged cards (%s oracle ids)", len(processed_ids), len(oid_to_ids))

        # Patient 47-tag pass (long 429 backoffs). If ANY tag can't be fetched we
        # abort the whole write and retry next cycle — never mark a card 'done'
        # on partial data, which would cache wrong (empty) tags forever.
        card_tags: dict[str, set] = {}
        failed = False
        t0 = time.time()
        with httpx.Client(timeout=25, headers={"User-Agent": "MTGTracker/1.0"}) as cl:
            for tag in ORACLE_TAGS:
                url = f"https://api.scryfall.com/cards/search?q=oracletag%3A{tag}&unique=cards&order=name"
                while url:
                    resp = None
                    not_found = False
                    for attempt in range(25):
                        try:
                            resp = cl.get(url)
                        except Exception:
                            resp = None
                        if resp is not None and resp.status_code == 200:
                            break
                        if resp is not None and resp.status_code == 404:
                            not_found = True             # search matched nothing — legitimate
                            resp = None
                            break
                        time.sleep(45 if (resp is not None and resp.status_code == 429) else 5)
                    if resp is None:
                        if not_found:
                            break                        # tag has no cards, fine
                        failed = True                    # exhausted retries = incomplete pass
                        break
                    data = resp.json()
                    for c in data.get("data", []):
                        oid = str(c.get("oracle_id"))
                        for cid in oid_to_ids.get(oid, []):
                            card_tags.setdefault(cid, set()).add(tag)
                    url = data.get("next_page") if data.get("has_more") else None
                    time.sleep(0.1)
                if failed:
                    break

        if failed:
            log.warning("tagger: pass incomplete after %.0fs — leaving cards untagged, will retry", time.time() - t0)
            return 0

        # Write tags. Cards processed but matched by no tag get '{}' (tagged, none)
        # so they aren't reprocessed forever. Only touch rows still NULL, so cards
        # added mid-pass stay NULL for the next pass.
        for cid in processed_ids:
            db.execute(text("UPDATE cards SET oracle_tags = :t WHERE id = :id AND oracle_tags IS NULL"),
                       {"t": sorted(card_tags.get(cid, set())), "id": cid})
        db.commit()
        log.info("tagger: tagged %s of %s cards in %.0fs", len(card_tags), len(processed_ids), time.time() - t0)

        # Rebuild snapshots that were waiting on these tags so pending_tags clears.
        from app.models.deck import Deck
        waiting = [r.deck_id for r in db.execute(
            text("SELECT deck_id FROM deck_compositions WHERE pending_tags > 0")).fetchall()]
        for did in waiting:
            deck = db.get(Deck, did)
            if not deck:
                continue
            try:
                get_composition(db, deck, refresh=True)
                log.info("tagger: rebuilt snapshot deck=%s", did)
            except Exception as e:
                log.warning("tagger: rebuild deck=%s failed: %s", did, e)
        return len(card_tags)
    finally:
        try:
            lock_conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": TAGGER_LOCK_KEY})
        finally:
            lock_conn.close()


def run_background_tagger(poll_idle: int = 300, poll_busy: int = 30):
    """Long-lived loop (started at app startup): whenever `cards` has untagged
    rows, run one patient tag pass; otherwise idle. Idempotent and restart-safe —
    on a redeploy it simply picks up whatever is still untagged."""
    from app.database import SessionLocal
    log.info("background tagger started")
    while True:
        tagged = 0
        try:
            db = SessionLocal()
            try:
                ensure_table(db)
                tagged = _tag_pass(db)
            finally:
                db.close()
        except Exception as e:
            log.warning("background tagger error: %s", e)
        time.sleep(poll_busy if tagged else poll_idle)
