from datetime import datetime
from sqlalchemy import Integer, Text, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)

    decks = relationship("Deck", back_populates="builder", foreign_keys="Deck.builder_id")
    seats = relationship("GameSeat", back_populates="pilot", foreign_keys="GameSeat.pilot_id")
