import csv
import io
import json
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/collection", tags=["collection"])


def _card_group_to_dict(r) -> dict:
    owners = r.owners or []
    if isinstance(owners, str):
        owners = json.loads(owners)
    return {
        "card_id": str(r.card_id),
        "name": r.name,
        "mana_cost": r.mana_cost,
        "cmc": r.cmc,
        "type_line": r.type_line,
        "oracle_text": r.oracle_text,
        "colors": r.colors or [],
        "color_identity": r.color_identity or [],
        "keywords": r.keywords or [],
        "oracle_tags": r.oracle_tags or [],
        "power": r.power,
        "toughness": r.toughness,
        "rarity": r.rarity,
        "set_code": r.set_code,
        "set_name": r.set_name,
        "collector_number": r.collector_number,
        "image_uri": r.image_uri,
        "image_art_crop": r.image_art_crop,
        "back_image_uri": r.back_image_uri,
        "layout": r.layout,
        "owners": owners,
    }


@router.get("/tags")
def get_tags(owner_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    """Distinct oracle tags present in the collection (optionally filtered to one owner)."""
    if owner_id:
        rows = db.execute(text("""
            SELECT DISTINCT unnest(c.oracle_tags) AS tag
            FROM collection_entries ce
            JOIN cards c ON c.id = ce.card_id
            WHERE ce.owner_id = :owner_id
              AND c.oracle_tags IS NOT NULL
            ORDER BY tag
        """), {"owner_id": owner_id}).fetchall()
    else:
        rows = db.execute(text("""
            SELECT DISTINCT unnest(c.oracle_tags) AS tag
            FROM collection_entries ce
            JOIN cards c ON c.id = ce.card_id
            WHERE c.oracle_tags IS NOT NULL
            ORDER BY tag
        """)).fetchall()
    return {"tags": [r.tag for r in rows]}


@router.get("")
def list_collection(
    owner_id: int | None = Query(default=None),
    q: str | None = Query(default=None),
    oracle_text: str | None = Query(default=None),
    colors: str | None = Query(default=None),
    color_identity: str | None = Query(default=None),
    oracle_tags: str | None = Query(default=None),
    rarity: str | None = Query(default=None),
    type_line: str | None = Query(default=None),
    foil: bool | None = Query(default=None),
    cmc_min: float | None = Query(default=None),
    cmc_max: float | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=60, ge=1, le=200),
    db: Session = Depends(get_db),
):
    conditions = ["1=1"]
    params: dict = {}

    if owner_id:
        conditions.append("ce.owner_id = :owner_id")
        params["owner_id"] = owner_id
    if q:
        conditions.append("LOWER(c.name) LIKE LOWER(:q)")
        params["q"] = f"%{q}%"
    if oracle_text:
        conditions.append("LOWER(c.oracle_text) LIKE LOWER(:oracle_text)")
        params["oracle_text"] = f"%{oracle_text}%"
    if colors:
        for i, col in enumerate(x.strip().upper() for x in colors.split(",") if x.strip()):
            conditions.append(f":col_{i} = ANY(c.colors)")
            params[f"col_{i}"] = col
    if color_identity:
        ci_list = [x.strip().upper() for x in color_identity.split(",") if x.strip()]
        if ci_list:
            conditions.append("c.color_identity <@ :color_identity")
            params["color_identity"] = ci_list
    if oracle_tags:
        for i, tag in enumerate(x.strip() for x in oracle_tags.split(",") if x.strip()):
            conditions.append(f":tag_{i} = ANY(c.oracle_tags)")
            params[f"tag_{i}"] = tag
    if rarity:
        conditions.append("c.rarity = :rarity")
        params["rarity"] = rarity.lower()
    if type_line:
        conditions.append("LOWER(c.type_line) LIKE LOWER(:type_line)")
        params["type_line"] = f"%{type_line}%"
    if foil is not None:
        conditions.append("ce.foil = :foil")
        params["foil"] = foil
    if cmc_min is not None:
        conditions.append("c.cmc >= :cmc_min")
        params["cmc_min"] = cmc_min
    if cmc_max is not None:
        conditions.append("c.cmc <= :cmc_max")
        params["cmc_max"] = cmc_max

    where = " AND ".join(conditions)
    total = db.execute(text(f"""
        SELECT COUNT(DISTINCT c.id) FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        WHERE {where}
    """), params).scalar()

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(text(f"""
        SELECT
            c.id AS card_id,
            c.name, c.mana_cost, c.cmc, c.type_line, c.oracle_text,
            c.colors, c.color_identity, c.keywords, c.oracle_tags,
            c.power, c.toughness, c.rarity, c.set_code, c.set_name,
            c.collector_number, c.image_uri, c.image_art_crop, c.back_image_uri, c.layout,
            json_agg(json_build_object(
                'entry_id', ce.id,
                'owner_id', ce.owner_id,
                'quantity', ce.quantity,
                'foil', ce.foil,
                'condition', ce.condition,
                'language', ce.language,
                'purchase_price', ce.purchase_price::float,
                'purchase_currency', ce.purchase_currency,
                'notes', ce.notes
            ) ORDER BY ce.owner_id) AS owners
        FROM collection_entries ce
        JOIN cards c ON c.id = ce.card_id
        WHERE {where}
        GROUP BY c.id
        ORDER BY c.name
        LIMIT :limit OFFSET :offset
    """), params).fetchall()

    return {"total": total, "page": page, "page_size": page_size, "entries": [_card_group_to_dict(r) for r in rows]}


