from fastapi import APIRouter, Depends
from sqlalchemy import func, case, text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import Game, GameSeat

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    total_games = db.query(func.count(Game.id)).scalar()
    total_seats = db.query(func.count(GameSeat.id)).scalar()
    unique_commanders = db.query(func.count(Deck.id.distinct())).scalar()

    most_played_deck = (
        db.query(Deck.name, func.count(GameSeat.id).label("n"))
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, Deck.name)
        .order_by(func.count(GameSeat.id).desc())
        .first()
    )

    best_win_rate = (
        db.query(
            Deck.name,
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.count(GameSeat.id).label("games"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, Deck.name)
        .having(func.count(GameSeat.id) >= 5)
        .order_by((func.count(case((GameSeat.placement == 1, 1))) / func.count(GameSeat.id).cast(text("float"))).desc())
        .first()
    )

    return {
        "total_games": total_games,
        "total_seats": total_seats,
        "unique_decks_played": unique_commanders,
        "most_played_deck": {"name": most_played_deck.name, "games": most_played_deck.n} if most_played_deck else None,
        "best_win_rate_deck": {
            "name": best_win_rate.name,
            "win_rate": round(best_win_rate.wins / best_win_rate.games, 3),
            "games": best_win_rate.games,
        } if best_win_rate else None,
    }


@router.get("/colours")
def colour_stats(db: Session = Depends(get_db)):
    """Win rate and play rate broken down by colour identity."""
    rows = (
        db.query(
            Deck.id,
            Deck.color_identity,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id)
        .all()
    )

    colours: dict = {}
    for row in rows:
        identity = tuple(sorted(row.color_identity or []))
        key = "".join(identity) if identity else "C"
        if key not in colours:
            colours[key] = {"color_identity": list(identity) or [], "games": 0, "wins": 0}
        colours[key]["games"] += row.games
        colours[key]["wins"] += row.wins

    return [
        {
            "color_identity": v["color_identity"],
            "games": v["games"],
            "wins": v["wins"],
            "win_rate": round(v["wins"] / v["games"], 3) if v["games"] else 0,
        }
        for v in sorted(colours.values(), key=lambda x: x["games"], reverse=True)
    ]


@router.get("/matchups")
def matchup_stats(db: Session = Depends(get_db)):
    """
    For each pair of decks that have shared a game, returns how often
    deck A placed better than deck B (relative placement).
    Only includes pairs with >= 3 shared games.
    """
    # Self-join game_seats on same game_id, different deck
    a = GameSeat.__table__.alias("a")
    b = GameSeat.__table__.alias("b")

    result = db.execute(
        text("""
            SELECT
                da.name AS deck_a,
                db.name AS deck_b,
                COUNT(*) AS shared_games,
                SUM(CASE WHEN a.placement < b.placement THEN 1 ELSE 0 END) AS a_better,
                ROUND(AVG(b.placement - a.placement)::numeric, 2) AS avg_placement_diff
            FROM game_seats a
            JOIN game_seats b ON a.game_id = b.game_id AND a.deck_id < b.deck_id
            JOIN decks da ON a.deck_id = da.id
            JOIN decks db ON b.deck_id = db.id
            WHERE a.placement IS NOT NULL AND b.placement IS NOT NULL
            GROUP BY da.name, db.name
            HAVING COUNT(*) >= 3
            ORDER BY shared_games DESC, avg_placement_diff DESC
        """)
    ).fetchall()

    return [
        {
            "deck_a": r.deck_a,
            "deck_b": r.deck_b,
            "shared_games": r.shared_games,
            "deck_a_placed_better": r.a_better,
            "avg_placement_diff": float(r.avg_placement_diff),
        }
        for r in result
    ]
