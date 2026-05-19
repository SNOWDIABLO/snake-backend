# CLAUDE.md — SnakeCoin ($SNAKE)

> Guide de contexte pour Claude Code. Lis ce fichier **avant** toute modification.
> Projet : jeu Snake skill-based Play-to-Earn sur Polygon Mainnet. Solo dev : SnowDiablo.

---

## 1. Stack

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| Backend     | Node.js 18 + Express + `better-sqlite3` + `ethers@6`                 |
| Frontend    | Vanilla JS + `ethers@6` (UMD) + WalletConnect v2 (EthereumProvider)  |
| Contrats    | Solidity 0.8.x, Hardhat (dossier `contracts/`)                       |
| Hébergement | Backend → VPS Ubuntu 22.04 (PM2 + nginx), `https://api.snowdiablo.xyz` |
|             | Frontend → WebHostOp FTP via GitHub Actions (`.github/workflows/`)   |
| Monitoring  | PM2 (root daemon) + Uptime Kuma + webhooks Discord                   |
| Réseau      | Polygon PoS (chainId 137), RPC `https://polygon.drpc.org`            |

**Base de données** : SQLite (fichier `/var/www/snake-backend/data/snake.db` sur le VPS).
Colonnes `reward`, `total_claimed`, `daily_claims.total` = `REAL` (décimales) — PAS `INTEGER`.

> ⚠️ **Migration 2026-05-19** : projet migré de Railway free tier (volumes coupés) vers VPS perso `65.75.209.135` (même host que `snowdiablo.xyz`). DB Railway non-récupérable → fresh empty start. NFT/tokens onchain intacts.

---

## 2. Contrats Polygon Mainnet

| Contrat              | Adresse                                      | Notes                                         |
|----------------------|----------------------------------------------|-----------------------------------------------|
| $SNAKE (ERC-20)      | `0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1` | 18 decimals, mintable par signer              |
| SnakeTrophyNFT       | `0xda4167D97caAa90DAf5510bcE338a90134BBdfA9` | ERC-721 + EIP-2981, SVG 100% on-chain         |
| SnakeBoostNFT        | `0x0a507FeAD82014674a0160CEf04570F19334E52C` | 3 tiers : Basic 200 bps / Pro 400 / Elite 800 |
| LP Fund wallet       | `0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E` | Public tracker → `/lp-fund.html`              |
| Signer wallet        | `0xFca2595d1EE2d2d417f6e404330Ca72934054fc9` | Paye gas mint + paye gains tournois           |
| Chainlink MATIC/USD  | `0xAB594600376Ec9fD91F8e885dADF0CE036862dE0` | Oracle pour pricing boost NFT                 |
| Burn address         | `0x000000000000000000000000000000000000dEaD` | Clan create + username change fallback        |

Tous **vérifiés** sur Polygonscan.

---

## 3. Structure du repo

```
snake-backend/
├── server.js                    # Backend Express (3500+ lignes, tout dedans)
├── index.html                   # Frontend single-file (game + UI + web3)
├── lp-fund.html                 # Tracker public LP Fund
├── package.json                 # Deps backend uniquement
├── snake.db                     # SQLite local (volume Railway en prod)
├── contracts/                   # Hardhat workspace
│   ├── src/SnakeBoostNFT.sol
│   └── (SnakeCoin.sol + SnakeTrophyNFT.sol côté déploiement legacy)
├── discord-bot-snacke/          # Bot Discord séparé (autre service Railway)
├── bsky-bot/                    # Bot Bluesky (cron → post auto launch/top score)
├── twitch-bot/                  # Bot tmi.js pour chat Twitch
├── launch_graphics/             # PNGs pré-générés pour Reddit/Twitter/Discord
├── .github/workflows/           # FTP deploy frontend → WebHostOp
├── REDDIT_POSTS.md              # Posts Reddit prêts à copier-coller
├── LAUNCH_DAY_RUNBOOK.md        # Procédure launch
├── ADMIN_RUNBOOK.md             # Opérations courantes (close season, events)
└── PROJECT.md                   # Vision + tasks (historique)
```

---

## 4. Commandes

### Backend (local dev)

```bash
npm install
cp .env.example .env    # ⚠️ ne JAMAIS commit .env
npm run dev             # nodemon
npm start               # prod
```

### Contrats

