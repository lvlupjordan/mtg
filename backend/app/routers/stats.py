from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, case, text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.deck import Deck
from app.models.game import Game, GameSeat

router = APIRouter(prefix="/api/stats", tags=["stats"])

EXCLUDED_PLAYERS = ["Random", "Precon"]
COLOUR_ORDER = ["W", "U", "B", "R", "G", "C"]


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    total_games = db.query(func.count(Game.id)).scalar()
    total_seats = db.query(func.count(GameSeat.id)).scalar()
    unique_commanders = db.query(func.count(Deck.id.distinct())).scalar()

    most_played_deck = (
        db.query(Deck.name, func.count(GameSeat.id).label("n"))
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, Deck.name)
        .order_by(func.count(GameSeat.id).desc())
        .first()
    )

    best_win_rate = (
        db.query(
            Deck.name,
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
            func.count(GameSeat.id).label("games"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id, Deck.name)
        .having(func.count(GameSeat.id) >= 5)
        .order_by((func.count(case((GameSeat.placement == 1, 1))) / func.count(GameSeat.id).cast(text("float"))).desc())
        .first()
    )

    return {
        "total_games": total_games,
        "total_seats": total_seats,
        "unique_decks_played": unique_commanders,
        "most_played_deck": {"name": most_played_deck.name, "games": most_played_deck.n} if most_played_deck else None,
        "best_win_rate_deck": {
            "name": best_win_rate.name,
            "win_rate": round(best_win_rate.wins / best_win_rate.games, 3),
            "games": best_win_rate.games,
        } if best_win_rate else None,
    }


@router.get("/colours")
def colour_stats(db: Session = Depends(get_db)):
    """Win rate and play rate broken down by colour identity."""
    rows = (
        db.query(
            Deck.id,
            Deck.color_identity,
            func.count(GameSeat.id).label("games"),
            func.count(case((GameSeat.placement == 1, 1))).label("wins"),
        )
        .join(GameSeat, GameSeat.deck_id == Deck.id)
        .group_by(Deck.id)
        .all()
    )

    colours: dict = {}
    for row in rows:
        identity = tuple(sorted(row.color_identity or []))
        key = "".join(identity) if identity else "C"
        if key not in colours:
            colours[key] = {"color_identity": list(identity) or [], "games": 0, "wins": 0}
        colours[key]["games"] += row.games
        colours[key]["wins"] += row.wins

    return [
        {
            "color_identity": v["color_identity"],
            "games": v["games"],
            "wins": v["wins"],
            "win_rate": round(v["wins"] / v["games"], 3) if v["games"] else 0,
        }
        for v in sorted(colours.values(), key=lambda x: x["games"], reverse=True)
    ]


@router.get("/matchups")
def matchup_stats(db: Session = Depends(get_db)):
    """
    For each pair of decks that have shared a game, returns how often
    deck A placed better than deck B (relative placement).
    Only includes pairs with >= 3 shared games.
    """
    # Self-join game_seats on same game_id, different deck
    a = GameSeat.__table__.alias("a")
    b = GameSeat.__table__.alias("b")

    result = db.execute(
        text("""
            SELECT
                da.name AS deck_a,
                db.name AS deck_b,
                COUNT(*) AS shared_games,
                SUM(CASE WHEN a.placement < b.placement THEN 1 ELSE 0 END) AS a_better,
                ROUND(AVG(b.placement - a.placement)::numeric, 2) AS avg_placement_diff
            FROM game_seats a
            JOIN game_seats b ON a.game_id = b.game_id AND a.deck_id < b.deck_id
            JOIN decks da ON a.deck_id = da.id
            JOIN decks db ON b.deck_id = db.id
            WHERE a.placement IS NOT NULL AND b.placement IS NOT NULL
            GROUP BY da.name, db.name
            HAVING COUNT(*) >= 3
            ORDER BY shared_games DESC, avg_placement_diff DESC
        """)
    ).fetchall()

    return [
        {
            "deck_a": r.deck_a,
            "deck_b": r.deck_b,
            "shared_games": r.shared_games,
            "deck_a_placed_better": r.a_better,
            "avg_placement_diff": float(r.avg_placement_diff),
        }
        for r in result
    ]


@router.get("/timeseries")
def timeseries_stats(
    metric: str = "win_rate",
    group_by: str = "player",
    over: str = "month",
    filter_by: str | None = None,
    filter_value: str | None = None,
    db: Session = Depends(get_db),
):
    if metric not in {"win_rate", "games", "avg_placement", "wins"}:
        raise HTTPException(400, "Invalid metric")
    if group_by not in {"player", "deck"}:
        raise HTTPException(400, "Invalid group_by")
    if over not in {"month", "game"}:
        raise HTTPException(400, "Invalid over")

    params = {"excl1": EXCLUDED_PLAYERS[0], "excl2": EXCLUDED_PLAYERS[1]}
    base_where = "u.name NOT IN (:excl1, :excl2)"
    filter_where = ""

    if filter_by and filter_value:
        if filter_by == "player":
            filter_where = "AND u.name = :fv"
            params["fv"] = filter_value
        elif filter_by == "colour":
            filter_where = "AND :fv = ANY(d.color_identity)"
            params["fv"] = filter_value.upper()
        elif filter_by == "deck":
            filter_where = "AND d.commander = :fv"
            params["fv"] = filter_value

    where_sql = f"WHERE {base_where} {filter_where}"
    series_col = "u.name" if group_by == "player" else "d.commander"

    if over == "month":
        rows = db.execute(text(f"""
            SELECT
                {series_col} AS series_key,
                DATE_TRUNC('month', g.played_at) AS period,
                TO_CHAR(DATE_TRUNC('month', g.played_at), 'Mon YYYY') AS period_label,
                COUNT(gs.id)::int AS games,
                SUM(CASE WHEN gs.placement = 1 THEN 1 ELSE 0 END)::int AS wins,
                ROUND(AVG(gs.placement)::numeric, 2) AS avg_placement
            FROM game_seats gs
            JOIN decks d ON gs.deck_id = d.id
            JOIN users u ON gs.pilot_id = u.id
            JOIN games g ON gs.game_id = g.id
            {where_sql}
            GROUP BY {series_col}, DATE_TRUNC('month', g.played_at)
            ORDER BY {series_col}, period
        """), params).fetchall()

        # Collect all periods in order
        periods_ordered = sorted({r.period for r in rows})
        period_labels = {r.period: r.period_label for r in rows}

        # Build per-series lookup: series_key -> {period -> row}
        series_data: dict = {}
        for r in rows:
            series_data.setdefault(r.series_key, {})[r.period] = r

        all_series = sorted(series_data.keys())
        data = []
        for period in periods_ordered:
            point = {"x": period_labels[period]}
            for name in all_series:
                r = series_data[name].get(period)
                if r:
                    if metric == "win_rate":
                        point[name] = round(r.wins / r.games, 3) if r.games else 0
                    elif metric == "games":
                        point[name] = r.games
                    elif metric == "wins":
                        point[name] = r.wins
                    else:
                        point[name] = float(r.avg_placement) if r.avg_placement else None
                else:
                    point[name] = None
            data.append(point)

        return {"series": all_series, "data": data}

    else:  # over == "game" — global game number as x-axis, carry forward on absent games
        # Use a CTE to number all games globally, then join only the filtered seats
        rows = db.execute(text(f"""
            WITH global_games AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY played_at, id)::int AS game_num
                FROM games
            )
            SELECT
                {series_col} AS series_key,
                gg.game_num,
                SUM(CASE WHEN gs.placement = 1 THEN 1 ELSE 0 END)
                    OVER (PARTITION BY {series_col} ORDER BY gg.game_num
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::int AS cum_wins,
                AVG(gs.placement)
                    OVER (PARTITION BY {series_col} ORDER BY gg.game_num
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_avg,
                COUNT(gs.id)
                    OVER (PARTITION BY {series_col} ORDER BY gg.game_num
                          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::int AS cum_games
            FROM game_seats gs
            JOIN decks d ON gs.deck_id = d.id
            JOIN users u ON gs.pilot_id = u.id
            JOIN global_games gg ON gs.game_id = gg.id
            {where_sql}
            ORDER BY {series_col}, gg.game_num
        """), params).fetchall()

        # Map: series_key -> {global_game_num -> cumulative value}
        series_at: dict = {}
        for r in rows:
            if metric == "win_rate":
                val = round(r.cum_wins / r.cum_games, 3) if r.cum_games else 0
            elif metric == "games":
                val = r.cum_games
            elif metric == "wins":
                val = r.cum_wins
            else:
                val = round(float(r.running_avg), 2) if r.running_avg else None
            series_at.setdefault(r.series_key, {})[r.game_num] = val

        total_games = db.execute(text("SELECT COUNT(*)::int FROM games")).scalar()
        all_series = sorted(series_at.keys())

        # Build unified data: carry forward last known value when absent
        data = []
        last = {name: None for name in all_series}
        for gn in range(1, total_games + 1):
            point = {"x": gn}
            for name in all_series:
                if gn in series_at[name]:
                    last[name] = series_at[name][gn]
                point[name] = last[name]
            data.append(point)

        return {"series": all_series, "data": data}


@router.get("/query")
def query_stats(
    metric: str = "win_rate",
    dimension: str = "player",
    filter_by: str | None = None,
    filter_value: str | None = None,
    db: Session = Depends(get_db),
):
    if metric not in {"win_rate", "games", "avg_placement", "wins"}:
        raise HTTPException(400, "Invalid metric")
    if dimension not in {"player", "deck", "colour", "identity", "month"}:
        raise HTTPException(400, "Invalid dimension")

    params = {"excl1": EXCLUDED_PLAYERS[0], "excl2": EXCLUDED_PLAYERS[1]}
    base_where = "u.name NOT IN (:excl1, :excl2)"
    filter_where = ""

    if filter_by and filter_value:
        if filter_by == "player":
            filter_where = "AND u.name = :fv"
            params["fv"] = filter_value
        elif filter_by == "colour":
            filter_where = "AND :fv = ANY(d.color_identity)"
            params["fv"] = filter_value.upper()
        elif filter_by == "deck":
            filter_where = "AND d.commander = :fv"
            params["fv"] = filter_value
        elif filter_by == "date_from":
            filter_where = "AND g.played_at >= :fv"
            params["fv"] = filter_value
        elif filter_by == "date_to":
            filter_where = "AND g.played_at <= :fv"
            params["fv"] = filter_value

    where_sql = f"WHERE {base_where} {filter_where}"

    metric_sql = {
        "win_rate": "ROUND(SUM(CASE WHEN gs.placement = 1 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(gs.id), 0), 3)",
        "games": "COUNT(gs.id)::int",
        "wins": "SUM(CASE WHEN gs.placement = 1 THEN 1 ELSE 0 END)::int",
        "avg_placement": "ROUND(AVG(gs.placement)::numeric, 2)",
    }[metric]

    # Colour / identity: fetch per-deck rows and aggregate in Python
    if dimension in ("colour", "identity"):
        raw = db.execute(text(f"""
            SELECT
                d.color_identity,
                COUNT(gs.id)::int AS games,
                SUM(CASE WHEN gs.placement = 1 THEN 1 ELSE 0 END)::int AS wins,
                COALESCE(AVG(gs.placement), 0)::float AS avg_placement
            FROM game_seats gs
            JOIN decks d ON gs.deck_id = d.id
            JOIN users u ON gs.pilot_id = u.id
            JOIN games g ON gs.game_id = g.id
            {where_sql}
            GROUP BY d.id, d.color_identity
        """), params).fetchall()

        buckets = {}
        identity_map = {}  # label -> sorted color list (for identity dimension)
        for r in raw:
            identity = sorted(r.color_identity or [])
            if dimension == "colour":
                keys = identity if identity else ["C"]
            else:
                key = "".join(identity) or "C"
                keys = [key]
                if key not in identity_map:
                    identity_map[key] = identity

            for key in keys:
                if key not in buckets:
                    buckets[key] = {"games": 0, "wins": 0, "total_placement": 0.0}
                buckets[key]["games"] += r.games
                buckets[key]["wins"] += r.wins
                buckets[key]["total_placement"] += r.avg_placement * r.games

        result = []
        for label, v in buckets.items():
            if metric == "win_rate":
                val = round(v["wins"] / v["games"], 3) if v["games"] else 0
            elif metric == "games":
                val = v["games"]
            elif metric == "wins":
                val = v["wins"]
            else:
                val = round(v["total_placement"] / v["games"], 2) if v["games"] else None

            entry = {"label": label, "value": val, "games": v["games"]}
            if dimension == "identity":
                entry["color_identity"] = identity_map.get(label, [])
            result.append(entry)

        if dimension == "colour":
            result.sort(key=lambda x: COLOUR_ORDER.index(x["label"]) if x["label"] in COLOUR_ORDER else 99)
        else:
            result.sort(key=lambda x: x["value"] or 0, reverse=(metric != "avg_placement"))

        return result

    # SQL GROUP BY for player / deck / month
    if dimension == "player":
        group_select = "u.name AS label"
        group_by = "u.name"
        order_by = "value DESC NULLS LAST"
    elif dimension == "deck":
        group_select = "d.commander AS label"
        group_by = "d.commander"
        order_by = "value DESC NULLS LAST"
    else:  # month
        group_select = "TO_CHAR(DATE_TRUNC('month', g.played_at), 'Mon YYYY') AS label, DATE_TRUNC('month', g.played_at) AS sort_key"
        group_by = "DATE_TRUNC('month', g.played_at)"
        order_by = "sort_key ASC"

    sql = f"""
        SELECT {group_select}, {metric_sql} AS value, COUNT(gs.id)::int AS games
        FROM game_seats gs
        JOIN decks d ON gs.deck_id = d.id
        JOIN users u ON gs.pilot_id = u.id
        JOIN games g ON gs.game_id = g.id
        {where_sql}
        GROUP BY {group_by}
        ORDER BY {order_by}
    """

    rows = db.execute(text(sql), params).fetchall()
    return [
        {"label": r.label, "value": float(r.value) if r.value is not None else None, "games": r.games}
        for r in rows
    ]
