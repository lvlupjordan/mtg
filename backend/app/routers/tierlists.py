import json
import random
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(prefix="/api/tierlists", tags=["tierlists"])

# ── Pairwise (Elo) tier building ────────────────────────────────────────────
# Users rank decks by repeatedly picking the stronger of two; each pick updates
# per-user Elo ratings, and the sorted ratings are sliced into S–F tiers (stored
# in the same tier_lists.tiers JSON the display already reads).
BASE_RATING = 1000.0
K_FACTOR = 32
# S–F band shape. Kept identical to the frontend's computeCaps so a stored list,
# the Elo-suggested view and the averaged view all bucket decks the same way.
TIERS = ["S", "A", "B", "C", "D", "F"]
TIER_WEIGHTS = [1, 2, 3, 3, 2, 1]


def compute_caps(n: int) -> list[int]:
    """How many decks each of S–F holds for n decks (largest-remainder rounding)."""
    total = sum(TIER_WEIGHTS)
    raw = [n * w / total for w in TIER_WEIGHTS]
    caps = [int(r) for r in raw]
    remainder = n - sum(caps)
    for i in sorted(range(len(caps)), key=lambda i: raw[i] - caps[i], reverse=True)[:remainder]:
        caps[i] += 1
    return caps


def ensure_pairwise_tables(db: Session):
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS deck_comparisons (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            winner_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            loser_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL DEFAULT now())"""))
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS deck_ratings (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            rating REAL NOT NULL DEFAULT 1000,
            comparisons INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, deck_id))"""))
    db.commit()


def _active_decks(db: Session):
    return db.execute(text("""
        SELECT d.id, d.commander, d.image_uri, d.color_identity, u.name AS builder
        FROM decks d LEFT JOIN users u ON u.id = d.builder_id
        WHERE d.active = true ORDER BY d.id""")).fetchall()


def _ratings(db: Session, user_id: int) -> dict:
    rows = db.execute(text("SELECT deck_id, rating, comparisons FROM deck_ratings WHERE user_id = :u"),
                      {"u": user_id}).fetchall()
    return {r.deck_id: (r.rating, r.comparisons) for r in rows}


def _recompute_tiers(db: Session, user_id: int):
    """Sort a user's decks by Elo rating, slice into S–F, save to tier_lists."""
    decks = _active_decks(db)
    rmap = _ratings(db, user_id)
    ranked = sorted(((d.id, rmap[d.id][0]) for d in decks if rmap.get(d.id, (0, 0))[1] > 0),
                    key=lambda x: -x[1])
    unranked = [d.id for d in decks if rmap.get(d.id, (0, 0))[1] == 0]
    caps = compute_caps(len(decks))
    tiers = {t: [] for t in TIERS}
    tiers["unranked"] = unranked
    i = 0
    for ti, t in enumerate(TIERS):
        tiers[t] = [did for did, _ in ranked[i:i + caps[ti]]]
        i += caps[ti]
    db.execute(text("""
        INSERT INTO tier_lists (user_id, tiers, updated_at) VALUES (:u, CAST(:t AS jsonb), NOW())
        ON CONFLICT (user_id) DO UPDATE SET tiers = EXCLUDED.tiers, updated_at = NOW()"""),
        {"u": user_id, "t": json.dumps(tiers)})
    db.commit()


