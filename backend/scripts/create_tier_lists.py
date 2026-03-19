"""
Create the tier_lists table for storing per-user tier list rankings.

Run with:
    DATABASE_URL="<prod_url>" python backend/scripts/create_tier_lists.py
"""
import os
import psycopg2

url = os.environ["DATABASE_URL"]
conn = psycopg2.connect(url)
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS tier_lists (
        user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tiers     JSONB    NOT NULL DEFAULT '{}',
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
""")

conn.commit()
cur.close()
conn.close()
print("Done — tier_lists table created.")
