# SnowDiablo Arcade — Frontend v2

Multi-games crypto arcade portal. Vite + vanilla JS + cosmic dark theme.

## Stack

- **Vite 5.4** — multi-page build, ES modules, zero framework
- **Vanilla JS** — no React / Vue. Canvas games don't need VDOM.
- **CSS custom properties** — theme tokens shared across all pages
- **ethers@6 + WalletConnect v2** — UMD loaded on-demand (lazy)

## Structure

```
frontend-v2/
├── index.html              # HUB — landing + 7 game cards
├── snake/                  # Snake game (LIVE via v1 link; v2 port WIP)
├── pong/                   # Coming soon
├── flappy/                 # Coming soon
├── space-invaders/         # Coming soon
├── breakout/               # Coming soon
├── minesweeper/            # Coming soon
├── 2048/                   # Coming soon
├── leaderboard/            # Top 100 (game filter)
├── profile/                # User profile (wallet-gated)
├── lp-fund/                # LP Fund public tracker
├── src/
│   ├── theme.css           # Cosmic palette + reset + utilities (import everywhere)
│   ├── header.js           # Shared nav + wallet button (mounts into #hdr)
│   ├── footer.js           # Shared footer with socials (mounts into #ftr)
│   ├── wallet.js           # ethers@6 + WalletConnect v2, onWalletChange event bus
│   ├── api.js              # Backend fetch wrapper (Railway)
│   ├── stats.js            # Live /api/stats poller (30s)
│   ├── i18n.js             # Translation loader (13 langs, reserved for future)
│   ├── main-hub.js         # Entry for /
│   ├── main-soon.js        # Entry for all 6 "coming soon" pages
│   ├── main-leaderboard.js # Entry for /leaderboard/
│   ├── main-profile.js     # Entry for /profile/
│   └── main-lpfund.js      # Entry for /lp-fund/
├── public/
│   └── locales/            # Translation JSON files (en, fr, ...)
├── vite.config.js          # Multi-page config, 11 entries, manualChunks
└── package.json
```

## Dev

```bash
npm install
npm run dev        # Vite dev server on :5173 with HMR
```

## Build

```bash
npm run build      # output → dist/
npm run preview    # serve dist/ on :4173
```

## Deploy

The `dist/` folder is a static site — deploy to any host that serves HTML.

Current production host: **WebHostOp FTP** via GitHub Actions (`.github/workflows/deploy-ftp.yml`).
The workflow should be updated to `npm run build` then upload `frontend-v2/dist/*` instead of the legacy single `index.html`.

### ⚠️ OneDrive lock

Ne JAMAIS `vite build` directement depuis le dossier OneDrive — `emptyOutDir` échoue
(`Operation not permitted` sur dist/). Solution :

1. CI build via GitHub Actions (recommandé)
2. Ou : cloner hors-OneDrive (`C:\dev\snake-backend\frontend-v2`) et build là
3. En local dev (`npm run dev`) : fonctionne direct, pas de emptyOutDir impliqué

## Backend

All pages hit: `https://snake-backend-production-e5e8.up.railway.app`
Hardcoded in `src/api.js` — change in one place to repoint.

## Adding a new game

1. Create folder: `frontend-v2/my-game/index.html`
2. Add entry to `vite.config.js` → `rollupOptions.input`
3. Create entry module: `frontend-v2/src/main-my-game.js` that imports `theme.css` + calls `initHeader()` + `initFooter()`
4. Link in HTML: `<script type="module" src="/src/main-my-game.js"></script>`
5. Add card to `/index.html` games-grid
6. Add nav entry to `src/header.js` NAV array
7. Add backend support: `game` param in `/api/session/start` + column in sessions/claims tables

## Shared token economy

All games share:
- One $SNAKE token
- One leaderboard (game filter)
- One wallet connection
- One boost NFT inventory (applies across games)
- One profile
