from datetime import datetime
from sqlalchemy import String, Float, Text, ARRAY, Numeric, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    set_code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    set_name: Mapped[str] = mapped_column(Text, nullable=False)
    collector_number: Mapped[str] = mapped_column(Text, nullable=False)
    rarity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    mana_cost: Mapped[str | None] = mapped_column(Text, nullable=True)
    cmc: Mapped[float | None] = mapped_column(Float, nullable=True)
    type_line: Mapped[str | None] = mapped_column(Text, nullable=True)
    oracle_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    power: Mapped[str | None] = mapped_column(Text, nullable=True)
    toughness: Mapped[str | None] = mapped_column(Text, nullable=True)
    colors: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    color_identity: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    image_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    prices_usd: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    prices_usd_foil: Mapped[float | None] = mapped_column(Numeric(10, 2), nullable=True)
    legalities: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False, default=datetime.utcnow)
