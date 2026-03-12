from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case, and_
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import GameSeat

router = APIRouter(prefix="/api/decks", tags=["decks"])


@router.get("")
def list_decks(
    owner: int | None = Query(default=None, description="Filter by builder user id"),
    colour: str | None = Query(default=None, description="Single colour e.g. W"),
    budget: str | None = Query(default=None),
    active: bool | None = Query(default=None),
    sort: str = Query(default="games", description="games | win_rate | avg_placement | cmc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
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
    if colour:
        q = q.filter(Deck.color_identity.contains([colour.upper()]))
    if budget:
        q = q.filter(Deck.budget == budget)
    if active is not None:
        q = q.filter(Deck.active == active)

    sort_map = {
        "games": func.count(GameSeat.id).desc(),
        "win_rate": (func.count(case((GameSeat.placement == 1, 1))) / func.nullif(func.count(GameSeat.id), 0)).desc(),
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
                "pilot": s.pilot.name,
                "placement": s.placement,
                "victory_condition": s.victory_condition,
            }
            for s in recent
        ],
    }
