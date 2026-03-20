"""
Fetches oracle tags from Scryfall for all cards in the DB that have no tags yet.
Run once to backfill after the UUID string/object bug fix.

DATABASE_URL="<prod_url>" python backend/scripts/tag_existing_cards.py
"""
import os, time
import httpx
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)

ORACLE_TAGS = [
    "card-advantage", "removal", "board-wipe", "spot-removal",
    "ramp", "mana-dork", "draw", "tutor", "counterspell",
    "lifegain", "life-drain", "burn", "token-maker",
    "recursion", "reanimation", "mill", "sacrifice-outlet",
    "blink", "etb", "evasion", "pump", "anthem",
    "discard", "stax", "tax", "protection", "haste-enabler",
    "land-destruction", "graveyard-hate", "combat-trick",
    "cantrip", "treasure-maker", "impulse-draw", "looting",
    "bounce", "copy", "modal", "landfall", "proliferate",
    "equipment", "aura", "finisher", "self-mill", "aristocrats",
    "mana-fixing", "fetch-land", "extra-turn",
]

with engine.connect() as conn:
    rows = conn.execute(text(
        "SELECT id, oracle_id FROM cards WHERE oracle_id IS NOT NULL"
    )).fetchall()

print(f"Found {len(rows)} cards with oracle_id")

oracle_to_card_ids: dict[str, list[str]] = {}
for r in rows:
    oracle_to_card_ids.setdefault(str(r.oracle_id), []).append(str(r.id))

collection_oracle_ids = set(oracle_to_card_ids.keys())
card_tags: dict[str, set] = {}

with httpx.Client(timeout=20, headers={"User-Agent": "MTGTracker/1.0"}) as client:
    for i, tag in enumerate(ORACLE_TAGS):
        print(f"[{i+1}/{len(ORACLE_TAGS)}] Fetching oracletag:{tag}…", end=" ", flush=True)
        url = f"https://api.scryfall.com/cards/search?q=oracletag%3A{tag}&unique=cards&order=name"
        matched = 0
        while url:
            try:
                resp = client.get(url)
                if resp.status_code == 404:
                    break
                if resp.status_code != 200:
                    break
                data = resp.json()
                for card in data.get("data", []):
                    oid = card.get("oracle_id")
                    if oid and oid in collection_oracle_ids:
                        for cid in oracle_to_card_ids[oid]:
                            card_tags.setdefault(cid, set()).add(tag)
                        matched += 1
                url = data.get("next_page") if data.get("has_more") else None
                if url:
                    time.sleep(0.1)
            except Exception as e:
                print(f"error: {e}")
                break
        print(f"{matched} matched")
        time.sleep(0.1)

print(f"\nTagging {len(card_tags)} cards…")
with engine.connect() as conn:
    for card_id, tags in card_tags.items():
        conn.execute(
            text("UPDATE cards SET oracle_tags = :tags WHERE id = CAST(:id AS uuid)"),
            {"tags": sorted(tags), "id": card_id},
        )
    conn.commit()

print(f"Done. {len(card_tags)} cards tagged.")