@router.get("/{user_id}/next-pair")
def next_pair(user_id: int, db: Session = Depends(get_db)):
    """Two decks to compare: bias toward under-compared decks, then close ratings
    (informative), avoiding an immediate repeat of the last pair."""
    decks = _active_decks(db)
    if len(decks) < 2:
        return {"pair": None, "total": 0}
    rmap = _ratings(db, user_id)
    info = [{"id": d.id, "commander": d.commander, "image_uri": d.image_uri,
             "color_identity": d.color_identity, "builder": d.builder,
             "rating": rmap.get(d.id, (BASE_RATING, 0))[0],
             "comparisons": rmap.get(d.id, (BASE_RATING, 0))[1]} for d in decks]
    total = db.execute(text("SELECT count(*) FROM deck_comparisons WHERE user_id = :u"), {"u": user_id}).scalar()
    last = db.execute(text("SELECT winner_id, loser_id FROM deck_comparisons WHERE user_id = :u ORDER BY id DESC LIMIT 1"),
                      {"u": user_id}).fetchone()
    last_pair = {last.winner_id, last.loser_id} if last else set()

    minc = min(x["comparisons"] for x in info)
    least = [x for x in info if x["comparisons"] <= minc + 1]
    for _ in range(8):  # a few tries to avoid repeating the last pair
        a = random.choice(least)
        others = sorted((x for x in info if x["id"] != a["id"]),
                        key=lambda x: (abs(x["rating"] - a["rating"]), x["comparisons"]))
        b = random.choice(others[:max(3, len(others) // 8)])
        if {a["id"], b["id"]} != last_pair:
            break
    if random.random() < 0.5:
        a, b = b, a
    return {"pair": [a, b], "total": total}


@router.post("/{user_id}/compare")
def submit_comparison(user_id: int, body: dict, db: Session = Depends(get_db)):
    winner, loser = body.get("winner_id"), body.get("loser_id")
    if not winner or not loser or winner == loser:
        raise HTTPException(400, "winner_id and loser_id required and must differ")
    rmap = _ratings(db, user_id)
    rw, cw = rmap.get(winner, (BASE_RATING, 0))
    rl, cl = rmap.get(loser, (BASE_RATING, 0))
    exp_w = 1 / (1 + 10 ** ((rl - rw) / 400))
    rw2 = rw + K_FACTOR * (1 - exp_w)
    rl2 = rl + K_FACTOR * (0 - (1 - exp_w))
    for did, rt, cn in ((winner, rw2, cw + 1), (loser, rl2, cl + 1)):
        db.execute(text("""
            INSERT INTO deck_ratings (user_id, deck_id, rating, comparisons) VALUES (:u, :d, :r, :c)
            ON CONFLICT (user_id, deck_id) DO UPDATE SET rating = :r, comparisons = :c"""),
            {"u": user_id, "d": did, "r": rt, "c": cn})
    db.execute(text("INSERT INTO deck_comparisons (user_id, winner_id, loser_id) VALUES (:u, :w, :l)"),
               {"u": user_id, "w": winner, "l": loser})
    db.commit()
    _recompute_tiers(db, user_id)
    total = db.execute(text("SELECT count(*) FROM deck_comparisons WHERE user_id = :u"), {"u": user_id}).scalar()
    return {"ok": True, "total": total}


@router.delete("/{user_id}/ranking")
def reset_ranking(user_id: int, db: Session = Depends(get_db)):
    """Wipe a user's comparisons, Elo ratings and derived tier list — start over."""
    for tbl in ("deck_comparisons", "deck_ratings", "tier_lists"):
        db.execute(text(f"DELETE FROM {tbl} WHERE user_id = :u"), {"u": user_id})
    db.commit()
    return {"ok": True}


@router.get("")
def list_tierlists(db: Session = Depends(get_db)):
    """All published tierlists with user info."""
    rows = db.execute(text("""
        SELECT tl.user_id, tl.tiers, tl.updated_at, u.name AS user_name
        FROM tier_lists tl
        JOIN users u ON u.id = tl.user_id
        ORDER BY u.name
    """)).fetchall()
    return [
        {
            "user_id": r.user_id,
            "user_name": r.user_name,
            "tiers": r.tiers,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]


@router.get("/{user_id}")
def get_tierlist(user_id: int, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT tiers, updated_at FROM tier_lists WHERE user_id = :uid"),
        {"uid": user_id},
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="No tierlist found for this user")
    return {"user_id": user_id, "tiers": row.tiers, "updated_at": row.updated_at}
