import httpx
import json
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/cards", tags=["cards"])


def _row_to_dict(r) -> dict:
    return {
        "id": str(r.id),
        "name": r.name,
        "mana_cost": r.mana_cost,
        "cmc": r.cmc,
        "type_line": r.type_line,
        "oracle_text": r.oracle_text,
        "colors": r.colors or [],
        "color_identity": r.color_identity or [],
        "keywords": r.keywords or [],
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
        "oracle_tags": r.oracle_tags or [],
    }


@router.get("/scryfall")
async def search_scryfall(q: str = Query(..., min_length=2)):
    """Proxy to Scryfall — used when adding a card not yet in the local DB."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.scryfall.com/cards/search",
            params={"q": q, "unique": "prints", "order": "released", "dir": "desc"},
            headers={"User-Agent": "MTGTracker/1.0"},
        )
        if resp.status_code != 200:
            return {"cards": []}
        data = resp.json()
        cards = []
        for c in data.get("data", [])[:24]:
            faces = c.get("card_faces", [])
            back_img = faces[1].get("image_uris", {}).get("normal") if len(faces) > 1 else None
            cards.append({
                "id": c["id"],
                "name": c["name"],
                "mana_cost": c.get("mana_cost") or (faces[0].get("mana_cost") if faces else None),
                "cmc": c.get("cmc"),
                "type_line": c.get("type_line"),
                "oracle_text": c.get("oracle_text") or (faces[0].get("oracle_text") if faces else None),
                "colors": c.get("colors", []),
                "color_identity": c.get("color_identity", []),
                "keywords": c.get("keywords", []),
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
                "oracle_tags": [],
            })
        return {"cards": cards}


@router.post("/from-scryfall")
def add_card_from_scryfall(body: dict, db: Session = Depends(get_db)):
    """Upsert a Scryfall card into the local cards table (no oracle tags yet)."""
    card_id = body.get("id")
    if not card_id:
        raise HTTPException(400, "Missing card id")

    existing = db.execute(text("SELECT 1 FROM cards WHERE id = :id"), {"id": card_id}).fetchone()
    if existing:
        return {"id": card_id, "created": False}

    db.execute(text("""
        INSERT INTO cards (
            id, name, mana_cost, cmc, type_line, oracle_text,
            colors, color_identity, keywords, power, toughness,
            rarity, set_code, set_name, collector_number,
            image_uri, image_art_crop, back_image_uri, layout
        ) VALUES (
            :id, :name, :mana_cost, :cmc, :type_line, :oracle_text,
            :colors, :color_identity, :keywords, :power, :toughness,
            :rarity, :set_code, :set_name, :collector_number,
            :image_uri, :image_art_crop, :back_image_uri, :layout
        )
    """), {
        "id": card_id,
        "name": body.get("name", ""),
        "mana_cost": body.get("mana_cost"),
        "cmc": body.get("cmc"),
        "type_line": body.get("type_line"),
        "oracle_text": body.get("oracle_text"),
        "colors": body.get("colors", []),
        "color_identity": body.get("color_identity", []),
        "keywords": body.get("keywords", []),
        "power": body.get("power"),
        "toughness": body.get("toughness"),
        "rarity": body.get("rarity"),
        "set_code": body.get("set_code"),
        "set_name": body.get("set_name"),
        "collector_number": body.get("collector_number"),
        "image_uri": body.get("image_uri"),
        "image_art_crop": body.get("image_art_crop"),
        "back_image_uri": body.get("back_image_uri"),
        "layout": body.get("layout", "normal"),
    })
    db.commit()
    return {"id": card_id, "created": True}


@router.get("")
def search_cards(
    q: str | None = Query(default=None),
    colors: str | None = Query(default=None),
    oracle_tags: str | None = Query(default=None),
    rarity: str | None = Query(default=None),
    type_line: str | None = Query(default=None),
    set_code: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=60, ge=1, le=200),
    db: Session = Depends(get_db),
):
    conditions = ["1=1"]
    params: dict = {}

    if q:
        conditions.append("LOWER(c.name) LIKE LOWER(:q)")
        params["q"] = f"%{q}%"
    if colors:
        for i, col in enumerate(x.strip().upper() for x in colors.split(",") if x.strip()):
            conditions.append(f":col_{i} = ANY(c.colors)")
            params[f"col_{i}"] = col
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
    if set_code:
        conditions.append("LOWER(c.set_code) = LOWER(:set_code)")
        params["set_code"] = set_code.lower()

    where = " AND ".join(conditions)
    total = db.execute(text(f"SELECT COUNT(*) FROM cards c WHERE {where}"), params).scalar()

    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size
    rows = db.execute(text(f"""
        SELECT c.id, c.name, c.mana_cost, c.cmc, c.type_line, c.oracle_text,
               c.colors, c.color_identity, c.keywords, c.power, c.toughness,
               c.rarity, c.set_code, c.set_name, c.collector_number,
               c.image_uri, c.image_art_crop, c.back_image_uri, c.layout, c.oracle_tags
        FROM cards c WHERE {where}
        ORDER BY c.name
        LIMIT :limit OFFSET :offset
    """), params).fetchall()

    return {"total": total, "page": page, "page_size": page_size, "cards": [_row_to_dict(r) for r in rows]}


@router.get("/{card_id}")
def get_card(card_id: str, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT c.id, c.name, c.mana_cost, c.cmc, c.type_line, c.oracle_text,
               c.colors, c.color_identity, c.keywords, c.power, c.toughness,
               c.rarity, c.set_code, c.set_name, c.collector_number,
               c.image_uri, c.image_art_crop, c.back_image_uri, c.layout, c.oracle_tags
        FROM cards c WHERE c.id = :id
    """), {"id": card_id}).fetchone()
    if not row:
        raise HTTPException(404, "Card not found")
    return _row_to_dict(row)