```bash
cd contracts
npm install
npx hardhat compile
npx hardhat run scripts/deploy-boost.js --network polygon
npx hardhat verify --network polygon <ADDRESS> <CTOR_ARGS>
```

### Git — ⚠️ WORKFLOW IMPORTANT

**Ne PAS `git push` depuis `C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\`** — OneDrive lock `.git/objects` et corrompt les commits (`Deletion of directory '.git/objects/00' failed`).

Utiliser un **mirror hors-OneDrive** :

```bash
# Une seule fois
git clone https://github.com/SnowDiablo/snake-backend.git C:\dev\snake-backend

# Workflow : édite dans OneDrive, puis :
robocopy "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend" C:\dev\snake-backend /E /XD node_modules .git /XF .env snake.db secrets.local.ps1 *.local.ps1
cd C:\dev\snake-backend
git add -A
git commit -m "..."
git push origin main
```

### Déploiement

| Cible    | Trigger                                                         | Observations                       |
|----------|-----------------------------------------------------------------|------------------------------------|
| Backend  | `git push main` → SSH VPS → `git pull && pm2 restart`           | Healthcheck : `GET /health`        |
| Frontend | `git push main` → GitHub Actions → FTP                          | `.github/workflows/deploy-ftp.yml` |

**Workflow backend deploy** (depuis le mirror) :

```bash
# 1. Push depuis le mirror C:\dev\snake-backend (après robocopy depuis OneDrive)
git push origin main

# 2. SSH VPS et pull + restart
ssh root@65.75.209.135
cd /var/www/snake-backend && git pull && pm2 restart snake-backend
# Ajouter --update-env si .env a changé : pm2 restart snake-backend --update-env
```

Smoke test post-deploy :

```powershell
iwr https://api.snowdiablo.xyz/health -UseBasicParsing | % Content
iwr https://snowdiablo.xyz/ -UseBasicParsing | % StatusCode   # attend 200
```

URL backend hardcodée dans : `index.html` (`BACKEND_URL`), `hall-of-fame.html` (`API`), `admin.html`, `hub-preview.html`, `discord-bot-snacke/bot.js`, `frontend-v2/src/api.js`. Si l'URL change → patch tous + redeploy frontend FTP.

---

## 5. Variables d'environnement (`.env`)

Essentielles (backend crash sans elles) :

```env
SIGNER_PK=0x...                              # private key wallet signer (gardée SECRET)
CONTRACT_ADDRESS=0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1
NFT_CONTRACT_ADDRESS=0xda4167D97caAa90DAf5510bcE338a90134BBdfA9
BOOST_NFT_ADDRESS=0x0a507FeAD82014674a0160CEf04570F19334E52C
POLYGON_RPC=https://polygon.drpc.org         # ou RPC_URL selon version code
DB_PATH=/var/www/snake-backend/data/snake.db # VPS (ex-Railway `/data/snake.db`)
PORT=3500                                    # port 3000 utilisé par Next.js snowdiablo.xyz
ADMIN_TOKEN=<long random>                    # pour /api/admin/*
```

> ⚠️ **`dotenv` doit être chargé** via `node_args: '-r dotenv/config'` dans `ecosystem.config.js` (PM2). Railway injectait les vars automatiquement ; sur VPS sans dotenv, toutes les vars sont `undefined` → crash `SIGNER_PK manquant`.

Features toggles :

```env
TOURNAMENT_ENABLED=1
TOURNAMENT_DURATION_H=24
TOURNAMENT_ENTRY_POL=1
TOURNAMENT_PAYOUT_WALLET=0xFca2595d1EE2d2d417f6e404330Ca72934054fc9
CLAN_ENABLED=1
CLAN_CREATE_BURN_AMOUNT=1000
CLAN_FEE_WALLET=0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E
USERNAME_FEE_WALLET=0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E
REQUIRE_WALLET_PROOF=1
```

Anti-cheat :

```env
MIN_SESSION_SEC=3        # <3s session = bot
MAX_PTS_PER_SEC=5        # humain pro = 3-4
MIN_SESSION_GAP=2        # 2s entre 2 sessions / wallet
DAILY_LIMIT=100          # $SNAKE max/wallet/24h
MAX_PER_SESSION=50       # $SNAKE max / claim
```

Webhooks :

```env
DISCORD_WEBHOOK=https://discord.com/api/webhooks/.../...
PUBLIC_FEED_WEBHOOK=https://discord.com/api/webhooks/.../...
```

---

## 6. Flow principal : score → claim

```
Frontend                    Backend                    Polygon
   │                           │                          │
   │ POST /api/session/start → │ (crée session UUID)      │
   │ ← { sessionId }           │                          │
   │                           │                          │
   │ ── game loop (client) ──  │                          │
   │                           │                          │
   │ POST /api/session/end   → │ • anti-cheat (pts/sec)   │
   │   { sessionId, score }    │ • pull boost multiplier  │
   │                           │   depuis cache DB        │
   │                           │ • reward =               │
   │                           │   floor((score/10) *     │
   │                           │   streak * golden *      │
   │                           │   nftTrophy * boost      │
   │                           │   * 100) / 100           │
   │ ← { reward, signature,    │ • sign EIP-191           │
   │     nonce }               │                          │
   │                           │                          │
   │ POST /api/claim         → │ • vérif nonce unique DB  │
   │   { sig, nonce }          │ • mint via signer PK     │
   │                           │ ───── tx ──────────────► │
   │ ← { txHash }              │                          │
