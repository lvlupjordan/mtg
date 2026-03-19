from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, case, and_, or_, text
from sqlalchemy.orm import Session
import httpx
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import GameSeat

router = APIRouter(prefix="/api/decks", tags=["decks"])


@router.get("")
def list_decks(
    owner: int | None = Query(default=None, description="Filter by builder user id"),
    colours: str | None = Query(default=None, description="Comma-separated colours e.g. U,G,C for colorless"),
    budget: str | None = Query(default=None),
    active: bool | None = Query(default=None),
    cmc_min: float | None = Query(default=None),
    cmc_max: float | None = Query(default=None),
    search: str | None = Query(default=None),
    sort: str = Query(default="games", description="games | win_rate | avg_placement | cmc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = (
        db.query(
            Deck.id,
            Deck.name,
            Deck.commander,
            Deck.color_identity,
            Deck.commander_cmc,
            Deck.strategy,
            Deck.budget,
            Deck.active,
            User.id.label("builder_id"),
            User.name.label("builder_name"),
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(User, Deck.builder_id == User.id)
        .outerjoin(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, User.id, User.name)
    )

    if owner is not None:
        q = q.filter(Deck.builder_id == owner)
    if colours:
        color_list = [c.strip().upper() for c in colours.split(",")]
        include_colorless = "C" in color_list
        regular = [c for c in color_list if c != "C"]
        colorless_cond = text("(array_length(decks.color_identity, 1) IS NULL OR array_length(decks.color_identity, 1) = 0)")
        if include_colorless and regular:
            color_conds = and_(*[text(f":c{i} = ANY(decks.color_identity)").bindparams(**{f"c{i}": c}) for i, c in enumerate(regular)])
            q = q.filter(or_(colorless_cond, color_conds))
        elif include_colorless:
            q = q.filter(colorless_cond)
        else:
            for i, c in enumerate(regular):
                q = q.filter(text(f":c{i} = ANY(decks.color_identity)").bindparams(**{f"c{i}": c}))
    if budget:
        q = q.filter(Deck.budget == budget)
    if active is not None:
        q = q.filter(Deck.active == active)
    if cmc_min is not None:
        q = q.filter(Deck.commander_cmc >= cmc_min)
    if cmc_max is not None:
        q = q.filter(Deck.commander_cmc <= cmc_max)
    if search:
        q = q.filter(Deck.commander.ilike(f"%{search}%") | Deck.name.ilike(f"%{search}%"))

    sort_map = {
        "games": func.count(GameSeat.id).desc(),
        "win_rate": (func.count(case((GameSeat.placement == 1, 1))) / func.nullif(func.count(GameSeat.id), 0)).desc().nullslast(),
        "avg_placement": func.avg(GameSeat.placement).asc(),
        "cmc": Deck.commander_cmc.asc(),
    }
    q = q.order_by(sort_map.get(sort, func.count(GameSeat.id).desc()))

    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "decks": [
            {
                "id": d.id,
                "name": d.name,
                "commander": d.commander,
                "color_identity": d.color_identity,
                "commander_cmc": d.commander_cmc,
                "strategy": d.strategy,
                "budget": d.budget,
                "active": d.active,
                "image_uri": db.get(Deck, d.id).image_uri,
                "builder": {"id": d.builder_id, "name": d.builder_name},
                "games": d.games,
                "wins": d.wins,
                "win_rate": round(d.wins / d.games, 3) if d.games else 0,
                "avg_placement": round(float(d.avg_placement), 2) if d.avg_placement else None,
            }
            for d in rows
        ],
    }


@router.get("/{deck_id}")
def get_deck(deck_id: int, db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    stats = (
        db.query(
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .filter(GameSeat.deck_id == deck_id)
        .one()
    )

    # Pilots who have played this deck
    pilot_rows = (
        db.query(
            User.id,
            User.name,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
        )
        .join(GameSeat, GameSeat.pilot_id == User.id)
        .filter(GameSeat.deck_id == deck_id)
        .group_by(User.id, User.name)
        .order_by(func.count(GameSeat.id).desc())
        .all()
    )

    # Recent games
    recent = (
        db.query(GameSeat)
        .filter(GameSeat.deck_id == deck_id)
        .join(GameSeat.game)
        .order_by(GameSeat.game_id.desc())
        .limit(10)
        .all()
    )

    builder = db.get(User, deck.builder_id)

    return {
        "id": deck.id,
        "name": deck.name,
        "commander": deck.commander,
        "color_identity": deck.color_identity,
        "commander_cmc": deck.commander_cmc,
        "strategy": deck.strategy,
        "budget": deck.budget,
        "active": deck.active,
        "image_uri": deck.image_uri,
        "builder": {"id": builder.id, "name": builder.name},
        "games": stats.games,
        "wins": stats.wins,
        "win_rate": round(stats.wins / stats.games, 3) if stats.games else 0,
        "avg_placement": round(float(stats.avg_placement), 2) if stats.avg_placement else None,
        "pilots": [
            {
                "id": p.id,
                "name": p.name,
                "games": p.games,
                "wins": p.wins,
                "win_rate": round(p.wins / p.games, 3) if p.games else 0,
            }
            for p in pilot_rows
        ],
        "recent_games": [
            {
                "game_id": s.game_id,
                "played_at": s.game.played_at,
                "pilot": s.pilot.name if s.pilot else None,
                "placement": s.placement,
                "victory_condition": s.victory_condition,
                "opponents": [
                    {
                        "deck_id": other.deck_id,
                        "commander": other.deck.commander if other.deck else None,
                        "pilot": other.pilot.name if other.pilot else None,
                        "placement": other.placement,
                    }
                    for other in sorted(s.game.seats, key=lambda x: x.placement or 99)
                    if other.deck_id != deck_id
                ],
            }
            for s in recent
        ],
    }


@router.patch("/{deck_id}")
def update_deck(deck_id: int, payload: dict, db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    if "active" in payload:
        deck.active = bool(payload["active"])
    if "name" in payload:
        deck.name = payload["name"]
    if "commander" in payload:
        commander_changed = payload["commander"] != deck.commander
        deck.commander = payload["commander"]
        if commander_changed:
            deck.image_uri = _fetch_scryfall_image(payload["commander"])
    if "color_identity" in payload:
        deck.color_identity = [c.upper() for c in payload["color_identity"]]
    if "commander_cmc" in payload:
        deck.commander_cmc = payload["commander_cmc"]
    if "strategy" in payload:
        deck.strategy = payload["strategy"]
    if "budget" in payload:
        deck.budget = payload["budget"]
    if "builder_id" in payload:
        builder = db.get(User, payload["builder_id"])
        if not builder:
            raise HTTPException(status_code=404, detail="Builder not found")
        deck.builder_id = payload["builder_id"]
    if "notes" in payload:
        deck.notes = payload["notes"]
    db.commit()
    db.refresh(deck)
    return {"id": deck.id, "active": deck.active, "name": deck.name, "commander": deck.commander, "image_uri": deck.image_uri}


class DeckCreate(BaseModel):
    commander: str
    name: str | None = None
    builder_id: int
    color_identity: list[str]
    commander_cmc: float | None = None
    strategy: list[str] = []
    budget: str | None = None
    notes: str | None = None
    active: bool = True


def _fetch_scryfall_image(commander: str) -> str | None:
    search_name = commander.split(" //")[0].strip()
    try:
        r = httpx.get(
            "https://api.scryfall.com/cards/named",
            params={"fuzzy": search_name},
            timeout=10,
        )
        if r.status_code == 200:
            card = r.json()
            if "card_faces" in card and "image_uris" in card["card_faces"][0]:
                return card["card_faces"][0]["image_uris"].get("normal")
            return card.get("image_uris", {}).get("normal")
    except Exception:
        pass
    return None


@router.post("")
def create_deck(deck: DeckCreate, db: Session = Depends(get_db)):
    builder = db.get(User, deck.builder_id)
    if not builder:
        raise HTTPException(status_code=404, detail="Builder not found")

    image_uri = _fetch_scryfall_image(deck.commander)

    new_deck = Deck(
        name=deck.name or deck.commander,
        commander=deck.commander,
        builder_id=deck.builder_id,
        color_identity=[c.upper() for c in deck.color_identity],
        commander_cmc=deck.commander_cmc,
        strategy=deck.strategy,
        budget=deck.budget,
        notes=deck.notes,
        active=deck.active,
        image_uri=image_uri,
        created_at=datetime.utcnow(),
    )
    db.add(new_deck)
    db.commit()
    db.refresh(new_deck)
    return {
        "id": new_deck.id,
        "name": new_deck.name,
        "commander": new_deck.commander,
        "image_uri": new_deck.image_uri,
    }
