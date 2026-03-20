from datetime import datetime
from sqlalchemy import Text, Float, ARRAY, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Card(Base):
    __tablename__ = "cards"

    id: Mapped[str] = mapped_column(UUID(as_uuid=False), primary_key=True)
    oracle_id: Mapped[str | None] = mapped_column(UUID(as_uuid=False), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    mana_cost: Mapped[str | None] = mapped_column(Text, nullable=True)
    cmc: Mapped[float | None] = mapped_column(Float, nullable=True)
    type_line: Mapped[str | None] = mapped_column(Text, nullable=True)
    oracle_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    power: Mapped[str | None] = mapped_column(Text, nullable=True)
    toughness: Mapped[str | None] = mapped_column(Text, nullable=True)
    colors: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    color_identity: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    keywords: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    produced_mana: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    oracle_tags: Mapped[list[str] | None] = mapped_column(ARRAY(Text), nullable=True)
    rarity: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    set_code: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    set_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    collector_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_art_crop: Mapped[str | None] = mapped_column(Text, nullable=True)
    back_image_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    layout: Mapped[str | None] = mapped_column(Text, nullable=True)
    legalities: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    collection_entries = relationship("CollectionEntry", back_populates="card")
