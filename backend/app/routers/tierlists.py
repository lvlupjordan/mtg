from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/api/tierlists", tags=["tierlists"])


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


@router.put("/{user_id}")
def save_tierlist(user_id: int, body: dict, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    import json
    tiers_json = json.dumps(body.get("tiers", {}))

    db.execute(text("""
        INSERT INTO tier_lists (user_id, tiers, updated_at)
        VALUES (:uid, :tiers::jsonb, NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET tiers = EXCLUDED.tiers,
                updated_at = EXCLUDED.updated_at
    """), {"uid": user_id, "tiers": tiers_json})
    db.commit()
    return {"user_id": user_id, "saved": True}
