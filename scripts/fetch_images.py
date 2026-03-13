"""
Looks up each commander on Scryfall and saves the image URI to the decks table.
"""

import os
import time
import httpx
import psycopg2
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))

DATABASE_URL = os.environ.get("DATABASE_URL")

conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()

cur.execute("SELECT id, commander FROM decks WHERE image_uri IS NULL")
decks = cur.fetchall()

print(f"Looking up {len(decks)} commanders...")

for deck_id, commander in decks:
    # Handle double-faced / partner commanders — search by first name
    search_name = commander.split(" //")[0].strip()

    try:
        r = httpx.get(
            "https://api.scryfall.com/cards/named",
            params={"fuzzy": search_name},
            timeout=10,
        )
        if r.status_code == 200:
            card = r.json()
            # Prefer card_faces image if it exists (double-faced cards)
            if "card_faces" in card and "image_uris" in card["card_faces"][0]:
                image_uri = card["card_faces"][0]["image_uris"].get("normal")
            else:
                image_uri = card.get("image_uris", {}).get("normal")

            cur.execute("UPDATE decks SET image_uri = %s WHERE id = %s", (image_uri, deck_id))
            print(f"  ✓ {commander}")
        else:
            print(f"  ✗ {commander} — {r.status_code}: {r.json().get('details', '')}")
    except Exception as e:
        print(f"  ✗ {commander} — {e}")

    # Scryfall asks for 50-100ms between requests
    time.sleep(0.1)

conn.commit()
cur.close()
conn.close()
print("Done.")