@router.post("", status_code=201)
def add_to_collection(body: dict, db: Session = Depends(get_db)):
    card_id = body.get("card_id")
    owner_id = body.get("owner_id")
    if not card_id or not owner_id:
        raise HTTPException(400, "card_id and owner_id are required")

    existing = db.execute(text("SELECT 1 FROM cards WHERE id = :id"), {"id": card_id}).fetchone()
    if not existing:
        raise HTTPException(404, "Card not found in local DB — add it first via /api/cards/from-scryfall")

    row = db.execute(text("""
        INSERT INTO collection_entries
            (card_id, owner_id, quantity, foil, condition, language,
             purchase_price, purchase_currency, notes, acquired_at)
        VALUES
            (:card_id, :owner_id, :quantity, :foil, :condition, :language,
             :purchase_price, :purchase_currency, :notes, :acquired_at)
        RETURNING id
    """), {
        "card_id": card_id,
        "owner_id": owner_id,
        "quantity": body.get("quantity", 1),
        "foil": body.get("foil", False),
        "condition": body.get("condition", "near_mint"),
        "language": body.get("language", "en"),
        "purchase_price": body.get("purchase_price"),
        "purchase_currency": body.get("purchase_currency", "EUR"),
        "notes": body.get("notes"),
        "acquired_at": body.get("acquired_at"),
    }).fetchone()
    db.commit()
    return {"entry_id": row.id, "created": True}


