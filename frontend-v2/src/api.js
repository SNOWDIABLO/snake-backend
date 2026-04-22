/* ===================================================================
   SnowDiablo Arcade — Backend API wrapper
   Shared fetch helper for Railway backend.
   =================================================================== */

export const BACKEND_URL = 'https://snake-backend-production-e5e8.up.railway.app';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, headers = {}, timeout = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  const opts = {
    method,
    headers: {
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    signal: ctrl.signal
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BACKEND_URL}${path}`, opts);
    const txt = await res.text();
    let data;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }

    if (!res.ok) {
      throw new ApiError(
        (data && data.error) || `HTTP ${res.status}`,
        res.status,
        data
      );
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError('Request timeout', 0, null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  // Public
  health:           ()        => request('/health'),
  stats:            ()        => request('/api/stats'),
  leaderboard:      (game)    => request(`/api/leaderboard${game ? `?game=${game}` : ''}`),
  player:           (addr)    => request(`/api/player/${addr}`),
  streak:           (addr)    => request(`/api/streak/${addr}`),
  proofChallenge:   (addr)    => request(`/api/proof/challenge?address=${addr}`),

  // NFT
  nftEligibility:   (addr)    => request(`/api/nft/eligibility/${addr}`),
  nftMultiplier:    (addr)    => request(`/api/nft/multiplier/${addr}`),

  // Boost
  boostCatalog:     ()        => request('/api/boost/catalog'),
  boostMultiplier:  (addr)    => request(`/api/boost/multiplier/${addr}`),
  boostInventory:   (addr)    => request(`/api/boost/inventory/${addr}`),
  boostRefresh:     (addr)    => request('/api/boost/refresh', { method: 'POST', body: { address: addr } }),

  // Tournament
  tournamentCurrent:     ()        => request('/api/tournament/current'),
  tournamentLeaderboard: ()        => request('/api/tournament/leaderboard'),
  tournamentEnter:       (payload) => request('/api/tournament/enter', { method: 'POST', body: payload }),

  // Clan
  clanList:         (limit=30) => request(`/api/clan/list?limit=${limit}`),
  clanLeaderboard:  ()         => request('/api/clan/leaderboard'),
  clanMine:         (addr)     => request(`/api/clan/mine/${addr}`),
  clanCreate:       (payload)  => request('/api/clan/create', { method: 'POST', body: payload }),
  clanJoin:         (payload)  => request('/api/clan/join',   { method: 'POST', body: payload }),
  clanLeave:        (payload)  => request('/api/clan/leave',  { method: 'POST', body: payload }),

  // Season / quests
  seasonCurrent:    ()        => request('/api/seasons/current'),
  quests:           (addr)    => request(`/api/quests/${addr}`),

  // Username
  username:         (addr)    => request(`/api/username/${addr}`),
  configFees:       ()        => request('/api/config/fees'),

  // Session flow
  sessionStart: (payload)     => request('/api/session/start', { method: 'POST', body: payload }),
  sessionEnd:   (payload)     => request('/api/session/end',   { method: 'POST', body: payload }),
  claim:        (payload)     => request('/api/claim',         { method: 'POST', body: payload })
};

export { ApiError };
