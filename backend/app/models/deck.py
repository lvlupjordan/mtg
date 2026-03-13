from datetime import datetime
from sqlalchemy import Integer, Text, Float, Boolean, ARRAY, TIMESTAMP, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Deck(Base):
    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    commander: Mapped[str] = mapped_column(Text, nullable=False)
    builder_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    color_identity: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    commander_cmc: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    strategy: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    budget: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    image_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)

    builder = relationship("User", back_populates="decks", foreign_keys=[builder_id])
    seats = relationship("GameSeat", back_populates="deck")
