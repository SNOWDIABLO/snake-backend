# SnakeCoin P2E — Project Overview

**Domain** : [snowdiablo.xyz](https://snowdiablo.xyz)
**Chain** : Polygon Mainnet (chainId 137)
**Stack** : Node/Express + SQLite + ethers.js v6 + vanilla JS frontend
**Status** : Stealth pre-launch (backend 100% ready, attend deploy NFT Boost + DEX LP)

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      snowdiablo.xyz                          │
│                    (WebHostOp — static)                      │
│                  index.html / hall-of-fame.html              │
│                  deploy : GitHub Actions → FTP               │
└───────────────────────────┬──────────────────────────────────┘
                            │ fetch API
                            ▼
┌──────────────────────────────────────────────────────────────┐
│           snake-backend-production-e5e8.up.railway.app       │
│                 Express + better-sqlite3 + ethers            │
│              deploy : git push → Railway webhook             │
│                  persistence : Railway Volume /data          │
└───────────┬────────────────────────────────┬─────────────────┘
            │                                │
            ▼                                ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│   Polygon Mainnet        │     │   Discord + Bluesky      │
│  - $SNAKE ERC-20 token   │     │  - /snake-feed embeds    │
│  - SnakeTrophyNFT (ERC721)│    │  - whale/top auto-post   │
│  - SnakeBoostNFT (pending)│    │  - bot Twitch reacts     │
│  - QuickSwap v3 LP        │    └──────────────────────────┘
└──────────────────────────┘
```

---

## 2. Services stack

| Service | Host | Purpose |
|---|---|---|
| **Backend API** | Railway | Game sessions, claims, tournois, clans, NFT eligibility |
| **Frontend** | WebHostOp (FTP) | Static HTML/JS/CSS |
| **Database** | Railway Volume | SQLite `/data/snake.db` |
| **Discord bot** | VPS (pm2) | `/stats /topscore /play /wallet /link` + webhook feed |
| **Monitoring** | Uptime Kuma (VPS) | Endpoint checks + alertes Discord |
| **Analytics** | Umami Cloud | Page views + events snowdiablo.xyz |
| **RPC provider** | Alchemy / llamarpc (fallback) | Polygon read/write |
| **IPFS pin** | Pinata | NFT trophy metadata 4 tiers |

---

## 3. Contracts Polygon

| Contract | Address | Purpose |
|---|---|---|
| `$SNAKE` ERC-20 | `0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1` | Reward token |
| `SnakeTrophyNFT` | `0xda4167D97caAa90DAf5510bcE338a90134BBdfA9` | Top 10 saison NFT tiered (Gold/Silver/Bronze/Top10) |
| `SnakeBoostNFT` | _à deployer_ | Marketplace boost NFT 4 tiers |
| `QuickSwap v3 LP` | _à créer day-of launch_ | $SNAKE / WPOL pair |

Deployer/signer wallet : `0xFca2595d1EE2d2d417f6e404330Ca72934054fc9`

---

## 4. Features (user-facing)

- **Snake gameplay** HTML5 canvas, touch/swipe mobile, keyboard desktop
- **13 langues** : FR/EN/ES/PT/DE/IT/RU/ZH/JA/KO/AR/TR (+ secondary via i18n)
- **Claim $SNAKE** : 10 points = 1 $SNAKE, limite 100/jour/wallet
- **NFT trophies** : snapshot top 10 en fin de saison, mint gated par signer
- **NFT boosts** : 4 tiers payables en POL ou $SNAKE burn, +10/20/35/75% reward
- **Streaks quotidiens** : bonus jusqu'à x1.5 après 7 jours consécutifs
- **Quêtes journalières** : 3 quests rotatives reset à minuit
- **Golden snake mode** : event hebdo x2 rewards
- **Saisons** : leaderboard reset + NFT drops top 10
- **Tournois 24h** : entry 1 POL, payout top 3 (40/20/10% + 30% project)
- **Clans/Guildes** : create 1000 $SNAKE burn, max 10 membres, payout weekly top 3 (50/30/20%)
- **Pseudo wallet-linked** : gratuit/mois OU 1000 $SNAKE burn permanent
- **Hall of Fame** : leaderboard top 100 all-time, tags clan affichés

---

## 5. Anti-cheat + sécu

- Score max/sec validé server-side (task #9)
- EIP-191 signMessage proof pour actions sensibles (clan create/join, etc.)
- Idempotency via UNIQUE index sur `paid_tx` / `burn_tx` / `session_id`
- Rate-limit express (trust proxy=1 pour Railway)
- Fail2ban SSH + UFW firewall sur VPS bot
- Auto-backup SQLite quotidien + rotation 7j
- Secrets : .env local (.gitignored) + Railway env vars chiffrées

---

## 6. Env vars Railway

```bash
# Core
POLYGON_RPC=https://polygon-rpc.com
CONTRACT_ADDRESS=0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1
SIGNER_PK=0x...                        # deployer wallet PK
DB_PATH=/data/snake.db
DAILY_LIMIT=100
MAX_PER_SESSION=10

# NFT Trophy
NFT_CONTRACT_ADDRESS=0xda4167D97caAa90DAf5510bcE338a90134BBdfA9
NFT_MULTIPLIER_ENABLED=1

# NFT Boost (à activer post-deploy)
BOOST_NFT_ADDRESS=                      # après deploy contract
BOOST_ENABLED=0
BOOST_FEE_BPS=3000

# Tournois 24h
TOURNAMENT_ENABLED=1
TOURNAMENT_ENTRY_POL=1
TOURNAMENT_DURATION_H=24
TOURNAMENT_PAYOUT_WALLET=0xFca2595d1EE2d2d417f6e404330Ca72934054fc9
TOURNAMENT_MIN_CONFIRMATIONS=2

# Clans
CLAN_ENABLED=1
CLAN_CREATE_BURN_AMOUNT=1000
CLAN_MAX_MEMBERS=10
CLAN_WEEKLY_POOL_SNAKE=10000

# Integrations
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
PUBLIC_FEED_WEBHOOK=https://discord.com/api/webhooks/...
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
TWITCH_CHANNEL=snowdiablo
```

---

## 7. Deploy workflow

### Backend (server.js)
```powershell
cd "$env:USERPROFILE\OneDrive\claude creation\snake-backend-git"
Copy-Item "..\snake-backend\server.js" ".\server.js" -Force
git add server.js
git commit -m "feat: ..."
git push origin main
# → Railway auto-deploy via webhook (~90s)
```

### Frontend (index.html + hall-of-fame.html)
```powershell
cd "$env:USERPROFILE\OneDrive\claude creation\snake-backend-git"
Copy-Item "..\snake-backend\index.html" ".\index.html" -Force
Copy-Item "..\snake-backend\hall-of-fame.html" ".\hall-of-fame.html" -Force
git add index.html hall-of-fame.html
git commit -m "feat(ui): ..."
git push origin main
# → GitHub Actions FTP → WebHostOp (~60s)
```

### Pre-push checks
```powershell
# Syntaxe Node server.js
node --check "$env:USERPROFILE\OneDrive\claude creation\snake-backend\server.js"
# doit return silencieux (0 byte output) = OK
```

---

## 8. Smoke tests post-deploy

```powershell
$API = "https://snake-backend-production-e5e8.up.railway.app"

# Core
Invoke-RestMethod "$API/api/health" | ConvertTo-Json
Invoke-RestMethod "$API/api/leaderboard?limit=5" | ConvertTo-Json -Depth 4

# Tournament
Invoke-RestMethod "$API/api/tournament/current" | ConvertTo-Json -Depth 4
Invoke-RestMethod "$API/api/tournament/leaderboard" | ConvertTo-Json -Depth 4

# Clans
Invoke-RestMethod "$API/api/clan/list" | ConvertTo-Json -Depth 4

# NFT
Invoke-RestMethod "$API/api/nft/eligibility?wallet=0xFca2595d1EE2d2d417f6e404330Ca72934054fc9" | ConvertTo-Json

# Boost (quand activé)
Invoke-RestMethod "$API/api/boost/catalog" | ConvertTo-Json -Depth 4
```

---

## 9. Monitoring endpoints (Uptime Kuma)

```
https://snake-backend-production-e5e8.up.railway.app/api/health
https://snake-backend-production-e5e8.up.railway.app/api/leaderboard
https://snake-backend-production-e5e8.up.railway.app/api/tournament/current
https://snake-backend-production-e5e8.up.railway.app/api/clan/list
https://snake-backend-production-e5e8.up.railway.app/api/boost/catalog
https://snake-backend-production-e5e8.up.railway.app/api/nft/eligibility?wallet=0x0
https://snowdiablo.xyz/
https://snowdiablo.xyz/hall-of-fame.html
```

Alertes Discord webhook si un endpoint down > 30s.

---

## 10. Fichiers clés repo

| Fichier | Rôle |
|---|---|
| `server.js` | Backend Express complet (~3500 lignes) |
| `index.html` | Frontend principal avec game + UI |
| `hall-of-fame.html` | Leaderboard top 100 standalone |
| `contracts/SnakeTrophyNFT.sol` | NFT saisonnier on-chain SVG |
| `contracts/SnakeBoostNFT.sol` | NFT boost marketplace (pending deploy) |
| `.env.production` | Template env vars (NE PAS commit avec secrets) |
| `DEPLOY_TOURNAMENTS_CLANS.md` | Runbook activation tournois + clans |
| `DEPLOY_BOOST_NFT.md` | Runbook deploy SnakeBoostNFT mainnet |
| `DEPLOY_DEX_LIQUIDITY.md` | Runbook QuickSwap v3 LP + UNCX lock |
| `LAUNCH_DAY_RUNBOOK.md` | Séquence T-7j à H+24h du reveal public |
| `ADMIN_RUNBOOK.md` | Procédures ops + backup + disaster recovery |

---

## 11. Roadmap actuelle

### ✅ Completed (94/95 tasks)
- Stack backend 100% live (tournaments + clans + NFT trophy + boost backend)
- Frontend UI complete (accordions, i18n 13 langs, mobile, touch)
- Monitoring + CI/CD + backups
- Anti-cheat + sécu hardening
- Documentation ops

### ⏳ Pending — stealth reveal day
- **#66** Deploy `SnakeBoostNFT.sol` sur Polygon mainnet → active BOOST_NFT_ADDRESS
- **#65** QuickSwap v3 LP $SNAKE/WPOL + lock UNCX 12mo + renounce ownership

### 🔮 Post-launch ideas
- Seasonal tournament (weekly, entry 5 POL, pool 100+ POL)
- Cross-chain bridge (Arbitrum? Base?)
- Mobile PWA (Add to Home Screen)
- Founder's Edition NFT limited supply après 1000 mints boost
- Referral program (5% des rewards du filleul)
- Integration wallet providers supplémentaires (Rabby, Coinbase Wallet)

---

## 12. KPIs cibles J+7 post-launch

| Métrique | Cible |
|---|---|
| DAU (daily active users) | 500+ |
| Volume DEX 24h | $50k+ |
| Holders $SNAKE | 500+ |
| Discord members | 2000+ (J+14) |
| Top trophy mints | 50+ (J+30) |
| Boost NFT mints | 100+ (J+30) |

---

## 13. Contacts

- **Owner** : SnowDiablo ([@snowdiablo](https://twitch.tv/snowdiablo) on Twitch)
- **Repo** : GitHub private (snake-backend)
- **Production backend** : Railway dashboard
- **Frontend host** : WebHostOp cPanel
- **Support community** : Discord `#snake-help`

---

**Last update** : 2026-04-20
**Backend version** : commit `9ce15ef` + hotfix API_BASE → BACKEND_URL (pending push)
