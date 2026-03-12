from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.card import Card
from app.models.collection import CollectionEntry
from app.schemas.collection import (
    CollectionEntryCreate,
    CollectionEntryUpdate,
    CollectionEntrySchema,
    CollectionStats,
)

router = APIRouter(prefix="/api/collection", tags=["collection"])


@router.get("/stats", response_model=CollectionStats)
def get_stats(db: Session = Depends(get_db)):
    total_cards = db.execute(
        select(func.sum(CollectionEntry.quantity))
    ).scalar_one() or 0

    unique_cards = db.execute(
        select(func.count(CollectionEntry.card_id.distinct()))
    ).scalar_one() or 0

    # Value: sum(quantity * prices_usd) for non-foil, sum(quantity * prices_usd_foil) for foil
    entries = db.execute(select(CollectionEntry)).scalars().all()
    total_value = Decimal("0")
    for entry in entries:
        if entry.foil and entry.card.prices_usd_foil:
            total_value += Decimal(str(entry.card.prices_usd_foil)) * entry.quantity
        elif not entry.foil and entry.card.prices_usd:
            total_value += Decimal(str(entry.card.prices_usd)) * entry.quantity

    return CollectionStats(
        total_cards=total_cards,
        unique_cards=unique_cards,
        total_value=total_value if total_value > 0 else None,
    )


@router.get("", response_model=list[CollectionEntrySchema])
def list_collection(db: Session = Depends(get_db)):
    entries = db.execute(select(CollectionEntry)).scalars().all()
    return entries


@router.post("", response_model=CollectionEntrySchema, status_code=201)
def add_to_collection(body: CollectionEntryCreate, db: Session = Depends(get_db)):
    card = db.get(Card, body.card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    entry = CollectionEntry(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.put("/{entry_id}", response_model=CollectionEntrySchema)
def update_entry(entry_id: int, body: CollectionEntryUpdate, db: Session = Depends(get_db)):
    entry = db.get(CollectionEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)

    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.get(CollectionEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    db.delete(entry)
    db.commit()