```

### Formule reward (⚠️ précision décimale critique)

```js
// server.js ~ line 1402
const baseRewardFloat = cappedScore / 10;
const rewardFloat     = baseRewardFloat * multiplier * goldenMult * nftMult * boostMult;
const reward          = Math.min(Math.floor(rewardFloat * 100) / 100, MAX_PER_SESSION);
```

**⚠️ BUG HISTORIQUE** : un double `Math.floor()` écrasait tout boost < +10% pour `score < 500`.
Exemple : `floor(10 * 1.02) = floor(10.2) = 10` → boost +2% disparu.
Fix : arrondi DOWN à 2 décimales (1.02 $SNAKE visible).
**Ne PAS remettre `Math.floor(baseReward * multiplier)`.**

---

## 7. API endpoints (résumé)

### Public

```
GET  /health                         → uptime, db_ok, signer balance
GET  /api/stats                      → claims/games/players/high_score
GET  /api/leaderboard                → top joueurs (score + total_claimed)
GET  /api/player/:address            → profil wallet
GET  /api/streak/:address            → streak daily
GET  /api/proof/challenge            → nonce EIP-191 pour prove wallet
GET  /api/nft/eligibility/:address   → check top-10 saison
GET  /api/nft/multiplier/:address    → multiplier trophy (permanent)
GET  /api/boost/catalog              → 3 tiers + prix POL (Chainlink)
GET  /api/boost/multiplier/:address  → boost NFT actif (lu depuis cache)
GET  /api/boost/inventory/:address   → list NFTs boost du wallet
GET  /api/tournament/current         → tournoi actif + prize pool
GET  /api/tournament/leaderboard     → scores du tournoi
GET  /api/clan/list                  → top clans
GET  /api/clan/leaderboard           → classement semaine
GET  /api/seasons/current            → saison en cours
GET  /api/quests/:address            → quêtes journalières
GET  /api/username/:wallet           → username si set
GET  /api/config/fees                → burn fees clan/username
```

### Signer / gated

```
POST /api/session/start              → démarre session
POST /api/session/end                → finalise + signe reward
POST /api/claim                      → mint via signer, write tx onchain
POST /api/nft/mint-sig               → signe mint trophy/boost
POST /api/nft/confirm                → confirm mint off-chain
POST /api/tournament/enter           → paie 1 POL entry fee
POST /api/clan/create                → burn 1000 $SNAKE → crée clan
POST /api/clan/join                  → rejoint clan
POST /api/boost/refresh              → force refresh cache boost wallet
POST /api/username/set               → free (1x)
POST /api/username/paid-change       → burn 1000 $SNAKE
```

### Admin (Bearer `ADMIN_TOKEN`)

```
GET  /api/admin/backup               → dump SQLite
GET  /api/admin/export/claims.csv
GET  /api/admin/export/sessions.csv
GET  /api/admin/export/scores.csv
GET  /api/admin/growth               → daily cohort stats
GET  /api/admin/stats
POST /api/admin/seasons/close        → clôture saison + auto-mint NFT trophy top 10
POST /api/admin/events/golden/toggle → active x3 temporaire
```

---

## 8. Tables SQLite

| Table                   | Rôle                                                       |
|-------------------------|------------------------------------------------------------|
| `sessions`              | Session UUID → score, reward signé                         |
| `claims`                | `nonce` PK → anti-replay onchain mint                      |
| `daily_claims`          | `(address, day)` → total $SNAKE claimé dans 24h            |
| `leaderboard`           | Best score / total claimed / games_played par wallet       |
| `score_history`         | Historique scores (pour anti-cheat regression analysis)    |
| `events`                | Golden Snake x3 multiplier temporaire                      |
| `seasons`               | Périodes mensuelles avec auto-mint top 10 trophy           |
| `season_results`        | Snapshot classement à la clôture                           |
| `clans` / `clan_members`| Guildes (burn 1000 $SNAKE to create)                       |
| `clan_weekly_payouts`   | Pool hebdo top 3 clans (50/30/20)                          |
| `proof_nonces`          | Anti-replay EIP-191 `persisted` (survit Railway redeploy)  |
| `boost_cache`           | Cache boost multiplier par wallet (TTL ~5 min)             |
| `tournaments`           | Période + entry fee + prize pool (70/30/10)                |

Toute modif schema : **préserver idempotence via `CREATE TABLE IF NOT EXISTS` + migrations séparées**.
Ne JAMAIS `DROP TABLE` en prod sans backup `/api/admin/backup`.

---

## 9. Sécurité & anti-cheat

- **Signer privkey** (`SIGNER_PK`) : seul secret critique. S'il leak → attaquant peut mint infini.
  → Rotation : déployer nouveau wallet, appeler `setSigner()` sur les 3 contrats, update `.env` VPS + `pm2 restart snake-backend --update-env`.
- **EIP-191 wallet proof** (`REQUIRE_WALLET_PROOF=1`) : force signMessage avant `/api/claim` — anti-griefing.
- **Nonces persistés en DB** (table `proof_nonces`) : replay attack impossible même après VPS redeploy.
- **Anti-cheat server-side** :
  - `score_per_second > MAX_PTS_PER_SEC` → session reject
  - `session_duration < MIN_SESSION_SEC` → bot detected
  - `session_gap < MIN_SESSION_GAP` par wallet → spam reject
- **Rate limits** : `limiter` (actions write) + `publicLimiter` (reads) + `proofLimiter` (challenges).
- **`trust proxy = 1`** (nginx en reverse proxy devant). Ne PAS mettre `true` (spoofable).

---

## 10. Gotchas — lire avant commit

1. **abi.encode vs abi.encodePacked**
   Signature hashing backend = `ethers.solidityPackedKeccak256(['address','uint256','uint256'], [...])`.
   Contrat = `abi.encode` → incompatible. **Toujours** vérifier packed côté contrat (recover).

2. **Reward precision**
   Voir §6. Ne PAS re-introduire `Math.floor` avant les multipliers.

3. **OneDrive + git**
   Voir §4. `.git/objects` corrompu → reclone hors-OneDrive.

4. **Boost cache TTL**
   Modifier un NFT boost côté chain → appeler `/api/boost/refresh` sinon cache stale 5 min.

5. **Chainlink oracle**
   `latestRoundData()` peut retourner `updatedAt == 0` en testnet. Check `block.timestamp - updatedAt < 3600` sinon fallback price.

6. **`better-sqlite3` sync API**
   Pas de `await` sur les `.run()` / `.get()`. Toutes les queries sont synchrones et bloquent l'event loop → garde-les rapides (index!).

7. **`ethers@6`**
   `parseEther` retourne `bigint`, pas `BigNumber`. Jamais `.add()`/`.mul()`, use `+` et `*`.

8. **VPS PM2 redeploy**
   `pm2 restart snake-backend` → restart complet du process. Toute var en RAM (Maps, caches in-memory) est wipée → persiste en DB. Ajouter `--update-env` si tu as modifié le `.env`.

9. **CORS**
   Frontend `snowdiablo.xyz` hardcodé dans `server.js`. Ajouter nouveau domaine → éditer la liste `allowedOrigins`.

10. **NFT Trophy auto-mint**
    Déclenché par `/api/admin/seasons/close`. Le signer paye tout le gas → check balance ≥ 2 POL avant close.

11. **dotenv requis**
    Sans `dotenv` et `-r dotenv/config` dans `node_args` PM2, le `.env` n'est PAS chargé sur VPS (Railway l'injectait automatiquement). `package.json` doit avoir `dotenv` en dep.

12. **PowerShell `Out-File -Encoding utf8` ajoute un BOM**
    Si tu écris un `.env` depuis Windows, utilise `[System.IO.File]::WriteAllText(..., utf8-no-bom)` ou `dos2unix` sur le VPS. Un BOM en tête fait que `dotenv` lit `﻿ADMIN_TOKEN` au lieu de `ADMIN_TOKEN` et ignore la première variable.

13. **SnakeBoostNFT n'implémente PAS ERC721Enumerable**
    `tokenOfOwnerByIndex` revert → l'endpoint `/api/boost/inventory` utilise un fallback en 3 stratégies (Enumerable → events `BoostMinted` → brute-force `ownerOf`). Voir `server.js` ~ ligne 2102.

---

## 11. Monitoring

| Outil          | Check                                              |
|----------------|----------------------------------------------------|
| Uptime Kuma    | `GET https://api.snowdiablo.xyz/health` 60s        |
| Discord webhook| Alert si signer balance < 2 POL                    |
| PM2 (VPS root) | `pm2 logs snake-backend` + `pm2 monit`             |
| Polygonscan    | Watchlist signer wallet — mint frequency           |
| VPS SSH        | `ssh root@65.75.209.135` + `pm2 status`            |

