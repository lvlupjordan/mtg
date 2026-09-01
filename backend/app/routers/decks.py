import re
import math
import random
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, case, and_, or_, text
from sqlalchemy.orm import Session
import httpx
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import GameSeat
from app.routers.stats import compute_elo_ratings
from app import composition

router = APIRouter(prefix="/api/decks", tags=["decks"])


@router.get("")
def list_decks(
    owner: int | None = Query(default=None, description="Filter by builder user id"),
    colours: str | None = Query(default=None, description="Comma-separated colours e.g. U,G,C for colorless"),
    budget: str | None = Query(default=None),
    active: bool | None = Query(default=None),
    cmc_min: float | None = Query(default=None),
    cmc_max: float | None = Query(default=None),
    search: str | None = Query(default=None),
    sort: str = Query(default="games", description="games | win_rate | avg_placement | cmc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=500),
    db: Session = Depends(get_db),
):
    q = (
        db.query(
            Deck.id,
            Deck.name,
            Deck.commander,
            Deck.color_identity,
            Deck.commander_cmc,
            Deck.strategy,
            Deck.budget,
            Deck.active,
            User.id.label("builder_id"),
            User.name.label("builder_name"),
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .join(User, Deck.builder_id == User.id)
        .outerjoin(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, User.id, User.name)
    )

    if owner is not None:
        q = q.filter(Deck.builder_id == owner)
    if colours:
        color_list = [c.strip().upper() for c in colours.split(",")]
        include_colorless = "C" in color_list
        regular = [c for c in color_list if c != "C"]
        colorless_cond = text("(array_length(decks.color_identity, 1) IS NULL OR array_length(decks.color_identity, 1) = 0)")
        if include_colorless and regular:
            color_conds = and_(*[text(f":c{i} = ANY(decks.color_identity)").bindparams(**{f"c{i}": c}) for i, c in enumerate(regular)])
            q = q.filter(or_(colorless_cond, color_conds))
        elif include_colorless:
            q = q.filter(colorless_cond)
        else:
            for i, c in enumerate(regular):
                q = q.filter(text(f":c{i} = ANY(decks.color_identity)").bindparams(**{f"c{i}": c}))
    if budget:
        q = q.filter(Deck.budget == budget)
    if active is not None:
        q = q.filter(Deck.active == active)
    if cmc_min is not None:
        q = q.filter(Deck.commander_cmc >= cmc_min)
    if cmc_max is not None:
        q = q.filter(Deck.commander_cmc <= cmc_max)
    if search:
        q = q.filter(Deck.commander.ilike(f"%{search}%") | Deck.name.ilike(f"%{search}%"))

    sort_map = {
        "games": func.count(GameSeat.id).desc(),
        "win_rate": (func.count(case((GameSeat.placement == 1, 1))) / func.nullif(func.count(GameSeat.id), 0)).desc().nullslast(),
        "avg_placement": func.avg(GameSeat.placement).asc(),
        "cmc": Deck.commander_cmc.asc(),
    }
    q = q.order_by(sort_map.get(sort, func.count(GameSeat.id).desc()))

    total = q.count()
    rows = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "decks": [
            {
                "id": d.id,
                "name": d.name,
                "commander": d.commander,
                "color_identity": d.color_identity,
                "commander_cmc": d.commander_cmc,
                "strategy": d.strategy,
                "budget": d.budget,
                "active": d.active,
                "image_uri": db.get(Deck, d.id).image_uri,
                "moxfield_url": db.get(Deck, d.id).moxfield_url,
                "builder": {"id": d.builder_id, "name": d.builder_name},
                "games": d.games,
                "wins": d.wins,
                "win_rate": round(d.wins / d.games, 3) if d.games else 0,
                "avg_placement": round(float(d.avg_placement), 2) if d.avg_placement else None,
            }
            for d in rows
        ],
    }


@router.get("/all")
def list_all_decks(db: Session = Depends(get_db)):
    """Every deck with the minimal fields selectors need, unpaginated. Single
    source of truth for deck pickers so they never miss a deck (unlike the
    paginated browse endpoint). Declared before /{deck_id} so the literal wins."""
    rows = (
        db.query(
            Deck.id, Deck.name, Deck.commander, Deck.color_identity,
            Deck.image_uri, Deck.active, Deck.budget,
            User.id.label("builder_id"), User.name.label("builder_name"),
        )
        .join(User, Deck.builder_id == User.id)
        .order_by(Deck.commander)
        .all()
    )
    return {"decks": [
        {
            "id": r.id, "name": r.name, "commander": r.commander,
            "color_identity": r.color_identity, "image_uri": r.image_uri,
            "active": r.active, "budget": r.budget,
            "builder": {"id": r.builder_id, "name": r.builder_name},
        }
        for r in rows
    ]}


@router.get("/suggest")
def suggest_deck(
    pilot_id: int = Query(..., description="Seat's player — candidates are their active decks"),
    pod: str = Query(default="", description="Comma-separated deck ids already chosen in the pod"),
    exclude: str = Query(default="", description="Deck ids to exclude (e.g. the current pick, so a re-roll differs)"),
    db: Session = Depends(get_db),
):
    """Suggest one of a player's active decks for a seat, scored against the
    decks already in the pod by freshness, colour/strategy diversity, power fit
    (Elo) and a grudge factor (poor past record vs the pod). Declared before
    /{deck_id} so the literal path wins."""
    pod_ids = [int(x) for x in pod.split(",") if x.strip().isdigit()]
    exclude_ids = {int(x) for x in exclude.split(",") if x.strip().isdigit()}

    base = [
        d for d in db.query(Deck)
        .filter(Deck.builder_id == pilot_id, Deck.active == True).all()
        if d.id not in pod_ids
    ]
    # Drop the just-suggested deck(s) so a re-roll returns something new — unless
    # that would leave nothing (e.g. the player owns only one eligible deck).
    candidates = [d for d in base if d.id not in exclude_ids] or base
    if not candidates:
        return {"suggestion": None, "alternates": [], "candidate_count": 0}

    cand_ids = [d.id for d in candidates]

    # Last played per candidate
    lp_rows = db.execute(text("""
        SELECT gs.deck_id AS deck_id, MAX(g.played_at) AS last_played
        FROM game_seats gs JOIN games g ON g.id = gs.game_id
        WHERE gs.deck_id = ANY(:ids)
        GROUP BY gs.deck_id
    """), {"ids": cand_ids}).fetchall()
    last_played = {r.deck_id: r.last_played for r in lp_rows}

    # Grudge: candidate co-appearances with pod decks, and how often it placed worse
    grudge = {}
    if pod_ids:
        gr_rows = db.execute(text("""
            SELECT a.deck_id AS deck_id,
                   COUNT(*) AS shared,
                   SUM(CASE WHEN a.placement > b.placement THEN 1 ELSE 0 END) AS losses
            FROM game_seats a
            JOIN game_seats b ON a.game_id = b.game_id AND b.deck_id = ANY(:pod)
            WHERE a.deck_id = ANY(:ids)
              AND a.placement IS NOT NULL AND b.placement IS NOT NULL
            GROUP BY a.deck_id
        """), {"ids": cand_ids, "pod": pod_ids}).fetchall()
        grudge = {r.deck_id: (r.shared, r.losses or 0) for r in gr_rows}

    ratings, _, _ = compute_elo_ratings(db)
    def elo(did):
        return ratings.get(did, 1500.0)

    pod_decks = db.query(Deck).filter(Deck.id.in_(pod_ids)).all() if pod_ids else []
    pod_colours, pod_strats = set(), set()
    for d in pod_decks:
        pod_colours.update(d.color_identity or [])
        pod_strats.update(d.strategy or [])
    pod_avg_elo = (sum(elo(d.id) for d in pod_decks) / len(pod_decks)) if pod_decks else None

    today = date.today()
    def days_since(did):
        lp = last_played.get(did)
        if lp is None:
            return None
        lpd = lp.date() if hasattr(lp, "date") else lp
        return (today - lpd).days

    FRESH_CAP, ELO_CAP = 60, 300

    # Base weights — grudge is the dominant factor so revenge picks actually
    # surface. Each is randomized ±20–30% per request so the blend (and pick)
    # varies per click.
    BASE_W = {"fresh": 0.25, "diversity": 0.20, "power": 0.15, "grudge": 0.40}
    W = {k: v * (1 + random.choice([-1, 1]) * random.uniform(0.20, 0.30)) for k, v in BASE_W.items()}

    scored = []
    for d in candidates:
        ds = days_since(d.id)
        fresh = 1.0 if ds is None else min(ds, FRESH_CAP) / FRESH_CAP

        if pod_decks:
            cols = d.color_identity or []
            col_div = (len([c for c in cols if c not in pod_colours]) / len(cols)) if cols else 0.5
            strs = d.strategy or []
            str_div = (len([s for s in strs if s not in pod_strats]) / len(strs)) if strs else 0.5
            diversity = (col_div + str_div) / 2
        else:
            diversity = 0.5

        power_fit = (1 - min(abs(elo(d.id) - pod_avg_elo), ELO_CAP) / ELO_CAP) if pod_avg_elo is not None else 0.5

        shared, losses = grudge.get(d.id, (0, 0))
        # loss rate, lightly scaled by volume (full strength by 3 shared games)
        grudge_score = (losses / shared) * (min(shared, 3) / 3) if shared else 0.0

        jitter = random.uniform(0, 0.06)  # tiny tie-breaker
        score = W["fresh"] * fresh + W["diversity"] * diversity + W["power"] * power_fit + W["grudge"] * grudge_score + jitter

        reasons = []
        if ds is None:
            reasons.append("never played")
        elif ds >= 21:
            reasons.append(f"not played in {ds} days")
        if pod_decks and diversity >= 0.6:
            reasons.append("brings fresh colours/strategy")
        if shared >= 2 and losses / shared >= 0.6:
            reasons.append(f"{losses}/{shared} record vs this pod — grudge match")
        scored.append((score, d, {"days_since": ds, "elo": round(elo(d.id)), "reasons": reasons}))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Weighted-random pick (softmax over scores) so repeat clicks vary rather
    # than always returning the single top-scored deck.
    mx = scored[0][0]
    weights = [math.exp((s[0] - mx) * 4) for s in scored]
    chosen_idx = random.choices(range(len(scored)), weights=weights, k=1)[0]
    chosen = scored[chosen_idx]
    alternates = [e for idx, e in enumerate(scored) if idx != chosen_idx][:2]

    def pack(entry):
        _, d, meta = entry
        return {
            "id": d.id, "name": d.name, "commander": d.commander,
            "color_identity": d.color_identity, "image_uri": d.image_uri,
            "budget": d.budget, "elo": meta["elo"],
            "days_since_played": meta["days_since"], "reasons": meta["reasons"],
        }

    return {
        "suggestion": pack(chosen),
        "alternates": [pack(e) for e in alternates],
        "candidate_count": len(candidates),
    }


@router.get("/{deck_id}")
def get_deck(deck_id: int, db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    stats = (
        db.query(
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.avg(GameSeat.placement).label("avg_placement"),
        )
        .filter(GameSeat.deck_id == deck_id)
        .one()
    )

    # Pilots who have played this deck
    pilot_rows = (
        db.query(
            User.id,
            User.name,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
        )
        .join(GameSeat, GameSeat.pilot_id == User.id)
        .filter(GameSeat.deck_id == deck_id)
        .group_by(User.id, User.name)
        .order_by(func.count(GameSeat.id).desc())
        .all()
    )

    # Recent games
    recent = (
        db.query(GameSeat)
        .filter(GameSeat.deck_id == deck_id)
        .join(GameSeat.game)
        .order_by(GameSeat.game_id.desc())
        .limit(10)
        .all()
    )

    builder = db.get(User, deck.builder_id)

    return {
        "id": deck.id,
        "name": deck.name,
        "commander": deck.commander,
        "color_identity": deck.color_identity,
        "commander_cmc": deck.commander_cmc,
        "strategy": deck.strategy,
        "budget": deck.budget,
        "active": deck.active,
        "image_uri": deck.image_uri,
        "moxfield_url": deck.moxfield_url,
        "builder": {"id": builder.id, "name": builder.name},
        "games": stats.games,
        "wins": stats.wins,
        "win_rate": round(stats.wins / stats.games, 3) if stats.games else 0,
        "avg_placement": round(float(stats.avg_placement), 2) if stats.avg_placement else None,
        "pilots": [
            {
                "id": p.id,
                "name": p.name,
                "games": p.games,
                "wins": p.wins,
                "win_rate": round(p.wins / p.games, 3) if p.games else 0,
            }
            for p in pilot_rows
        ],
        "recent_games": [
            {
                "game_id": s.game_id,
                "played_at": s.game.played_at,
                "pilot": s.pilot.name if s.pilot else None,
                "placement": s.placement,
                "victory_condition": s.victory_condition,
                "opponents": [
                    {
                        "deck_id": other.deck_id,
                        "commander": other.deck.commander if other.deck else None,
                        "pilot": other.pilot.name if other.pilot else None,
                        "placement": other.placement,
                    }
                    for other in sorted(s.game.seats, key=lambda x: x.placement or 99)
                    if other.deck_id != deck_id
                ],
            }
            for s in recent
        ],
    }


@router.patch("/{deck_id}")
def update_deck(deck_id: int, payload: dict, db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    if "active" in payload:
        deck.active = bool(payload["active"])
    if "name" in payload:
        deck.name = payload["name"]
    if "commander" in payload:
        commander_changed = payload["commander"] != deck.commander
        deck.commander = payload["commander"]
        if commander_changed:
            deck.image_uri = _fetch_scryfall_image(payload["commander"])
    if "color_identity" in payload:
        deck.color_identity = [c.upper() for c in payload["color_identity"]]
    if "commander_cmc" in payload:
        deck.commander_cmc = payload["commander_cmc"]
    if "strategy" in payload:
        deck.strategy = payload["strategy"]
    if "budget" in payload:
        deck.budget = payload["budget"]
    if "builder_id" in payload:
        builder = db.get(User, payload["builder_id"])
        if not builder:
            raise HTTPException(status_code=404, detail="Builder not found")
        deck.builder_id = payload["builder_id"]
    if "notes" in payload:
        deck.notes = payload["notes"]
    if "moxfield_url" in payload:
        deck.moxfield_url = payload["moxfield_url"] or None
    db.commit()
    db.refresh(deck)
    return {"id": deck.id, "active": deck.active, "name": deck.name, "commander": deck.commander, "image_uri": deck.image_uri}


class DeckCreate(BaseModel):
    commander: str
    name: str | None = None
    builder_id: int
    color_identity: list[str]
    commander_cmc: float | None = None
    strategy: list[str] = []
    budget: str | None = None
    notes: str | None = None
    moxfield_url: str | None = None
    active: bool = True


def _fetch_scryfall_image(commander: str) -> str | None:
    search_name = commander.split(" //")[0].strip()
    try:
        r = httpx.get(
            "https://api.scryfall.com/cards/named",
            params={"fuzzy": search_name},
            timeout=10,
        )
        if r.status_code == 200:
            card = r.json()
            if "card_faces" in card and "image_uris" in card["card_faces"][0]:
                return card["card_faces"][0]["image_uris"].get("normal")
            return card.get("image_uris", {}).get("normal")
    except Exception:
        pass
    return None


_SECTION_ORDER = ["Commander", "Creatures", "Instants", "Sorceries", "Enchantments", "Artifacts", "Planeswalkers", "Battles", "Lands", "Other"]

def _type_section(type_line: str, board: str) -> str:
    if board == "commanders":
        return "Commander"
    tl = type_line.lower()
    if "land" in tl:       return "Lands"
    if "creature" in tl:   return "Creatures"
    if "instant" in tl:    return "Instants"
    if "sorcery" in tl:    return "Sorceries"
    if "enchantment" in tl: return "Enchantments"
    if "artifact" in tl:   return "Artifacts"
    if "planeswalker" in tl: return "Planeswalkers"
    if "battle" in tl:     return "Battles"
    return "Other"


@router.get("/{deck_id}/moxfield")
def get_moxfield_decklist(deck_id: int, db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(404, "Deck not found")
    if not deck.moxfield_url:
        raise HTTPException(404, "No Moxfield URL set for this deck")

    match = re.search(r'moxfield\.com/decks/([A-Za-z0-9_-]+)', deck.moxfield_url)
    if not match:
        raise HTTPException(400, "Invalid Moxfield URL — expected https://www.moxfield.com/decks/DECK_ID")
    mox_id = match.group(1)

    try:
        resp = httpx.get(
            f"https://api2.moxfield.com/v3/decks/all/{mox_id}",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "application/json",
                "Referer": "https://www.moxfield.com/",
            },
            timeout=15,
            follow_redirects=True,
        )
    except Exception as e:
        raise HTTPException(502, f"Could not reach Moxfield: {e}")

    if resp.status_code == 404:
        raise HTTPException(404, "Deck not found on Moxfield — check the URL and ensure the deck is public")
    if resp.status_code != 200:
        raise HTTPException(502, f"Moxfield returned {resp.status_code}")

    data = resp.json()
    sections: dict[str, list] = {}

    for board_name, board in data.get("boards", {}).items():
        if board_name not in ("mainboard", "commanders"):
            continue
        for entry in board.get("cards", {}).values():
            card = entry.get("card", {})
            type_line = card.get("type_line") or ""
            section = _type_section(type_line, board_name)
            scryfall_id = card.get("scryfall_id")
            image_uri = (
                f"https://cards.scryfall.io/normal/front/{scryfall_id[0]}/{scryfall_id[1]}/{scryfall_id}.jpg"
                if scryfall_id else None
            )
            sections.setdefault(section, []).append({
                "name": card.get("name", "Unknown"),
                "quantity": entry.get("quantity", 1),
                "mana_cost": card.get("mana_cost") or "",
                "cmc": card.get("cmc") or 0,
                "type_line": type_line,
                "image_uri": image_uri,
            })

    for cards in sections.values():
        cards.sort(key=lambda c: (c["cmc"], c["name"]))

    ordered = dict(
        sorted(sections.items(), key=lambda kv: -sum(c["quantity"] for c in kv[1]))
    )

    total = sum(c["quantity"] for cards in sections.values() for c in cards)
    return {"deck_name": data.get("name"), "total": total, "sections": ordered}


@router.get("/{deck_id}/composition")
def deck_composition(deck_id: int, refresh: bool = Query(default=False), db: Session = Depends(get_db)):
    deck = db.get(Deck, deck_id)
    if not deck:
        raise HTTPException(404, "Deck not found")
    if not deck.moxfield_url:
        raise HTTPException(404, "No Moxfield URL set for this deck")
    try:
        return composition.get_composition(db, deck, refresh=refresh)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e))


@router.post("")
def create_deck(deck: DeckCreate, db: Session = Depends(get_db)):
    builder = db.get(User, deck.builder_id)
    if not builder:
        raise HTTPException(status_code=404, detail="Builder not found")

    image_uri = _fetch_scryfall_image(deck.commander)

    new_deck = Deck(
        name=deck.name or deck.commander,
        commander=deck.commander,
        builder_id=deck.builder_id,
        color_identity=[c.upper() for c in deck.color_identity],
        commander_cmc=deck.commander_cmc,
        strategy=deck.strategy,
        budget=deck.budget,
        notes=deck.notes,
        moxfield_url=deck.moxfield_url or None,
        active=deck.active,
        image_uri=image_uri,
        created_at=datetime.utcnow(),
    )
    db.add(new_deck)
    db.commit()
    db.refresh(new_deck)
    return {
        "id": new_deck.id,
        "name": new_deck.name,
        "commander": new_deck.commander,
        "image_uri": new_deck.image_uri,
    }
