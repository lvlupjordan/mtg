"""
Creates or updates the cards and collection_entries tables.
Safe to run on a fresh DB or an existing one — uses IF NOT EXISTS and
ADD COLUMN IF NOT EXISTS throughout.

Run with: DATABASE_URL="<prod_url>" python backend/scripts/create_collection_tables.py
"""
import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    # ── cards ────────────────────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS cards (
            id UUID PRIMARY KEY,
            oracle_id UUID,
            name TEXT NOT NULL,
            mana_cost TEXT,
            cmc FLOAT,
            type_line TEXT,
            oracle_text TEXT,
            colors TEXT[] DEFAULT '{}',
            color_identity TEXT[] DEFAULT '{}',
            keywords TEXT[] DEFAULT '{}',
            produced_mana TEXT[] DEFAULT '{}',
            oracle_tags TEXT[] DEFAULT '{}',
            power TEXT,
            toughness TEXT,
            rarity TEXT,
            set_code TEXT,
            set_name TEXT,
            collector_number TEXT,
            image_uri TEXT,
            image_art_crop TEXT,
            back_image_uri TEXT,
            layout TEXT DEFAULT 'normal',
            legalities JSONB DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """))

    # Add any columns that may be missing on an existing table
    for col, defn in [
        ("oracle_id",       "UUID"),
        ("keywords",        "TEXT[] DEFAULT '{}'"),
        ("produced_mana",   "TEXT[] DEFAULT '{}'"),
        ("oracle_tags",     "TEXT[] DEFAULT '{}'"),
        ("image_art_crop",  "TEXT"),
        ("back_image_uri",  "TEXT"),
        ("layout",          "TEXT DEFAULT 'normal'"),
    ]:
        conn.execute(text(f"ALTER TABLE cards ADD COLUMN IF NOT EXISTS {col} {defn}"))

    # ── collection_entries ───────────────────────────────────────────────────
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS collection_entries (
            id SERIAL PRIMARY KEY,
            card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            quantity INTEGER NOT NULL DEFAULT 1,
            foil BOOLEAN NOT NULL DEFAULT FALSE,
            condition TEXT NOT NULL DEFAULT 'near_mint',
            language TEXT NOT NULL DEFAULT 'en',
            purchase_price NUMERIC(10,2),
            purchase_currency TEXT DEFAULT 'EUR',
            notes TEXT,
            acquired_at DATE,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """))

    for col, defn in [
        ("owner_id",          "INTEGER REFERENCES users(id) ON DELETE CASCADE"),
        ("purchase_price",    "NUMERIC(10,2)"),
        ("purchase_currency", "TEXT DEFAULT 'EUR'"),
        ("created_at",        "TIMESTAMP DEFAULT NOW()"),
    ]:
        conn.execute(text(f"ALTER TABLE collection_entries ADD COLUMN IF NOT EXISTS {col} {defn}"))

    # ── indexes ──────────────────────────────────────────────────────────────
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cards_name ON cards(name)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cards_oracle_tags ON cards USING GIN(oracle_tags)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cards_colors ON cards USING GIN(colors)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cards_color_identity ON cards USING GIN(color_identity)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_collection_owner ON collection_entries(owner_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS idx_collection_card ON collection_entries(card_id)"))

    conn.commit()
    print("Done.")