@router.patch("/{entry_id}")
def update_entry(entry_id: int, body: dict, db: Session = Depends(get_db)):
    existing = db.execute(text("SELECT 1 FROM collection_entries WHERE id = :id"), {"id": entry_id}).fetchone()
    if not existing:
        raise HTTPException(404, "Entry not found")

    allowed = {"quantity", "foil", "condition", "language", "purchase_price", "purchase_currency", "notes", "acquired_at"}
    updates = {k: v for k, v in body.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = entry_id
    db.execute(text(f"UPDATE collection_entries SET {set_clause} WHERE id = :id"), updates)
    db.commit()
    return {"entry_id": entry_id, "updated": True}


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    existing = db.execute(text("SELECT 1 FROM collection_entries WHERE id = :id"), {"id": entry_id}).fetchone()
    if not existing:
        raise HTTPException(404, "Entry not found")
    db.execute(text("DELETE FROM collection_entries WHERE id = :id"), {"id": entry_id})
    db.commit()


import time

LANG_MAP = {"english": "en", "french": "fr", "german": "de", "spanish": "es",
            "italian": "it", "portuguese": "pt", "japanese": "ja", "korean": "ko",
            "russian": "ru", "chinese simplified": "zhs", "chinese traditional": "zht"}

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


def _scryfall_card_to_dict(c: dict) -> dict:
    faces = c.get("card_faces", [])
    back_img = faces[1].get("image_uris", {}).get("normal") if len(faces) > 1 else None
    return {
        "id": c["id"],
        "oracle_id": c.get("oracle_id"),
        "name": c["name"],
        "mana_cost": c.get("mana_cost") or (faces[0].get("mana_cost") if faces else None),
        "cmc": c.get("cmc"),
        "type_line": c.get("type_line"),
        "oracle_text": c.get("oracle_text") or (faces[0].get("oracle_text") if faces else None),
        "colors": c.get("colors", []),
        "color_identity": c.get("color_identity", []),
        "keywords": c.get("keywords", []),
        "produced_mana": c.get("produced_mana", []),
        "oracle_tags": [],
        "power": c.get("power"),
        "toughness": c.get("toughness"),
        "rarity": c.get("rarity"),
        "set_code": c.get("set"),
        "set_name": c.get("set_name"),
        "collector_number": c.get("collector_number"),
        "image_uri": c.get("image_uris", {}).get("normal"),
        "image_art_crop": c.get("image_uris", {}).get("art_crop"),
        "back_image_uri": back_img,
        "layout": c.get("layout", "normal"),
        "legalities": c.get("legalities", {}),
    }


def _batch_resolve_scryfall(identifiers: list[dict]) -> dict:
    """
    POST to /cards/collection with up to 75 {set, collector_number} identifiers.
    Returns dict keyed by "set:collector_number" -> card dict.
    """
    BATCH = 75
    result = {}
    for i in range(0, len(identifiers), BATCH):
        batch = identifiers[i:i + BATCH]
        try:
            resp = httpx.post(
                "https://api.scryfall.com/cards/collection",
                json={"identifiers": batch},
                headers={"User-Agent": "MTGTracker/1.0"},
                timeout=20,
            )
            if resp.status_code == 200:
                for c in resp.json().get("data", []):
                    key = f"{c['set']}:{c['collector_number']}"
                    result[key] = _scryfall_card_to_dict(c)
        except Exception:
            pass
        if i + BATCH < len(identifiers):
            time.sleep(0.11)  # respect Scryfall rate limit
    return result


def _upsert_card(conn, card: dict):
    conn.execute(text("""
        INSERT INTO cards (
            id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
            colors, color_identity, keywords, produced_mana, oracle_tags,
            power, toughness, rarity, set_code, set_name, collector_number,
            image_uri, image_art_crop, back_image_uri, layout, legalities
        ) VALUES (
            :id, :oracle_id, :name, :mana_cost, :cmc, :type_line, :oracle_text,
            :colors, :color_identity, :keywords, :produced_mana, :oracle_tags,
            :power, :toughness, :rarity, :set_code, :set_name, :collector_number,
            :image_uri, :image_art_crop, :back_image_uri, :layout, CAST(:legalities AS jsonb)
        )
        ON CONFLICT (id) DO NOTHING
    """), {
        **card,
        "legalities": json.dumps(card.get("legalities") or {}),
    })


def _normalize_language(lang: str) -> str:
    if not lang:
        return "en"
    lower = lang.strip().lower()
    return LANG_MAP.get(lower, lower[:2] if len(lower) >= 2 else "en")


def _normalize_condition(cond: str) -> str:
    if not cond:
        return "near_mint"
    mapping = {
        "nm": "near_mint", "m": "near_mint", "mint": "near_mint",
        "lp": "lightly_played", "ex": "lightly_played", "excellent": "lightly_played",
        "mp": "moderately_played", "vg": "moderately_played", "good": "moderately_played",
        "hp": "heavily_played", "g": "heavily_played", "played": "heavily_played",
        "dmg": "damaged", "poor": "damaged",
    }
    lower = cond.strip().lower().replace(" ", "_")
    return mapping.get(lower, lower) or "near_mint"


def _fetch_tags_for_new_cards(new_oracle_to_card_ids: dict[str, list[str]]) -> dict[str, list[str]]:
    """
    For each oracle tag, search Scryfall and check if any newly-added cards match.
    Returns {card_id: [tag, ...]} for cards that matched at least one tag.
    Only called for cards that weren't in the DB before this import.
    """
    if not new_oracle_to_card_ids:
        return {}
    collection_oracle_ids = set(new_oracle_to_card_ids.keys())
    card_tags: dict[str, set] = {}
    with httpx.Client(timeout=20, headers={"User-Agent": "MTGTracker/1.0"}) as client:
        for tag in ORACLE_TAGS:
            url = (
                f"https://api.scryfall.com/cards/search"
                f"?q=oracletag%3A{tag}&unique=cards&order=name"
            )
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
                            for cid in new_oracle_to_card_ids[oid]:
                                card_tags.setdefault(cid, set()).add(tag)
                    url = data.get("next_page") if data.get("has_more") else None
                    if url:
                        time.sleep(0.1)
                except Exception:
                    break
            time.sleep(0.1)
    return {cid: sorted(tags) for cid, tags in card_tags.items()}


@router.post("/import")
async def import_collection(
    csv_file: UploadFile = File(...),
    owner_id: int | None = None,
    db: Session = Depends(get_db),
):
    """
    Replace the collection for the affected owner(s) from a CSV export.
    Existing entries for those owners are deleted and replaced with the CSV data.
    Supports ManaBox (Scryfall ID + Owner columns) and MTGCB (Edition + Collector Number).
    New cards are fetched from Scryfall; oracle tags are fetched inline for new cards only.
    """
    users = db.execute(text("SELECT id, name FROM users")).fetchall()
    user_map = {u.name.lower(): u.id for u in users}

    raw_csv = await csv_file.read()
    try:
        text_csv = raw_csv.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(text_csv))
        rows = list(reader)
        if not rows:
            raise HTTPException(400, "CSV is empty")
        headers = set(rows[0].keys())
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Could not parse CSV file")

    is_mtgcb = "Edition" in headers and "Scryfall ID" not in headers

    # ── 1. Resolve card data from Scryfall for cards not yet in the DB ──────

    # Collect all card identifiers we need
    if is_mtgcb:
        if not owner_id:
            raise HTTPException(400, "owner_id is required for MTGCB format (no Owner column in CSV)")
        raw_identifiers = [
            {"set": row["Edition"].strip().lower(), "collector_number": row["Collector Number"].strip()}
            for row in rows if row.get("Edition") and row.get("Collector Number")
        ]
        # Deduplicate
        seen = set()
        identifiers = []
        for ident in raw_identifiers:
            key = f"{ident['set']}:{ident['collector_number']}"
            if key not in seen:
                seen.add(key)
                identifiers.append(ident)
        scryfall_by_key = _batch_resolve_scryfall(identifiers)
        # Build a local DB fallback: set:collector_number -> card_id for cards already in DB
        local_key_to_id: dict[str, str] = {}
        if identifiers:
            for ident in identifiers:
                key = f"{ident['set']}:{ident['collector_number']}"
                if key not in scryfall_by_key:
                    # Only look up locally if Scryfall didn't return it
                    local_key_to_id[key] = None  # will fill below
            if local_key_to_id:
                resolved_local: dict[str, str] = {}
                for key in list(local_key_to_id.keys()):
                    set_code, col_num = key.split(":", 1)
                    r = db.execute(text("""
                        SELECT id FROM cards
                        WHERE LOWER(set_code) = LOWER(:set_code) AND collector_number = :col_num
                        LIMIT 1
                    """), {"set_code": set_code, "col_num": col_num}).fetchone()
                    if r:
                        resolved_local[key] = str(r.id)
                local_key_to_id = resolved_local

        # Map row → resolved card (or just scryfall_id from local DB)
        def resolve_row(row):
            edition = (row.get("Edition") or "").strip().lower()
            col_num = (row.get("Collector Number") or "").strip()
            key = f"{edition}:{col_num}"
            card = scryfall_by_key.get(key)
            if card:
                return card, card["id"]
            # Fallback: card already in local DB but Scryfall didn't return it
            local_id = local_key_to_id.get(key)
            if local_id:
                return None, local_id  # no card dict, but we have the ID
            return None, None
    else:
        all_ids = list({(row.get("Scryfall ID") or "").strip() for row in rows if row.get("Scryfall ID")})
        existing_ids = {
            str(r.id) for r in db.execute(
                text("SELECT id FROM cards WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": all_ids}
            ).fetchall()
        }
        missing_ids = [sid for sid in all_ids if sid not in existing_ids]
        scryfall_by_id: dict = {}
        BATCH = 75
        for i in range(0, len(missing_ids), BATCH):
            batch = [{"id": sid} for sid in missing_ids[i:i + BATCH]]
            try:
                resp = httpx.post(
                    "https://api.scryfall.com/cards/collection",
                    json={"identifiers": batch},
                    headers={"User-Agent": "MTGTracker/1.0"},
                    timeout=20,
                )
                if resp.status_code == 200:
                    for c in resp.json().get("data", []):
                        scryfall_by_id[c["id"]] = _scryfall_card_to_dict(c)
            except Exception:
                pass
            if i + BATCH < len(missing_ids):
                time.sleep(0.11)

    # ── 2. Upsert new cards; track which were genuinely new ─────────────────

    new_card_ids: set[str] = set()
    skipped = 0
    errors = []

    if is_mtgcb:
        for i, row in enumerate(rows):
            card, sid = resolve_row(row)
            if not sid:
                edition = (row.get("Edition") or "").strip().lower()
                col_num = (row.get("Collector Number") or "").strip()
                if edition and col_num:
                    errors.append(f"Row {i+2}: could not resolve {row.get('Name','')} ({edition} #{col_num})")
                    skipped += 1
                continue
            if card:
                existing = db.execute(text("SELECT 1 FROM cards WHERE id = CAST(:id AS uuid)"), {"id": sid}).fetchone()
                if not existing:
                    _upsert_card(db, card)
                    new_card_ids.add(sid)
    else:
        for sid, card in scryfall_by_id.items():
            _upsert_card(db, card)
            new_card_ids.add(sid)
        for sid in missing_ids:
            if sid not in scryfall_by_id:
                # Minimal stub — we'll try to find the name from any row
                name_row = next((r for r in rows if (r.get("Scryfall ID") or "").strip() == sid), None)
                if name_row:
                    db.execute(text("""
                        INSERT INTO cards (id, name, rarity, set_code, set_name, collector_number)
                        VALUES (:id, :name, :rarity, :set_code, :set_name, :collector_number)
                        ON CONFLICT (id) DO NOTHING
                    """), {
                        "id": sid,
                        "name": name_row.get("Name", "Unknown"),
                        "rarity": (name_row.get("Rarity") or "").lower(),
                        "set_code": name_row.get("Set code", ""),
                        "set_name": name_row.get("Set name", ""),
                        "collector_number": name_row.get("Collector number", ""),
                    })
                    new_card_ids.add(sid)

    db.commit()  # commit card upserts before tag fetch

    # ── 3. Fetch oracle tags for new cards only ──────────────────────────────

    tagged_cards = 0
    if new_card_ids:
        oracle_rows = db.execute(
            text("SELECT id, oracle_id FROM cards WHERE id = ANY(CAST(:ids AS uuid[])) AND oracle_id IS NOT NULL"),
            {"ids": list(new_card_ids)},
        ).fetchall()
        new_oracle_to_card_ids: dict[str, list[str]] = {}
        for r in oracle_rows:
            new_oracle_to_card_ids.setdefault(str(r.oracle_id), []).append(str(r.id))

        card_tags = _fetch_tags_for_new_cards(new_oracle_to_card_ids)
        for card_id, tags in card_tags.items():
            db.execute(
                text("UPDATE cards SET oracle_tags = :tags WHERE id = :id"),
                {"tags": tags, "id": card_id},
            )
        tagged_cards = len(card_tags)
        db.commit()

    # ── 4. Replace collection entries for affected owners ────────────────────

    # Determine which owner IDs are affected by this import
    if is_mtgcb:
        affected_owner_ids = {owner_id}
    elif owner_id:
        affected_owner_ids = {owner_id}
    else:
        affected_owner_ids = set()
        for row in rows:
            name = (row.get("Owner") or "").strip().lower()
            if name in user_map:
                affected_owner_ids.add(user_map[name])

    for oid in affected_owner_ids:
        db.execute(text("DELETE FROM collection_entries WHERE owner_id = :oid"), {"oid": oid})

    # Insert new entries
    inserted_entries = 0
    for i, row in enumerate(rows):
        if is_mtgcb:
            card, scryfall_id = resolve_row(row)
            if not scryfall_id:
                continue
            row_owner_id = owner_id
            foil = (row.get("Foil") or "").strip().lower() == "foil"
            quantity = int(row.get("Count") or 1) if str(row.get("Count", "1")).isdigit() else 1
            price_str = row.get("Purchase Price") or ""
            price = float(price_str) if price_str.strip() else None
            currency = "EUR"
            language = _normalize_language(row.get("Language") or "en")
            condition = _normalize_condition(row.get("Condition") or "")
        else:
            scryfall_id = (row.get("Scryfall ID") or "").strip()
            if not scryfall_id:
                skipped += 1
                continue
            if owner_id:
                row_owner_id = owner_id
            else:
                owner_name = (row.get("Owner") or "").strip().lower()
                if owner_name not in user_map:
                    errors.append(f"Row {i+2}: unknown owner '{row.get('Owner', '')}'")
                    skipped += 1
                    continue
                row_owner_id = user_map[owner_name]
            foil = (row.get("Foil") or "").strip().lower() == "foil"
            quantity = int(row.get("Quantity") or 1) if str(row.get("Quantity", "1")).isdigit() else 1
            price_str = row.get("Purchase price") or ""
            price = float(price_str) if price_str.strip() else None
            currency = (row.get("Purchase price currency") or "EUR").strip() or "EUR"
            condition = _normalize_condition(row.get("Condition") or "")
            language = _normalize_language(row.get("Language") or "en")

        db.execute(text("""
            INSERT INTO collection_entries
                (card_id, owner_id, quantity, foil, condition, language, purchase_price, purchase_currency)
            VALUES
                (:card_id, :owner_id, :quantity, :foil, :condition, :language, :price, :currency)
        """), {
            "card_id": scryfall_id, "owner_id": row_owner_id,
            "quantity": quantity, "foil": foil,
            "condition": condition, "language": language,
            "price": price, "currency": currency,
        })
        inserted_entries += 1
        if inserted_entries % 200 == 0:
            db.commit()

    db.commit()
    return {
        "format": "mtgcb" if is_mtgcb else "manabox",
        "cards_new": len(new_card_ids),
        "cards_tagged": tagged_cards,
        "entries_imported": inserted_entries,
        "skipped": skipped,
        "errors": errors[:20],
    }
