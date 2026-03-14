"""Add show_as_brewer and include_in_data columns to users table."""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env"))

from app.database import engine

with engine.connect() as conn:
    conn.execute(
        __import__("sqlalchemy").text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS show_as_brewer BOOLEAN NOT NULL DEFAULT true"
        )
    )
    conn.execute(
        __import__("sqlalchemy").text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS include_in_data BOOLEAN NOT NULL DEFAULT true"
        )
    )
    conn.commit()
    print("Migration complete: show_as_brewer and include_in_data added to users.")
