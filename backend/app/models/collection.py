from datetime import date
from decimal import Decimal
from sqlalchemy import Integer, String, Boolean, Text, Numeric, Date, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CollectionEntry(Base):
    __tablename__ = "collection_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("cards.id"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    foil: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    condition: Mapped[str] = mapped_column(String(5), nullable=False, default="NM")
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    acquired_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    acquired_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)

    card = relationship("Card", lazy="joined")
