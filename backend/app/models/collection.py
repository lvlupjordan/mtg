from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Integer, Text, Boolean, Numeric, Date, TIMESTAMP, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class CollectionEntry(Base):
    __tablename__ = "collection_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    card_id: Mapped[str] = mapped_column(UUID(as_uuid=False), ForeignKey("cards.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    foil: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    condition: Mapped[str] = mapped_column(Text, nullable=False, default="near_mint")
    language: Mapped[str] = mapped_column(Text, nullable=False, default="en")
    purchase_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    purchase_currency: Mapped[str] = mapped_column(Text, nullable=False, default="EUR")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    acquired_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP, nullable=False, default=datetime.utcnow)

    card = relationship("Card", back_populates="collection_entries")
    owner = relationship("User", backref="collection_entries")
