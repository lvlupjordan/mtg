from datetime import date
from decimal import Decimal
from pydantic import BaseModel, Field
from app.schemas.card import CardSchema


class CollectionEntryCreate(BaseModel):
    card_id: str
    quantity: int = Field(default=1, ge=1)
    foil: bool = False
    condition: str = Field(default="NM", pattern="^(NM|LP|MP|HP|DMG)$")
    language: str = "en"
    notes: str | None = None
    acquired_at: date | None = None
    acquired_price: Decimal | None = None


class CollectionEntryUpdate(BaseModel):
    quantity: int | None = Field(default=None, ge=1)
    foil: bool | None = None
    condition: str | None = Field(default=None, pattern="^(NM|LP|MP|HP|DMG)$")
    language: str | None = None
    notes: str | None = None
    acquired_at: date | None = None
    acquired_price: Decimal | None = None


class CollectionEntrySchema(BaseModel):
    id: int
    card_id: str
    quantity: int
    foil: bool
    condition: str
    language: str
    notes: str | None
    acquired_at: date | None
    acquired_price: Decimal | None
    card: CardSchema

    model_config = {"from_attributes": True}


class CollectionStats(BaseModel):
    total_cards: int
    unique_cards: int
    total_value: Decimal | None
