"""
Seeds cards and collection_entries from the archive data.
Reads archive/public/cards.json for card metadata (including oracle tags)
and archive/all.csv for per-owner ownership records.

Run with: DATABASE_URL="<prod_url>" python backend/scripts/import_collection.py
"""
import os
import json
import csv
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(DATABASE_URL)

script_dir = os.path.dirname(os.path.abspath(__file__))
archive_dir = os.path.join(script_dir, "../../archive")
cards_json_path = os.path.join(archive_dir, "public/cards.json")
all_csv_path = os.path.join(archive_dir, "all.csv")

print("Loading cards.json…")
with open(cards_json_path) as f:
    cards_data = json.load(f)
cards_by_id = {c["id"]: c for c in cards_data}
print(f"  {len(cards_by_id)} cards in archive")

with engine.connect() as conn:
    users = conn.execute(text("SELECT id, name FROM users")).fetchall()
    user_map = {u.name.lower(): u.id for u in users}
    print(f"  Users in DB: {dict(user_map)}")

    inserted_cards = 0
    inserted_entries = 0
    skipped = 0

    print("Importing all.csv…")
    with open(all_csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            scryfall_id = row["Scryfall ID"].strip()
            owner_name = row["Owner"].strip().lower()

            if not scryfall_id:
                skipped += 1
                continue

            if owner_name not in user_map:
                print(f"  Unknown owner '{owner_name}' — skipping")
                skipped += 1
                continue

            owner_id = user_map[owner_name]

            # Insert card if not already present
            existing = conn.execute(
                text("SELECT 1 FROM cards WHERE id = :id"), {"id": scryfall_id}
            ).fetchone()

            if not existing:
                card = cards_by_id.get(scryfall_id)
                if card:
                    conn.execute(text("""
                        INSERT INTO cards (
                            id, oracle_id, name, mana_cost, cmc, type_line, oracle_text,
                            colors, color_identity, keywords, power, toughness, rarity,
                            set_code, set_name, collector_number,
                            image_uri, image_art_crop, back_image_uri,
                            layout, legalities, produced_mana, oracle_tags
                        ) VALUES (
                            :id, :oracle_id, :name, :mana_cost, :cmc, :type_line, :oracle_text,
                            :colors, :color_identity, :keywords, :power, :toughness, :rarity,
                            :set_code, :set_name, :collector_number,
                            :image_uri, :image_art_crop, :back_image_uri,
                            :layout, CAST(:legalities AS jsonb), :produced_mana, :oracle_tags
                        )
                    """), {
                        "id": scryfall_id,
                        "oracle_id": card.get("oracleId"),
                        "name": card["name"],
                        "mana_cost": card.get("manaCost"),
                        "cmc": card.get("cmc"),
                        "type_line": card.get("typeLine"),
                        "oracle_text": card.get("oracleText"),
                        "colors": card.get("colors", []),
                        "color_identity": card.get("colorIdentity", []),
                        "keywords": card.get("keywords", []),
                        "power": card.get("power"),
                        "toughness": card.get("toughness"),
                        "rarity": card.get("rarity"),
                        "set_code": card.get("setCode") or row["Set code"],
                        "set_name": card.get("setName") or row["Set name"],
                        "collector_number": card.get("collectorNumber") or row["Collector number"],
                        "image_uri": card.get("imageNormal"),
                        "image_art_crop": card.get("imageArtCrop"),
                        "back_image_uri": card.get("backImage"),
                        "layout": card.get("layout", "normal"),
                        "legalities": json.dumps(card.get("legalities", {})),
                        "produced_mana": card.get("producedMana", []),
                        "oracle_tags": card.get("oracleTags", []),
                    })
                else:
                    # Not in cards.json — insert minimal data from CSV
                    conn.execute(text("""
                        INSERT INTO cards (id, name, rarity, set_code, set_name, collector_number)
                        VALUES (:id, :name, :rarity, :set_code, :set_name, :collector_number)
                    """), {
                        "id": scryfall_id,
                        "name": row["Name"],
                        "rarity": row["Rarity"].lower(),
                        "set_code": row["Set code"],
                        "set_name": row["Set name"],
                        "collector_number": row["Collector number"],
                    })
                inserted_cards += 1

            # Insert collection entry
            foil = row["Foil"].strip().lower() == "foil"
            try:
                quantity = int(row["Quantity"])
            except (ValueError, TypeError):
                quantity = 1
            try:
                price = float(row["Purchase price"]) if row["Purchase price"] else None
            except (ValueError, TypeError):
                price = None

            conn.execute(text("""
                INSERT INTO collection_entries
                    (card_id, owner_id, quantity, foil, condition, language, purchase_price, purchase_currency)
                VALUES
                    (:card_id, :owner_id, :quantity, :foil, :condition, :language, :price, :currency)
            """), {
                "card_id": scryfall_id,
                "owner_id": owner_id,
                "quantity": quantity,
                "foil": foil,
                "condition": row["Condition"].strip(),
                "language": row["Language"].strip(),
                "price": price,
                "currency": row["Purchase price currency"].strip() or "EUR",
            })
            inserted_entries += 1

            if inserted_entries % 500 == 0:
                print(f"  …{inserted_entries} entries inserted")

    conn.commit()

print(f"\nDone. {inserted_cards} cards, {inserted_entries} collection entries imported. {skipped} rows skipped.")
