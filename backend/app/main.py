from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import players, decks, games, stats

app = FastAPI(title="MTG Commander Tracker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://heartfelt-essence-production.up.railway.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(players.router)
app.include_router(decks.router)
app.include_router(games.router)
app.include_router(stats.router)


@app.get("/health")
def health():
    return {"status": "ok"}
