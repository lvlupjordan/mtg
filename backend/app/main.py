import os
import threading
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import players, decks, games, stats, tierlists, cards, collection
from app import composition

app = FastAPI(title="MTG Commander Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://heartfelt-essence-production.up.railway.app", "https://www.wooberg.co.uk", "https://wooberg.co.uk"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router)
app.include_router(decks.router)
app.include_router(games.router)
app.include_router(stats.router)
app.include_router(tierlists.router)
app.include_router(cards.router)
app.include_router(collection.router)


@app.on_event("startup")
def _startup():
    # Ensure the composition/bracket schema exists ONCE, at boot — never on the
    # request path. An `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` there takes an
    # ACCESS EXCLUSIVE lock (even as a no-op) that can queue behind the background
    # tagger's long transaction and then block every following query — reads
    # included — stalling the whole app. Running it once at startup, before the
    # tagger begins, keeps DDL off the hot path.
    import logging
    from app.database import SessionLocal
    try:
        db = SessionLocal()
        try:
            composition.ensure_table(db)
        finally:
            db.close()
    except Exception as e:
        logging.getLogger("startup").warning("ensure_table at startup failed: %s", e)

    # Background tagger: tags newly-seen composition cards off the request path.
    # A DB advisory lock single-flights the pass. Set DISABLE_BG_TAGGER=1 to opt
    # out (e.g. local dev against the prod DB).
    if os.getenv("DISABLE_BG_TAGGER"):
        return
    threading.Thread(target=composition.run_background_tagger, daemon=True, name="bg-tagger").start()


@app.get("/health")
def health():
    return {"status": "ok"}
