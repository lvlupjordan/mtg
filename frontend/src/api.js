const BASE = import.meta.env.VITE_API_URL || "https://mtg-production-88a3.up.railway.app";

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.status === 204 || res.headers.get("content-length") === "0") return null;
  return res.json();
}

export const api = {
  decks: (params = {}) => {
    const { colours, ...rest } = params;
    const qs = new URLSearchParams(rest);
    if (colours?.length) qs.set("colours", colours.join(","));
    return req(`/api/decks?${qs.toString()}`);
  },
  deck: (id) => req(`/api/decks/${id}`),
  createDeck: (body) => req("/api/decks", { method: "POST", body: JSON.stringify(body) }),
  patchDeck: (id, body) => req(`/api/decks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  players: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
    return req(`/api/players${qs ? `?${qs}` : ""}`)
  },
  createPlayer: (body) => req("/api/players", { method: "POST", body: JSON.stringify(body) }),
  patchPlayer: (id, body) => req(`/api/players/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  player: (id) => req(`/api/players/${id}`),

  createGame: (body) => req("/api/games", { method: "POST", body: JSON.stringify(body) }),
  patchGame: (id, body) => req(`/api/games/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  games: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/games${qs ? `?${qs}` : ""}`);
  },
  game: (id) => req(`/api/games/${id}`),

  tierlists: () => req("/api/tierlists"),
  tierlist: (userId) => req(`/api/tierlists/${userId}`),
  saveTierlist: (userId, tiers) => req(`/api/tierlists/${userId}`, { method: "PUT", body: JSON.stringify({ tiers }) }),

  // Cards
  searchCardsLocal: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString();
    return req(`/api/cards${qs ? `?${qs}` : ""}`);
  },
  searchScryfall: (q) => req(`/api/cards/scryfall?q=${encodeURIComponent(q)}`),
  addCardFromScryfall: (card) => req("/api/cards/from-scryfall", { method: "POST", body: JSON.stringify(card) }),

  // Collection
  collection: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString();
    return req(`/api/collection${qs ? `?${qs}` : ""}`);
  },
  collectionTags: (owner_id) => req(`/api/collection/tags${owner_id ? `?owner_id=${owner_id}` : ""}`),
  addToCollection: (body) => req("/api/collection", { method: "POST", body: JSON.stringify(body) }),
  updateCollectionEntry: (id, body) => req(`/api/collection/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteCollectionEntry: (id) => req(`/api/collection/${id}`, { method: "DELETE" }),
  importCollection: (csvFile, ownerId) => {
    const form = new FormData();
    form.append("csv_file", csvFile);
    const url = new URL(`${BASE}/api/collection/import`);
    if (ownerId) url.searchParams.set("owner_id", ownerId);
    return fetch(url.toString(), { method: "POST", body: form })
      .then(res => { if (!res.ok) throw new Error(`${res.status}`); return res.json(); });
  },

  stats: () => req("/api/stats/overview"),
  eloRatings: () => req("/api/stats/elo"),
  statColours: () => req("/api/stats/colours"),
  statsTimeseries: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
    return req(`/api/stats/timeseries${qs ? `?${qs}` : ""}`)
  },
  statsQuery: (params = {}) => {
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))).toString()
    return req(`/api/stats/query${qs ? `?${qs}` : ""}`)
  },
};
