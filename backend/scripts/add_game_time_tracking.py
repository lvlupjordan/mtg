"""
Migration: add total_game_time to games, and turns + time_spent to game_seats.

Run with:
    DATABASE_URL="<prod_url>" python backend/scripts/add_game_time_tracking.py
"""
import os
import psycopg2

url = os.environ["DATABASE_URL"]
conn = psycopg2.connect(url)
cur = conn.cursor()

cur.execute("ALTER TABLE games ADD COLUMN IF NOT EXISTS total_game_time INTEGER;")
cur.execute("ALTER TABLE game_seats ADD COLUMN IF NOT EXISTS turns INTEGER;")
cur.execute("ALTER TABLE game_seats ADD COLUMN IF NOT EXISTS time_spent INTEGER;")

conn.commit()
cur.close()
conn.close()
print("Migration complete.")
