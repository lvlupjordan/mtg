from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.card import Card
from app.schemas.card import CardSchema, CardListResponse

router = APIRouter(prefix="/api/cards", tags=["cards"])

PAGE_SIZE = 48


@router.get("", response_model=CardListResponse)
def search_cards(
    q: str | None = Query(default=None),
    set: str | None = Query(default=None),
    colors: str | None = Query(default=None, description="Comma-separated colors e.g. W,U"),
    rarity: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    db: Session = Depends(get_db),
):
    stmt = select(Card)

    if q:
        stmt = stmt.where(Card.name.ilike(f"%{q}%"))
    if set:
        stmt = stmt.where(Card.set_code == set.lower())
    if rarity:
        stmt = stmt.where(Card.rarity == rarity.lower())
    if colors:
        color_list = [c.strip().upper() for c in colors.split(",")]
        for color in color_list:
            stmt = stmt.where(Card.colors.contains([color]))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = db.execute(count_stmt).scalar_one()

    stmt = stmt.order_by(Card.name).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)
    cards = db.execute(stmt).scalars().all()

    return CardListResponse(cards=cards, total=total, page=page, page_size=PAGE_SIZE)


@router.get("/{card_id}", response_model=CardSchema)
def get_card(card_id: str, db: Session = Depends(get_db)):
    card = db.get(Card, card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card
