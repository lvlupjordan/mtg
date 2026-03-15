"""Make game_seats.deck_id nullable and ensure a Stranger user exists."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))

from sqlalchemy import text
from app.database import engine

with engine.connect() as conn:
    conn.execute(text(
        "ALTER TABLE game_seats ALTER COLUMN deck_id DROP NOT NULL"
    ))
    conn.execute(text("""
        INSERT INTO users (name, created_at, show_as_brewer, include_in_data)
        SELECT 'Stranger', NOW(), false, false
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = 'Stranger')
    """))
    conn.commit()
    print("Migration complete: deck_id nullable, Stranger user ensured.")
