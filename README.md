# 🐍 SnakeCoin P2E — Play-to-Earn on Polygon

> Gagnez des tokens ERC-20 **$SNAKE** en jouant au Snake, mintez des trophées NFT on-chain à chaque saison.
> Backend Node.js + Express sur Railway, frontend static HTML/JS sur snowdiablo.xyz, contracts déployés sur Polygon mainnet.

**Live:** [snowdiablo.xyz](https://snowdiablo.xyz) · **Hall of Fame:** [snowdiablo.xyz/hall-of-fame.html](https://snowdiablo.xyz/hall-of-fame.html) · **Collection NFT:** [OpenSea](https://opensea.io/collection/snakecoin-trophy)

---

## ✨ Features

### Gameplay
- 🎮 Snake classique web (clavier + touch/swipe mobile)
- 🏆 Score anti-cheat backend (ratio points/sec, durée min, caps)
- 🔥 Streaks quotidiens (x1.1 → x2.0 selon la série)
- 📜 Quêtes journalières (reset 00:00 UTC)
- 🥇 Saisons mensuelles + leaderboard + reset auto

### Economy
- 💰 ERC-20 **$SNAKE** claim on-chain (signer-gated mint, anti-replay nonce)
- 🌟 Golden Snake mode (samedi 20h → dimanche 20h UTC, x3 rewards)
- 🏅 NFT Trophées (ERC-721 + EIP-2981 royalties 5%) pour top 10 chaque saison
  - Pricing Chainlink POL/USD : Gold 25$ · Silver 15$ · Bronze 10$ · Top10 5$
  - SVG 3D on-chain + upgradeable renderer + EIP-4906
  - Multiplier permanent $SNAKE : Gold +25% · Silver +15% · Bronze +10% · Top10 +5%

### Communauté
- 💬 Bot Discord (slash commands `/stats` `/topscore` `/wallet` `/link` `/play`)
- 🟣 Bot Twitch (commands `!snake` `!top` `!me` `!quests` + auto-shoutout claims)
- 🦋 Bot Bluesky (auto-post records all-time + whale alerts + golden windows + NFT mints)
- 📢 Channel Discord public `#snake-feed` avec embeds live
- 🛡️ Holder role Discord auto-assigné selon balance on-chain

### Admin / Ops
- 🔐 Dashboard admin privé (token-gated) : stats, croissance, export CSV, golden toggle
- 📊 Analytics Umami Cloud
- 📈 Monitoring Uptime Kuma + alertes Discord
- 💾 Backup auto SQLite (cron + Railway Volume)
- 🔁 CI/CD GitHub Actions → FTP auto-deploy (frontend) + Railway auto-redeploy (backend)
- 🌍 **i18n 13 langues** (fr, en, es, pt, de, it, ru, zh, ja, ko, ar, tr) avec re-render dynamique

---

## 🧱 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         snowdiablo.xyz                               │
│  (Frontend static — OVH / WebHostOp via FTP CI/CD)                   │
│  • index.html · hall-of-fame.html · admin.html                       │
│  • ethers.js v6 + WalletConnect v2 + MetaMask/Rabby/Phantom/Brave    │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│          snake-backend (Railway — Node 20 + Express)                 │
│  • REST API (sessions, claim, NFT, streaks, quêtes, golden, admin)   │
│  • SQLite (Railway Volume persistant)                                │
│  • Signer wallet (génère sig EIP-191 pour claim on-chain)            │
│  • Anti-cheat (score/duration/ratio)                                 │
│  • Rate-limits (per-IP + per-route)                                  │
│  • Wallet ownership proof (EIP-191) sur actions sensibles            │
│  • Webhooks Discord + Twitch IRC + Bluesky atproto                   │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │ ethers.js
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Polygon mainnet                                │
│  • SnakeCoin (ERC-20) — signer-gated claim                           │
│  • SnakeTrophyNFT (ERC-721) — signer-gated mint + Chainlink pricing  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│         discord-bot-snacke (VPS Debian — pm2 + systemd)              │
│  • discord.js v14 (slash commands + holder role sync)                │
│  • Twitch IRC (WebSocket raw)                                        │
│  • Bluesky (atproto REST)                                            │
│  • On-chain Transfer watcher → feed public + role sync auto          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Smart contracts (Polygon mainnet)

| Contract          | Standard        | Address               | Polygonscan |
|-------------------|-----------------|-----------------------|-------------|
| $SNAKE token      | ERC-20          | `$CONTRACT_ADDRESS`   | [voir](https://polygonscan.com/address/) |
| SnakeTrophyNFT    | ERC-721 + 2981  | `$NFT_CONTRACT_ADDRESS` | [voir](https://polygonscan.com/address/) |

Les trophées NFT sont **visibles + achetables** sur :
- [OpenSea](https://opensea.io/) — filtrer par contract address
- [Rarible](https://rarible.com/) — idem
- [Polygonscan NFT tab](https://polygonscan.com/) — vue read-only on-chain
- [Blur](https://blur.io/) (si re-listé par holder)

Tous les trophées sont aussi prévisualisables directement sur [snowdiablo.xyz](https://snowdiablo.xyz) dans la section "Mes Trophées" une fois le wallet connecté.

---

## 🗂️ Repo structure

```
snake-backend/
├── server.js                 # Express API principal
├── index.html                # Frontend (jeu + claim + NFT + i18n)
├── admin.html                # Dashboard admin (token-gated)
├── hall-of-fame.html         # Leaderboard public
├── nft_trophy_preview.html   # Preview SVG trophées
├── discord-bot-snacke/       # Bot Discord (VPS)
│   ├── bot.js
│   ├── register-commands.js
│   └── deploy.sh
├── nft_assets/               # SVG + metadata IPFS
├── NFT_TROPHY_DEPLOY.md      # Guide deploy Polygon
├── BLUESKY_SETUP.md          # Setup bot Bluesky
├── TWITCH_BOT_SETUP.md       # Setup bot Twitch
└── .github/workflows/        # CI/CD FTP
```

---

## 🚀 Quickstart (dev local)

### Prérequis
- Node.js 20+
- Wallet Polygon + qq MATIC pour gas
- Alchemy / Infura RPC key

### Install + run
```bash
git clone https://github.com/SNOWDIABLO/snake-backend.git
cd snake-backend
npm install
cp .env.example .env
# → éditer .env (SIGNER_PK, CONTRACT_ADDRESS, etc.)
node server.js
```

Frontend servi directement depuis le même Express (static) ou via n'importe quel HTTP server en pointant `BACKEND_URL` dans `index.html` vers l'API.

---

## ⚙️ Environment variables

| Var                       | Default             | Description |
|---------------------------|---------------------|-------------|
| `SIGNER_PK`               | *(requis)*          | Clé privée du signer backend (EIP-191) |
| `CONTRACT_ADDRESS`        | —                   | Adresse du token $SNAKE ERC-20 |
| `NFT_CONTRACT_ADDRESS`    | —                   | Adresse du contract SnakeTrophyNFT |
| `DB_PATH`                 | `snake.db`          | Chemin SQLite (Railway Volume en prod) |
| `DAILY_LIMIT`             | `100`               | Cap claim $SNAKE / wallet / jour |
| `MAX_PER_SESSION`         | `50`                | Cap reward par session |
| `MIN_SESSION_SEC`         | `3`                 | Anti-cheat : durée min |
| `MAX_PTS_PER_SEC`         | `5`                 | Anti-cheat : ratio max |
| `MIN_SESSION_GAP`         | `2`                 | Anti-cheat : délai entre sessions |
| `ADMIN_TOKEN`             | —                   | Bearer token pour routes `/api/admin/*` |
| `REQUIRE_WALLET_PROOF`    | `0` (warn)          | `1` = rejette claim/mint sans proof EIP-191 |
| `PROOF_MAX_AGE_SEC`       | `300`               | Fenêtre validité signature proof |
| `DISCORD_WEBHOOK`         | —                   | Webhook staff (cheat + claim notifs) |
| `PUBLIC_FEED_WEBHOOK`     | —                   | Webhook #snake-feed (records + whales) |
| `BSKY_HANDLE`             | —                   | Bot Bluesky handle |
| `BSKY_APP_PASSWORD`       | —                   | App password Bluesky |
| `TWITCH_CHANNEL`          | —                   | Channel Twitch (bot) |
| `TWITCH_USERNAME`         | —                   | Bot username |
| `TWITCH_OAUTH`            | —                   | `oauth:xxx` token IRC |

---

## 🛡️ Security model

- **EIP-191 ownership proof** (task #56) sur `/api/claim` + `/api/nft/mint-sig` + Discord `/link`
  - Client fetch `GET /api/proof/challenge?action=Claim&address=0x...`
  - Client signe le message retourné via `personal_sign`
  - Serveur vérifie `ethers.verifyMessage()` + timestamp <5min + nonce anti-replay
- **Rate-limits per-IP** :
  - `/api/claim` + `/api/nft/mint-sig` : 10/h
  - `/api/nft/eligibility` + `/api/nft/multiplier` : 60/min
  - `/api/proof/challenge` : 20/min
- **Anti-cheat server-side** : ratio points/sec, durée min, score cap, gap min entre sessions
- **Admin token** Bearer auth sur `/api/admin/*` (dashboard + CSV + stats paginées)
- **Wallet redaction** dans les logs (`shortAddr()` partout)
- **CORS restricté** aux origines trusted (snowdiablo.xyz + localhost)
- **helmet** + `trust proxy` = 1 (Railway)
- **Signer-gated contracts** : seul le wallet backend peut signer les claims/mints (revocable via `setSigner()`)
- **Anti-replay on-chain** : mapping `usedNonces` dans les contracts

---

## 📡 API endpoints

### Public
- `GET  /health` — ping
- `POST /api/session/start` — créer session jeu
- `POST /api/session/end` — valider score (anti-cheat)
- `POST /api/claim` — demander signature claim $SNAKE (proof EIP-191)
- `GET  /api/proof/challenge?action=...&address=...` — challenge ownership
- `GET  /api/nft/eligibility/:address` — liste trophées mintables
- `GET  /api/nft/multiplier/:address` — badge multiplier courant
- `POST /api/nft/mint-sig` — signature mint NFT (proof EIP-191)
- `POST /api/nft/confirm` — confirmer tx on-chain
- `GET  /api/streak/:address` — streak info
- `GET  /api/quests/:address` — quêtes du jour
- `GET  /api/events/golden` — état golden snake
- `GET  /api/stats` — stats globales

### Admin (Bearer token)
- `GET  /api/admin/stats?top_limit=&top_offset=&claims_limit=&claims_offset=`
- `GET  /api/admin/growth?days=30`
- `GET  /api/admin/export/{claims,sessions,scores}.csv`
- `POST /api/admin/events/golden/toggle`
- `POST /api/admin/seasons/close`

---

## 🚢 Deploy

### Backend (Railway)
```bash
# Push sur main → Railway redeploy auto
git push origin main
```

### Frontend (FTP WebHostOp)
GitHub Actions (`.github/workflows/ftp.yml`) déploie automatiquement à chaque push sur main :
- `index.html`, `admin.html`, `hall-of-fame.html` → root snowdiablo.xyz

### Contracts
Voir [`NFT_TROPHY_DEPLOY.md`](./NFT_TROPHY_DEPLOY.md) pour la procédure complète (Remix + verify Polygonscan + config env vars Railway).

---

## 📜 License

MIT — voir [LICENSE](./LICENSE).

---

## 🤝 Contact

- **Streamer / créateur** : [@SnowDiablo](https://twitch.tv/snowdiablo)
- **Issues & PR** : bienvenues sur GitHub
- **Discord** : rejoins le serveur via le bouton sur snowdiablo.xyz
