from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel


class CardSchema(BaseModel):
    id: str
    name: str
    set_code: str
    set_name: str
    collector_number: str
    rarity: str
    mana_cost: str | None
    cmc: float | None
    type_line: str | None
    oracle_text: str | None
    power: str | None
    toughness: str | None
    colors: list[str] | None
    color_identity: list[str] | None
    image_uri: str | None
    prices_usd: Decimal | None
    prices_usd_foil: Decimal | None
    legalities: dict | None
    updated_at: datetime

    model_config = {"from_attributes": True}


class CardListResponse(BaseModel):
    cards: list[CardSchema]
    total: int
    page: int
    page_size: int
