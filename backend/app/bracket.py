"""Commander bracket compute — in the request path, on deck refresh.

Runs the vendored scrollvault engine (``bracket_engine/``) as a short Node
subprocess on OUR card data plus Commander Spellbook combos. No Scryfall, no
live scrollvault (land-legality is served from disk). Validated 21/21 against
scrollvault; this is the same engine the offline batch used, lifted onto the
build path so a deck's bracket recomputes alongside its composition.

Gated on a decklist hash: an unchanged deck skips both the Commander Spellbook
calls and Node entirely, so refreshes are cheap and CS is only hit when a list
actually changes. Best-effort — on any failure the deck keeps its last bracket.
"""
import os
import re
import json
import time
import hashlib
import logging
import subprocess

import httpx
from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("composition.bracket")

_ENGINE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "bracket_engine")
_RUN = os.path.join(_ENGINE_DIR, "run.cjs")
_NODE = os.getenv("NODE_BIN", "node")
_CS = "https://backend.commanderspellbook.com/"

# A deck cares about toughness-as-damage if it runs an enabler like Doran; the
# engine then treats each creature's power as max(power, toughness).
_TOUGH = re.compile(
    r"combat damage equal to (its|their) toughness"
    r"|assigns? combat damage.*equal to.*toughness", re.I)

# The card fields the engine reads (mirrors the offline batch's prep step).
_CARD_SQL = text("""
    SELECT DISTINCT ON (name)
        name, type_line, oracle_text, cmc, power, toughness, keywords, colors,
        color_identity, mana_cost, produced_mana, rarity, edhrec_rank, legalities, layout
    FROM cards WHERE name = ANY(:ns)
""")


def _list_hash(entries: list[dict], commanders: list[str]) -> str:
    """Stable hash of a decklist (card names + counts + commanders). Changes iff
    the list changes, so we can skip recompute (and the CS calls) when it hasn't."""
    body = "|".join(sorted(f"{e['count']} {e['name']}" for e in entries))
    return hashlib.sha1((body + "#" + "|".join(sorted(commanders))).encode()).hexdigest()


def _cs_call(endpoint: str, commanders: list[str], main: list[dict]) -> dict:
    payload = {
        "commanders": [{"card": n, "quantity": 1} for n in commanders],
        "main": [{"card": m["name"], "quantity": m["count"]} for m in main],
    }
    r = httpx.post(_CS + endpoint, json=payload,
                   headers={"User-Agent": "Mozilla/5.0"}, timeout=45)
    r.raise_for_status()
    return r.json()


def available() -> bool:
    """True if the engine is present (its Node deps are installed in the image)."""
    return os.path.exists(_RUN)


def compute_and_store(db: Session, deck_id: int, entries: list[dict],
                      commanders: list[str], mox_bracket, commander_name: str = "") -> bool:
    """Recompute and store bracket/power/goldfish_clock/bracket_detail for a deck.

    ``entries`` is the full list ([{name, count}] for mainboard + commanders);
    ``commanders`` the commander name(s). Returns True if a fresh value was
    written, False if skipped (unchanged) or the compute failed. Never raises for
    an expected failure (CS down, Node error, timeout) — the deck keeps its last
    bracket and the hash is left so the next refresh retries.
    """
    if not available():
        return False

    h = _list_hash(entries, commanders)
    row = db.execute(text("SELECT bracket_hash, bracket FROM deck_compositions WHERE deck_id = :id"),
                     {"id": deck_id}).fetchone()
    if row and row.bracket_hash == h and row.bracket is not None:
        return False  # decklist unchanged since last compute — skip CS + Node

    t0 = time.time()
    cmd_set = set(commanders)
    names = [e["name"] for e in entries]
    rows = db.execute(_CARD_SQL, {"ns": names}).fetchall()
    tough = any(_TOUGH.search(r.oracle_text or "") for r in rows)
    main = [e for e in entries if e["name"] not in cmd_set]

    # Commander Spellbook — only reached when the list changed / first time.
    try:
        est = _cs_call("estimate-bracket", commanders, main)
        time.sleep(1.0)  # gentle: two calls back-to-back
        combos = _cs_call("find-my-combos", commanders, main)
    except Exception as e:
        log.warning("bracket: Commander Spellbook unavailable deck=%s: %s", deck_id, e)
        return False

    gc = {c["card"]["name"] for c in est.get("cards", []) if c.get("gameChanger")}
    raw = {r.name: {
        "name": r.name, "type_line": r.type_line, "oracle_text": r.oracle_text,
        "cmc": float(r.cmc) if r.cmc is not None else 0, "power": r.power, "toughness": r.toughness,
        "keywords": r.keywords or [], "colors": r.colors or [], "color_identity": r.color_identity or [],
        "mana_cost": r.mana_cost, "produced_mana": r.produced_mana or [], "rarity": r.rarity,
        "edhrec_rank": r.edhrec_rank, "legalities": r.legalities or {}, "layout": r.layout,
        "game_changer": r.name in gc,
    } for r in rows}

    payload = {
        "name": commander_name, "entries": entries,
        "commander": commanders[0] if commanders else "", "commanders": commanders,
        "raw": raw, "est": est, "combos": combos,
        "tough_matters": tough, "mox_bracket": mox_bracket,
    }

    try:
        proc = subprocess.run([_NODE, _RUN], input=json.dumps(payload),
                              capture_output=True, text=True, timeout=90, cwd=_ENGINE_DIR)
    except Exception as e:
        log.warning("bracket: Node run failed deck=%s: %s", deck_id, e)
        return False

    result = None
    if proc.stdout.strip():
        try:
            result = json.loads(proc.stdout)
        except json.JSONDecodeError:
            result = None
    if not result or result.get("bracket") is None:
        log.warning("bracket: no result deck=%s rc=%s err=%s", deck_id, proc.returncode, (proc.stderr or "")[:200])
        return False

    detail = result.get("detail") or {}
    # Enrich the breakdown with card images (name -> image_uri) for the FE.
    img_names = list(detail.get("gameChangers", [])) + list(detail.get("altWins", []))
    for c in detail.get("combos", []):
        img_names += c.get("cards", [])
    if img_names:
        imgs = db.execute(text("SELECT DISTINCT ON (name) name, image_uri FROM cards WHERE name = ANY(:ns)"),
                          {"ns": sorted(set(img_names))}).fetchall()
        detail["images"] = {r.name: r.image_uri for r in imgs if r.image_uri}

    db.execute(text("""
        UPDATE deck_compositions SET bracket = :b, power = :p, goldfish_clock = :c,
            bracket_detail = CAST(:d AS jsonb), bracket_hash = :h
        WHERE deck_id = :id
    """), {"b": result.get("bracket"), "p": result.get("power"), "c": result.get("clock"),
           "d": json.dumps(detail), "h": h, "id": deck_id})
    db.commit()
    log.info("bracket compute done deck=%s B%s pow=%s T%s in %.1fs",
             deck_id, result.get("bracket"), result.get("power"), result.get("clock"), time.time() - t0)
    return True
