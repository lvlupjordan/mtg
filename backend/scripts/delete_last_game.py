"""
Delete the most recent game (and its seats) from the database.
Shows the game details before deleting so you can confirm it's the right one.

Run with:
    DATABASE_URL="<prod_url>" python backend/scripts/delete_last_game.py
"""
import os
import psycopg2

url = os.environ["DATABASE_URL"]
conn = psycopg2.connect(url)
cur = conn.cursor()

cur.execute("""
    SELECT g.id, g.played_at, g.notes,
           array_agg(u.name ORDER BY gs.placement) AS players
    FROM games g
    JOIN game_seats gs ON gs.game_id = g.id
    LEFT JOIN users u ON u.id = gs.pilot_id
    WHERE g.id = (SELECT id FROM games ORDER BY id DESC LIMIT 1)
    GROUP BY g.id, g.played_at, g.notes
""")
row = cur.fetchone()

if not row:
    print("No games found.")
    cur.close()
    conn.close()
    exit()

game_id, played_at, notes, players = row
print(f"About to delete:")
print(f"  ID:      {game_id}")
print(f"  Date:    {played_at}")
print(f"  Players: {', '.join(p for p in players if p)}")
if notes:
    print(f"  Notes:   {notes}")

confirm = input("\nDelete this game? [y/N] ").strip().lower()
if confirm != 'y':
    print("Aborted.")
    cur.close()
    conn.close()
    exit()

cur.execute("DELETE FROM game_seats WHERE game_id = %s", (game_id,))
cur.execute("DELETE FROM games WHERE id = %s", (game_id,))
conn.commit()
print(f"Deleted game {game_id}.")

cur.close()
conn.close()
