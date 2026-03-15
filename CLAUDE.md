# MTG Commander Tracker — Project Overview

Single-user Commander (EDH) game tracker for a regular playgroup. Tracks decks, games, pilots, and win rates. No authentication.

## Stack

| Layer | Tech |
|-------|------|
| Backend | FastAPI (Python), SQLAlchemy ORM, raw SQL for complex queries |
| Database | PostgreSQL (Railway managed) |
| Frontend | React + Vite, CSS Modules, React Query, Framer Motion, Recharts |
| Deployment | Both services on Railway; frontend served as static SPA via `serve -s` |

## Repo Structure

```
mtg/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, router registration
│   │   ├── database.py          # SQLAlchemy engine + session
│   │   ├── models/
│   │   │   ├── user.py          # User (player)
│   │   │   ├── deck.py          # Deck
│   │   │   └── game.py          # Game + GameSeat
│   │   └── routers/
│   │       ├── players.py       # /api/players
│   │       ├── decks.py         # /api/decks
│   │       ├── games.py         # /api/games
│   │       └── stats.py         # /api/stats/*
│   └── scripts/
│       └── migrate_player_flags.py  # One-off migration: add show_as_brewer, include_in_data
├── frontend/
│   ├── src/
│   │   ├── api.js               # All fetch calls to the backend
│   │   ├── App.jsx              # Routes + nav
│   │   ├── pages/
│   │   │   ├── DecksPage.jsx
│   │   │   ├── DeckDetailPage.jsx
│   │   │   ├── GamesPage.jsx
│   │   │   ├── PlayersPage.jsx
│   │   │   ├── PlayerDetailPage.jsx
│   │   │   └── StatsPage.jsx
│   │   └── components/
│   │       ├── AddDeckModal.jsx      # Create + edit decks
│   │       ├── AddGameModal.jsx      # Create + edit games
│   │       ├── AddPlayerModal.jsx    # Create + edit players
│   │       ├── ColorPips.jsx
│   │       └── DeckCard.jsx
│   └── railway.toml             # Build: npm run build / Start: serve dist -s -p $PORT
└── CLAUDE.md
```

## Database Schema (key tables)

### `users`
Players in the group.
- `id`, `name`, `created_at`
- `show_as_brewer` (bool, default true) — appears in brewer dropdown when adding a deck
- `include_in_data` (bool, default true) — included in stats and player leaderboard

### `decks`
- `id`, `name`, `commander`, `color_identity` (text[]), `commander_cmc`
- `builder_id` → users.id
- `budget` (Precon/Budget/Standard/Optimized/cEDH)
- `strategy` (text[]) — e.g. ['Combo', 'Graveyard']
- `active` (bool) — toggle on deck detail page
- `image_uri` — fetched from Scryfall on create/commander change

### `games`
- `id`, `played_at`, `notes`

### `game_seats`
One row per player per game.
- `game_id`, `deck_id`, `pilot_id` → users.id, `placement` (int, 1=win), `victory_condition`

## API Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | /api/players | `?brewers_only=true`, `?include_all=true` |
| POST | /api/players | `{ name, show_as_brewer, include_in_data }` |
| PATCH | /api/players/:id | Partial update of name/flags |
| GET | /api/players/:id | Full profile with pilot/brewer stats |
| GET | /api/decks | Paginated, filterable |
| POST | /api/decks | Creates deck, fetches Scryfall image |
| PATCH | /api/decks/:id | Partial update; re-fetches image if commander changes |
| GET | /api/decks/:id | Detail with pilots, recent games, opponents |
| GET | /api/games | Paginated |
| POST | /api/games | `{ played_at, seats: [{ deck_id, pilot_id, placement, victory_condition }] }` |
| PATCH | /api/games/:id | Update date/notes; if seats provided, replaces all seats |
| GET | /api/stats/query | Metric × dimension bar chart data |
| GET | /api/stats/timeseries | Cumulative metric over time (by game or by month) |

## Key Design Decisions

- **No Alembic**: migrations are one-off scripts in `backend/scripts/`. Run them with `DATABASE_URL=<prod_url> python backend/scripts/<script>.py`.
- **Stats use raw SQL**: complex window functions and LATERAL joins for cumulative timeseries; SQLAlchemy ORM used elsewhere.
- **SPA routing**: Railway serves frontend with `serve dist -s` — the `-s` flag is critical for client-side routing to work on page refresh.
- **CORS**: `main.py` explicitly lists allowed origins — add new frontend URLs there.
- **Player exclusions**: "Random" and "Precon" are hardcoded excluded names (used for tracking games where a seat was played by a non-regular). `include_in_data=false` is the proper flag for other exclusions.
- **Scryfall**: commander images and colour identity are fetched from `api.scryfall.com/cards/named?fuzzy=` on deck create/edit.

## Deployment

Both backend and frontend are Railway services in project **pretty-endurance**.

To deploy: `git push` — Railway autodeploys from the `main` branch on GitHub (`lvlupjordan/mtg`).

To run a migration against production:
```bash
DATABASE_URL="<public_postgres_url>" python backend/scripts/<migration>.py
```
Public Postgres URL is in Railway → Postgres service → Connect tab.

## Design Aesthetic

Dark fantasy / arcane theme. Key CSS variables in `index.css`:
- `--gold`, `--gold-light`, `--gold-dim` — primary accent
- `--win` (teal), `--loss` (red), `--neutral` (grey)
- Fonts: **Cinzel** (headings/labels), **Crimson Pro** (body)
- All pages use CSS Modules

## Console Version Log

`frontend/src/main.jsx` logs `MTG Tracker vX.Y` on load — bump this when deploying to confirm the new build is live.
