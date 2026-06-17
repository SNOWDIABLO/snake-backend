# TODO — Reprise session suivante

_Session du 2026-04-23 — pause après ship fix rewards._

---

## Contexte — ce qui a été shipped

- Commit `f4bae5e` sur `main` → backend + frontend déployés
- Fix cascade validé :
  - `server.js` : `GAME_REWARD_DIVISORS['2048'] = 20`
  - `game2048-game.js` + `invaders-game.js` : preview math aligné avec backend
  - 7 × `main-*.js` : UI toujours synced avec `r.reward` (source of truth)
  - 13 locales + 2 HTML : `200 points = 1 $SNAKE` / `5 aliens = 1 $SNAKE`
- **Validation in-game** : Invaders 72 aliens → 14.40 $SNAKE affiché ✓ (72/5 = 14.4)
- Backend healthy, signer loaded, tous contrats init OK
- Encoding UTF-8 JSON locales confirmé correct (le mojibake PS était juste cosmétique terminal)
- Routes `/snake /pong /flappy /breakout /space-invaders /2048 /minesweeper` toutes en 200 OK

---

## ✅ Fait le 2026-04-23 (soir) + 2026-04-24

### 1. Fix SES / LavaMoat — DONE (2026-04-23)

Commit `78a704a` — vite.config.js target es2020 + define.global = globalThis.
Testé en prod sur Brave + MetaMask extension → connexion wallet OK.

### 3. Anti-cheat per-game — DONE (2026-04-24)

Commit `<hash>` — server.js MAX_PTS_PER_SEC_BY_GAME + getMaxPtsPerSec().
Seuils : pong/flappy=3, snake=5, minesweeper=6, breakout=8, invaders=10, 2048=15.
Testé en live : 65 aliens en 10s → reward 13 $SNAKE (avant = rejected).

### 4. Smoke test reward matrix — DONE (2026-04-24)

Script `scripts/smoke-test-rewards.ps1` — valide backend 7 jeux en ~95s.
Dernière exec : ALL PASS (7/7). Chaque game testé au ratio qui aurait été rejected
avant le fix #3. Confirme divisors + anti-cheat thresholds OK.

### 5. Security audit + hardening — DONE (2026-04-24 soir)

Audit complet de server.js (15 surfaces d'attaque Web3 vérifiées).
Fixes shippés :

**CRITIQUE** — Race condition `/api/claim` bypass DAILY_LIMIT
  → Wrap check + INSERT claims + UPSERT daily_claims + UPDATE sessions en
    `db.transaction()` (SQLite BEGIN IMMEDIATE atomique).

**ÉLEVÉES** (×2)
  → Admin token : `crypto.timingSafeEqual()` au lieu de `===` (timing attack).
  → Reward cap : `Number.isFinite(rewardFloat)` check + doc MAX_PER_SESSION
    comme cap FINAL non-override.

**MOYENNES** (×3)
  → CORS admin : whitelist explicite (ADMIN_ORIGINS env, default snowdiablo.xyz).
  → `Number.isFinite(score)` sur /api/session/end (fix NaN bypass anti-cheat).
  → localhost retiré du CORS public si NODE_ENV=production.

**Validation** : smoke test ALL PASS 7/7 après les fixes = aucune régression.

**Surfaces confirmées OK par l'audit** :
  - Nonce claims : PRIMARY KEY + DB-backed (replay-proof)
  - Prepared statements partout (pas de SQL injection)
  - `ethers.isAddress()` validé systématiquement
  - Rate limiters couvrent tous les endpoints coûteux
  - `trust proxy = 1` correct pour Railway
  - EIP-191 proof format robuste (address + action + ts + nonce)

---

## À faire au prochain retour (optionnel, tout est en prod stable)

### 2. Tester WalletConnect mobile

Valider que le flow WalletConnect (QR + MetaMask Mobile) fonctionne indépendamment de l'extension Brave/MM. Bypass le problème SES en attendant le fix définitif.

### 3. Ajuster anti-cheat per-game

Problème — `MAX_PTS_PER_SEC=5` rejette des sessions légitimes (Invaders : kills rapides en cascade, 2048 : un merge high-value = 2048 pts d'un coup).

**Action** — dans `server.js`, remplacer le check global par un mapping :

```js
const MAX_PTS_PER_SEC_BY_GAME = {
  snake: 5,
  pong: 3,
  flappy: 3,
  breakout: 8,
  invaders: 10,
  '2048': 20,
  minesweeper: 6,
};

// Dans /api/session/end
const limit = MAX_PTS_PER_SEC_BY_GAME[gameType] ?? Number(process.env.MAX_PTS_PER_SEC || 5);
if (score / duration > limit) return reject('vitesse anormale');
```

Penser à ajouter une migration pour stocker le `game_type` dans `sessions` si pas déjà présent.

### 4. Re-test claim end-to-end après fixes

Matrice de validation :

| Jeu       | Score cible  | UI preview   | Claim réel   | Anti-cheat |
|-----------|--------------|--------------|--------------|------------|
| Snake     | 100          | 10 $SNAKE    | 10 $SNAKE    | pass       |
| 2048      | 2000         | 10 $SNAKE    | 10 $SNAKE    | pass       |
| Invaders  | 65 aliens    | 13 $SNAKE    | 13 $SNAKE    | pass       |
| Breakout  | 80 briques   | 8 $SNAKE     | 8 $SNAKE     | pass       |
| Flappy    | 50 tuyaux    | 5 $SNAKE     | 5 $SNAKE     | pass       |
| Pong      | 40 échanges  | 4 $SNAKE     | 4 $SNAKE     | pass       |
| Minesweeper | 60 cases   | 6 $SNAKE     | 6 $SNAKE     | pass       |

---

## Outils en place

- **Railway CLI linké** → `cd C:\dev\snake-backend && railway logs`
- **GitHub CLI installé** (`gh`) — reload terminal pour activer PATH si besoin
- **Dashboard Railway** : https://railway.com/project/ea84b359-1ec8-42db-8069-752843675130

---

## Commandes rapides

```powershell
# Check backend
iwr https://snake-backend-production-e5e8.up.railway.app/health -UseBasicParsing | % Content

# Check signer balance
$body = '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xFca2595d1EE2d2d417f6e404330Ca72934054fc9","latest"],"id":1}'
$hex = ((iwr "https://polygon-bor-rpc.publicnode.com" -Method POST -Body $body -ContentType "application/json" -UseBasicParsing).Content | ConvertFrom-Json).result
"POL: $([decimal]([System.Numerics.BigInteger]::Parse('0'+$hex.Substring(2),'AllowHexSpecifier')) / 1e18)"

# Logs Railway filtrés
railway logs | Select-String "reward|claim|error|anti-cheat"

# Workflow git hors OneDrive
robocopy "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend" C:\dev\snake-backend /E /XD node_modules .git /XF .env snake.db *.local.ps1
cd C:\dev\snake-backend
git add -A && git commit -m "..." && git push origin main
```

---

_Bonne pause. Le reste c'est du polish, le core bug est shipped._