Signer balance check :

```powershell
$body = '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xFca2595d1EE2d2d417f6e404330Ca72934054fc9","latest"],"id":1}'
$resp = iwr -Uri "https://polygon-bor-rpc.publicnode.com" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing
$hex  = ($resp.Content | ConvertFrom-Json).result
$pol  = [decimal]([System.Numerics.BigInteger]::Parse("0"+$hex.Substring(2), 'AllowHexSpecifier')) / 1e18
"POL: $pol"
```

---

## 12. Stratégie tokenomics

- **Zero presale, zero team allocation** — mint 100% depuis gameplay.
- **10 points = 1 $SNAKE** (ratio de base, modulable par boosts).
- **LP Fund** : wallet public `0xc1D4...166E`. Entrée tournois, frais clans, frais usernames → pool alimenté organiquement.
- **DEX listing** = quand pool hit target (TBD). Pas de pump artificiel.
- **NFT Trophy top 10** = saisonnier, auto-mint, permanent `+5%` claim boost par trophy détenu.
- **Boost NFT marketplace** :
  - Basic : +2% (200 bps), ~$5 POL
  - Pro : +4% (400 bps), ~$15 POL
  - Elite : +8% (800 bps), ~$40 POL
  - Pricing Chainlink-stable, updated on-chain.

