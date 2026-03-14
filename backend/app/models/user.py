from datetime import datetime
from sqlalchemy import Integer, Text, TIMESTAMP, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False)
    show_as_brewer: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    include_in_data: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    decks = relationship("Deck", back_populates="builder", foreign_keys="Deck.builder_id")
    seats = relationship("GameSeat", back_populates="pilot", foreign_keys="GameSeat.pilot_id")
