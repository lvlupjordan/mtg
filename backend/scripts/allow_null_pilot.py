"""
Make game_seats.pilot_id nullable to support stranger seats.

Run with:
    DATABASE_URL="<prod_url>" python backend/scripts/allow_null_pilot.py
"""
import os
import psycopg2

url = os.environ["DATABASE_URL"]
conn = psycopg2.connect(url)
cur = conn.cursor()

cur.execute("ALTER TABLE game_seats ALTER COLUMN pilot_id DROP NOT NULL;")

conn.commit()
cur.close()
conn.close()
print("Done — pilot_id is now nullable.")