---

## 13. Contacts + liens

- Game : https://snowdiablo.xyz
- Backend : https://api.snowdiablo.xyz (VPS 65.75.209.135 depuis 2026-05-19)
- GitHub : https://github.com/SnowDiablo/snake-backend
- Twitter : https://twitter.com/SnowDiablo
- Twitch : https://twitch.tv/snowdiablo
- LP tracker : https://snowdiablo.xyz/lp-fund.html
- Polygonscan token : https://polygonscan.com/address/0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1

---

## 14. Runbooks liés

- `LAUNCH_DAY_RUNBOOK.md` — séquence launch day
- `ADMIN_RUNBOOK.md` — ops courantes (close season, toggle golden)
- `DEPLOY_BOOST_NFT.md` — déploiement SnakeBoostNFT
- `DEPLOY_TOURNAMENTS_CLANS.md` — activation features
- `DEPLOY_DEX_LIQUIDITY.md` — procédure listing futur
- `REDDIT_POSTS.md` — posts Reddit prêts
- `TWITCH_BOT_SETUP.md` / `BLUESKY_SETUP.md` — bots sociaux
- `VPS_MIGRATION.md` — migration Railway → VPS (2026-05-19)
- `deploy/` — `vps-setup.sh`, `nginx-snake-api.conf`, `ecosystem.config.js`, helper PS scripts

---

_Dernière maj : 2026-05-19 — migration Railway → VPS (api.snowdiablo.xyz), fix `/api/boost/inventory` (3-strategy resolver), dotenv ajouté._
