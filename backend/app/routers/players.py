from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, case
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import GameSeat

router = APIRouter(prefix="/api/players", tags=["players"])

EXCLUDED = ["Random", "Precon"]


COLOUR_ORDER = ["W", "U", "B", "R", "G"]


def _atomic_colour_win_rates(deck_rows):
    """Break down by individual pip — a UBG deck counts towards U, B, and G separately."""
    buckets: dict = {c: {"games": 0, "wins": 0, "total_placement": 0.0} for c in COLOUR_ORDER}
    for d in deck_rows:
        for c in (d.color_identity or []):
            if c in buckets:
                buckets[c]["games"] += d.games
                buckets[c]["wins"] += d.wins
                buckets[c]["total_placement"] += (float(d.avg_placement) * d.games) if d.avg_placement else 0
    return [
        {
            "colour": c,
            "games": v["games"],
            "wins": v["wins"],
            "win_rate": round(v["wins"] / v["games"], 3) if v["games"] else 0,
            "avg_placement": round(v["total_placement"] / v["games"], 2) if v["games"] else None,
        }
        for c, v in buckets.items() if v["games"] > 0
    ]


def _identity_win_rates(deck_rows):
    """Aggregate games/wins/avg_placement by full colour identity."""
    colours: dict = {}
    for d in deck_rows:
        key = tuple(sorted(d.color_identity or []))
        label = "".join(key) or "C"
        if label not in colours:
            colours[label] = {"color_identity": list(key), "games": 0, "wins": 0, "total_placement": 0.0}
        colours[label]["games"] += d.games
        colours[label]["wins"] += d.wins
        colours[label]["total_placement"] += (float(d.avg_placement) * d.games) if d.avg_placement else 0
    return [
        {
            "color_identity": v["color_identity"],
            "games": v["games"],
            "wins": v["wins"],
            "win_rate": round(v["wins"] / v["games"], 3) if v["games"] else 0,
            "avg_placement": round(v["total_placement"] / v["games"], 2) if v["games"] else None,
        }
        for v in sorted(colours.values(), key=lambda x: x["games"], reverse=True)
    ]


def _fmt_deck(d):
    return {
        "id": d.id,
        "name": d.name,
        "commander": d.commander,
        "color_identity": d.color_identity,
        "active": d.active,
        "image_uri": d.image_uri,
        "games": d.games,
        "wins": d.wins,
        "win_rate": round(d.wins / d.games, 3) if d.games else 0,
        "avg_placement": round(float(d.avg_placement), 2) if d.avg_placement else None,
    }


@router.post("")
def create_player(payload: dict, db: Session = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    if db.query(User).filter(User.name == name).first():
        raise HTTPException(status_code=409, detail="Player already exists")
    user = User(
        name=name,
        created_at=datetime.utcnow(),
        show_as_brewer=payload.get("show_as_brewer", True),
        include_in_data=payload.get("include_in_data", True),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "name": user.name, "show_as_brewer": user.show_as_brewer, "include_in_data": user.include_in_data}


@router.patch("/{player_id}")
def patch_player(player_id: int, payload: dict, db: Session = Depends(get_db)):
    user = db.get(User, player_id)
    if not user:
        raise HTTPException(status_code=404, detail="Player not found")
    if "name" in payload:
        name = (payload["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name is required")
        existing = db.query(User).filter(User.name == name, User.id != player_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="Player already exists")
        user.name = name
    if "show_as_brewer" in payload:
        user.show_as_brewer = bool(payload["show_as_brewer"])
    if "include_in_data" in payload:
        user.include_in_data = bool(payload["include_in_data"])
    db.commit()
    db.refresh(user)
    return {"id": user.id, "name": user.name, "show_as_brewer": user.show_as_brewer, "include_in_data": user.include_in_data}


@router.get("")
def list_players(db: Session = Depends(get_db)):
    rows = (
        db.query(
            User.id,
            User.name,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(GameSeat, GameSeat.pilot_id == User.id)
        .filter(User.name.notin_(EXCLUDED))
        .group_by(User.id, User.name)
        .order_by(func.count(GameSeat.id).desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "name": r.name,
            "games": r.games,
            "wins": r.wins,
            "win_rate": round(r.wins / r.games, 3) if r.games else 0,
            "avg_placement": round(float(r.avg_placement), 2) if r.avg_placement else None,
        }
        for r in rows
    ]


@router.get("/{player_id}")
def get_player(player_id: int, db: Session = Depends(get_db)):
    user = db.get(User, player_id)
    if not user:
        raise HTTPException(status_code=404, detail="Player not found")

    # Overall pilot stats
    pilot = (
        db.query(
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .filter(GameSeat.pilot_id == player_id)
        .one()
    )

    # Overall brewer stats (decks they built, played by anyone)
    brewer = (
        db.query(
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(Deck, GameSeat.deck_id == Deck.id)
        .filter(Deck.builder_id == player_id)
        .one()
    )

    # Per-deck pilot stats
    deck_rows = (
        db.query(
            Deck.id,
            Deck.name,
            Deck.commander,
            Deck.color_identity,
            Deck.active,
            Deck.image_uri,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .filter(GameSeat.pilot_id == player_id)
        .group_by(Deck.id)
        .order_by(func.count(GameSeat.id).desc())
        .all()
    )

    return {
        "id": user.id,
        "name": user.name,
        "show_as_brewer": user.show_as_brewer,
        "include_in_data": user.include_in_data,
        "pilot": {
            "games": pilot.games,
            "wins": pilot.wins,
            "win_rate": round(pilot.wins / pilot.games, 3) if pilot.games else 0,
            "avg_placement": round(float(pilot.avg_placement), 2) if pilot.avg_placement else None,
            "by_colour": _atomic_colour_win_rates(deck_rows),
            "by_identity": _identity_win_rates(deck_rows),
            "by_deck": [_fmt_deck(d) for d in deck_rows],
        },
        "brewer": {
            "games": brewer.games,
            "wins": brewer.wins,
            "win_rate": round(brewer.wins / brewer.games, 3) if brewer.games else 0,
            "avg_placement": round(float(brewer.avg_placement), 2) if brewer.avg_placement else None,
        },
    }


@router.get("/{player_id}/brewer")
def get_brewer_stats(player_id: int, db: Session = Depends(get_db)):
    user = db.get(User, player_id)
    if not user:
        raise HTTPException(status_code=404, detail="Player not found")

    deck_rows = (
        db.query(
            Deck.id,
            Deck.name,
            Deck.commander,
            Deck.color_identity,
            Deck.budget,
            Deck.strategy,
            Deck.active,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .filter(Deck.builder_id == player_id)
        .group_by(Deck.id)
        .order_by(func.count(GameSeat.id).desc())
        .all()
    )

    return {
        "id": user.id,
        "name": user.name,
        "by_colour": _atomic_colour_win_rates(deck_rows),
        "by_identity": _identity_win_rates(deck_rows),
        "by_deck": [
            {
                **_fmt_deck(d),
                "budget": d.budget,
                "strategy": d.strategy,
            }
            for d in deck_rows
        ],
    }
