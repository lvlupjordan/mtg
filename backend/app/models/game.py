from datetime import datetime
from sqlalchemy import Integer, Text, Boolean, Float, TIMESTAMP, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    played_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)
    turn_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_game_time: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    variant: Mapped[str] = mapped_column(Text, nullable=False, default="Commander")
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)

    seats = relationship("GameSeat", back_populates="game", order_by="GameSeat.seat")


class GameSeat(Base):
    __tablename__ = "game_seats"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_id: Mapped[int] = mapped_column(Integer, ForeignKey("games.id"), nullable=False)
    deck_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("decks.id"), nullable=True)
    pilot_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    seat: Mapped[int] = mapped_column(Integer, nullable=False)
    placement: Mapped[float | None] = mapped_column(Float, nullable=True)
    victory_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_archenemy: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    eliminated_on_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    turns: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_spent: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds

    game = relationship("Game", back_populates="seats")
    deck = relationship("Deck", back_populates="seats")
    pilot = relationship("User", back_populates="seats", foreign_keys=[pilot_id])
