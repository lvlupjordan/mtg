"""
Reads games_clean.csv and inserts games + game_seats into Postgres.
Matches players to users table and commanders to decks table by name.
"""

import csv
import os
import psycopg2
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

# Load lookups
cur.execute("SELECT id, name FROM users")
users = {name: id for id, name in cur.fetchall()}

cur.execute("SELECT id, commander FROM decks")
decks = {commander: id for id, commander in cur.fetchall()}

# Read CSV and group by game_id
csv_path = os.path.join(os.path.dirname(__file__), "games_clean.csv")
games = defaultdict(list)
with open(csv_path) as f:
    for row in csv.DictReader(f):
        games[int(row["game_id"])].append(row)

missing_users = set()
missing_decks = set()
inserted_games = 0
inserted_seats = 0

for game_id in sorted(games.keys()):
    seats = games[game_id]
    sample = seats[0]

    # Parse date dd/mm/yyyy -> yyyy-mm-dd
    d, m, y = sample["date"].split("/")
    played_at = f"{y}-{m}-{d}"
    variant = sample["variant"]

    cur.execute(
        "INSERT INTO games (played_at, variant) VALUES (%s, %s) RETURNING id",
        (played_at, variant),
    )
    db_game_id = cur.fetchone()[0]
    inserted_games += 1

    for i, seat in enumerate(seats, start=1):
        player = seat["player"]
        commander = seat["commander"]
        position = float(seat["position"]) if seat["position"] else None
        victory = seat["victory_condition"] or None
        is_archenemy = seat["archenemy"] == "1"

        pilot_id = users.get(player)
        deck_id = decks.get(commander)

        if not pilot_id:
            missing_users.add(player)
            continue
        if not deck_id:
            missing_decks.add(commander)
            continue

        cur.execute(
            """INSERT INTO game_seats
               (game_id, deck_id, pilot_id, seat, placement, victory_condition, is_archenemy)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (db_game_id, deck_id, pilot_id, i, position, victory, is_archenemy),
        )
        inserted_seats += 1

conn.commit()
cur.close()
conn.close()

print(f"Inserted {inserted_games} games, {inserted_seats} seats")
if missing_users:
    print(f"Missing users: {sorted(missing_users)}")
if missing_decks:
    print(f"Missing decks: {sorted(missing_decks)}")
