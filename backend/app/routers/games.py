from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload
from app.database import get_db
from app.models.game import Game, GameSeat
from app.models.deck import Deck
from app.models.user import User

router = APIRouter(prefix="/api/games", tags=["games"])


@router.get("")
def list_games(
    player: int | None = Query(default=None, description="Filter by pilot user id"),
    variant: str | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(Game)

    if variant:
        q = q.filter(Game.variant == variant)
    if from_date:
        q = q.filter(Game.played_at >= from_date)
    if to_date:
        q = q.filter(Game.played_at <= to_date)
    if player:
        q = q.filter(Game.seats.any(GameSeat.pilot_id == player))

    total = q.count()
    games = (
        q.options(selectinload(Game.seats).selectinload(GameSeat.deck))
        .options(selectinload(Game.seats).selectinload(GameSeat.pilot))
        .order_by(Game.played_at.desc(), Game.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "games": [_format_game(g) for g in games],
    }


@router.get("/{game_id}")
def get_game(game_id: int, db: Session = Depends(get_db)):
    game = (
        db.query(Game)
        .options(selectinload(Game.seats).selectinload(GameSeat.deck))
        .options(selectinload(Game.seats).selectinload(GameSeat.pilot))
        .filter(Game.id == game_id)
        .first()
    )
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return _format_game(game, detail=True)


@router.patch("/{game_id}")
def update_game(game_id: int, body: dict, db: Session = Depends(get_db)):
    game = db.query(Game).filter(Game.id == game_id).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if "played_at" in body:
        game.played_at = body["played_at"]
    if "notes" in body:
        game.notes = body["notes"]
    if "seats" in body:
        stranger = db.query(User).filter(User.name == "Stranger").first()
        db.query(GameSeat).filter(GameSeat.game_id == game_id).delete()
        for i, seat in enumerate(body["seats"], start=1):
            is_stranger = seat.get("is_stranger", False)
            if is_stranger:
                db.add(GameSeat(
                    game_id=game_id,
                    deck_id=None,
                    pilot_id=stranger.id if stranger else None,
                    seat=i,
                    placement=seat.get("placement"),
                    victory_condition=seat.get("victory_condition"),
                    is_archenemy=seat.get("is_archenemy", False),
                ))
                continue
            deck = db.get(Deck, seat["deck_id"])
            pilot = db.get(User, seat["pilot_id"])
            if not deck:
                raise HTTPException(status_code=404, detail=f"Deck {seat['deck_id']} not found")
            if not pilot:
                raise HTTPException(status_code=404, detail=f"Pilot {seat['pilot_id']} not found")
            db.add(GameSeat(
                game_id=game_id,
                deck_id=seat["deck_id"],
                pilot_id=seat["pilot_id"],
                seat=i,
                placement=seat.get("placement"),
                victory_condition=seat.get("victory_condition"),
                is_archenemy=seat.get("is_archenemy", False),
            ))
    db.commit()
    return {"id": game.id}


@router.post("", status_code=201)
def create_game(body: dict, db: Session = Depends(get_db)):
    """
    Body: {
      played_at: str (YYYY-MM-DD),
      variant: str,
      turn_count: int | null,
      notes: str | null,
      seats: [{ deck_id, pilot_id, placement, victory_condition, is_archenemy }]
    }
    """
    game = Game(
        played_at=body["played_at"],
        variant=body.get("variant", "Commander"),
        turn_count=body.get("turn_count"),
        total_game_time=body.get("total_game_time"),
        notes=body.get("notes"),
    )
    db.add(game)
    db.flush()

    stranger = db.query(User).filter(User.name == "Stranger").first()
    for i, seat in enumerate(body["seats"], start=1):
        is_stranger = seat.get("is_stranger", False)
        if is_stranger:
            db.add(GameSeat(
                game_id=game.id,
                deck_id=None,
                pilot_id=stranger.id if stranger else None,
                seat=i,
                placement=seat.get("placement"),
                victory_condition=seat.get("victory_condition"),
                is_archenemy=seat.get("is_archenemy", False),
                turns=seat.get("turns"),
                time_spent=seat.get("time_spent"),
            ))
            continue
        deck = db.get(Deck, seat["deck_id"])
        pilot = db.get(User, seat["pilot_id"])
        if not deck:
            raise HTTPException(status_code=404, detail=f"Deck {seat['deck_id']} not found")
        if not pilot:
            raise HTTPException(status_code=404, detail=f"Pilot {seat['pilot_id']} not found")
        db.add(GameSeat(
            game_id=game.id,
            deck_id=seat["deck_id"],
            pilot_id=seat["pilot_id"],
            seat=i,
            placement=seat.get("placement"),
            victory_condition=seat.get("victory_condition"),
            is_archenemy=seat.get("is_archenemy", False),
            turns=seat.get("turns"),
            time_spent=seat.get("time_spent"),
        ))

    db.commit()
    db.refresh(game)
    return {"id": game.id}


def _format_game(game: Game, detail: bool = False):
    seats = sorted(game.seats, key=lambda s: s.placement or 99)
    result = {
        "id": game.id,
        "played_at": game.played_at,
        "variant": game.variant,
        "turn_count": game.turn_count,
        "total_game_time": game.total_game_time,
        "seats": [
            {
                "seat": s.seat,
                "pilot": {"id": s.pilot.id, "name": s.pilot.name} if s.pilot else None,
                "deck": {"id": s.deck.id, "name": s.deck.name, "commander": s.deck.commander, "color_identity": s.deck.color_identity, "image_uri": s.deck.image_uri} if s.deck else None,
                "is_stranger": s.deck_id is None,
                "placement": s.placement,
                "victory_condition": s.victory_condition,
                "is_archenemy": s.is_archenemy,
                "turns": s.turns,
                "time_spent": s.time_spent,
            }
            for s in seats
        ],
    }
    if detail:
        result["notes"] = game.notes
    return result
