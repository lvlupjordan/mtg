const BASE = import.meta.env.VITE_API_URL || "https://mtg-production-88a3.up.railway.app";

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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

  players: () => req("/api/players"),
  createPlayer: (body) => req("/api/players", { method: "POST", body: JSON.stringify(body) }),
  player: (id) => req(`/api/players/${id}`),

  createGame: (body) => req("/api/games", { method: "POST", body: JSON.stringify(body) }),
  games: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/games${qs ? `?${qs}` : ""}`);
  },
  game: (id) => req(`/api/games/${id}`),

  stats: () => req("/api/stats/overview"),
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
