from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, case
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import GameSeat

router = APIRouter(prefix="/api/players", tags=["players"])

EXCLUDED = ["Random", "Precon"]


def _colour_win_rates(deck_rows):
    """Aggregate games/wins/avg_placement by colour identity from a list of deck stat rows."""
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
        "games": d.games,
        "wins": d.wins,
        "win_rate": round(d.wins / d.games, 3) if d.games else 0,
        "avg_placement": round(float(d.avg_placement), 2) if d.avg_placement else None,
    }


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
        "pilot": {
            "games": pilot.games,
            "wins": pilot.wins,
            "win_rate": round(pilot.wins / pilot.games, 3) if pilot.games else 0,
            "avg_placement": round(float(pilot.avg_placement), 2) if pilot.avg_placement else None,
            "by_colour": _colour_win_rates(deck_rows),
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
        "by_colour": _colour_win_rates(deck_rows),
        "by_deck": [
            {
                **_fmt_deck(d),
                "budget": d.budget,
                "strategy": d.strategy,
            }
            for d in deck_rows
        ],
    }
