"""Add moxfield_url column to decks table."""
import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    conn.execute(text("ALTER TABLE decks ADD COLUMN IF NOT EXISTS moxfield_url TEXT"))
    conn.commit()

print("Done. moxfield_url column added to decks.")
