# 🐍 SnakeCoin P2E — Admin Runbook

> **CONFIDENTIEL — usage personnel uniquement.**
> Ce document contient IPs, chemins, credentials structurants.
> Ne JAMAIS le commit sur un repo public (déjà exclu via `.gitignore`).
> Backup recommandé : clé USB chiffrée (VeraCrypt / BitLocker-to-go).

---

## 📌 Table des matières

1. [Architecture globale](#architecture-globale)
2. [Accès & credentials](#accès--credentials)
3. [VPS Linux — commandes SSH essentielles](#vps-linux--commandes-ssh-essentielles)
4. [Discord bot (pm2)](#discord-bot-pm2)
5. [Backend Railway (Express + SQLite)](#backend-railway-express--sqlite)
6. [Frontend WebHostOp (CDN)](#frontend-webhostop-cdn)
7. [Panel admin web](#panel-admin-web)
8. [Endpoints admin (API)](#endpoints-admin-api)
9. [NFT Trophy (contrat Polygon)](#nft-trophy-contrat-polygon)
10. [Social feeds (Bluesky / Twitch)](#social-feeds-bluesky--twitch)
11. [Déploiements — workflows](#déploiements--workflows)
12. [Sécurité — runbook défensif](#sécurité--runbook-défensif)
13. [Troubleshooting](#troubleshooting)
14. [Incident playbook](#incident-playbook)
15. [Contacts & ressources](#contacts--ressources)

---

## Architecture globale

```
┌──────────────────┐     ┌─────────────────────────┐     ┌────────────────────┐
│  snowdiablo.xyz  │────▶│  Railway backend        │◀───▶│  Polygon mainnet   │
│  (WebHostOp CDN) │     │  Express + SQLite       │     │  $SNAKE + NFT      │
│  index.html      │     │  snake-backend          │     │  contracts         │
│  hall-of-fame    │     │  production-e5e8        │     └────────────────────┘
└──────────────────┘     └─────────────────────────┘               ▲
                                     │                              │
                                     ▼                              │
                         ┌─────────────────────────┐                │
                         │  VPS Linux              │────────────────┘
                         │  <VPS_IP> (root)   │   (signer wallet)
                         │  pm2 : snakecoin-bot    │
                         │  Discord + Twitch       │
                         │  /opt/snakecoin-bot/    │
                         └─────────────────────────┘
```

**Flux utilisateur :**
1. User joue → frontend POST `/api/game/score` vers Railway
2. Railway vérifie anti-cheat → crédite `$SNAKE` en base
3. User claim → signature EIP-191 → Railway signe via `SIGNER_PK` → on-chain claim
4. Fin de saison → snapshot top 10 → mint autorisés → NFT drops annoncés sur Discord/Bluesky/Twitch

---

## Accès & credentials

### 🔑 Infrastructure

| Service | URL / Host | User | Note |
|---|---|---|---|
| **VPS Linux** | `<VPS_IP>` | `root` | Via SSH key (`~/.ssh/snake_vps`) |
| **Domaine** | `snowdiablo.xyz` | — | DNS géré chez le registrar |
| **Railway** | `snake-backend-production-e5e8.up.railway.app` | `<admin_email>` | Dashboard: https://railway.com |
| **WebHostOp** | FTP via GitHub Actions | — | Secret dans `repo settings` |
| **GitHub** | github.com/SnowDiablo/snake-backend | `SnowDiablo` | Repo public (vitrine) |

### 🪙 Blockchain

| Asset | Address | Note |
|---|---|---|
| **$SNAKE token** | (ERC-20 sur Polygon) | Polygonscan pour voir supply |
| **NFT Trophy** | `NFT_CONTRACT_ADDRESS` (Railway env) | ERC-721 + EIP-2981 + Chainlink pricing |
| **Signer wallet** | Depuis `SIGNER_PK` (Railway env) | Doit avoir ~2 POL pour gas |

### 🔐 Secrets (emplacements, pas les valeurs)

- **VPS** : `/opt/snakecoin-bot/.env` (Discord/Twitch tokens)
- **Railway** : Dashboard → Variables (backend secrets, SIGNER_PK, ALCHEMY_KEY)
- **Local Windows** : `snake-backend\.env` (dev only — `.gitignore`-é)
- **Alchemy API** : dashboard.alchemy.com (compte `<admin_email>`)
- **ADMIN_TOKEN** : rotation recommandée tous les 90j → update sur Railway + local

---

## VPS Linux — commandes SSH essentielles

### Connexion

```bash
ssh root@<VPS_IP>
# ou si key SSH nommée différemment :
ssh -i ~/.ssh/snake_vps root@<VPS_IP>
```

### Monitoring système

```bash
# Charge / RAM / disque
htop                          # (ou top si htop absent)
df -h                         # espace disque
free -h                       # mémoire
uptime                        # load average

# Réseau
ss -tulpn                     # ports en écoute
ufw status                    # firewall
fail2ban-client status        # bans SSH actifs
fail2ban-client status sshd   # détails bans SSH

# Logs système
journalctl -u ssh -n 50       # logs sshd
journalctl -xe                # dernières erreurs
tail -f /var/log/auth.log     # tentatives login live
```

### Maintenance système

```bash
# Updates
apt update && apt upgrade -y
apt autoremove -y && apt autoclean

# Reboot
reboot

# Services
systemctl status pm2-root
systemctl status nginx        # si nginx présent
systemctl status ufw
```

---

## Discord bot (pm2)

**Chemin** : `/opt/discord-bot-snake/`  ← vrai chemin sur le VPS
**pm2 name** : `snakecoin-bot`
**Commande de démarrage** : `node bot.js`
**Logs** : `/opt/discord-bot-snake/logs/out.log` + `err.log`
**Note** : ce dossier **n'est pas un repo git** — déploiements via `deploy.ps1` ou `scp`, pas `git pull`.

### Autres services pm2 sur ce VPS

| pm2 name | rôle | path |
|---|---|---|
| `snakecoin-bot` | Discord bot SnakeCoin (ce projet) | `/opt/discord-bot-snake/` |
| `bot-cs2` | Serveur/bot CS2 (autre projet) | séparé |
| `pm2-logrotate` | module rotation logs | system |

### Commandes quotidiennes

```bash
cd /opt/discord-bot-snake

# Status / monitoring
pm2 status                              # vue d'ensemble
pm2 describe snakecoin-bot              # détails d'un process
pm2 monit                               # dashboard live
pm2 logs snakecoin-bot --lines 50       # 50 dernières lignes
pm2 logs snakecoin-bot --err            # erreurs uniquement
pm2 flush                               # vider les logs

# Restart / update
pm2 restart snakecoin-bot               # restart simple
pm2 restart snakecoin-bot --update-env  # recharge le .env
pm2 reload snakecoin-bot                # zero-downtime (si cluster)
pm2 stop snakecoin-bot                  # arrêt complet
pm2 start ecosystem.config.js           # démarrage depuis config

# Persistance reboot
pm2 save                                # sauvegarde l'état actuel
pm2 startup                             # configure auto-start systemd
pm2 resurrect                           # restaure l'état sauvé

# Rotation logs
pm2 install pm2-logrotate               # (déjà fait)
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Déploiement bot → VPS

**Depuis Windows PowerShell :**
```powershell
cd "$env:USERPROFILE\OneDrive\claude creation\snake-backend\discord-bot-snacke"
.\deploy.ps1
```

**Depuis le VPS (PAS de git pull — ce dossier n'est pas tracké) :**
```bash
cd /opt/discord-bot-snake
# → pour update, utiliser deploy.ps1 depuis Windows (rsync/scp)
#   OU initialiser le repo une fois :
#   git init && git remote add origin <url-privée> && git pull

# Après nouvelle version déployée :
npm install --production
node register-commands.js       # re-register slash commands si commandes modifiées
pm2 restart snakecoin-bot --update-env
pm2 logs snakecoin-bot --lines 30
```

### Slash commands enregistrées

`/stats` · `/topscore [day|week|all]` · `/wallet <address>` · `/link <address> [signature] [timestamp]` · `/play`

Re-enregistrer après modif :
```bash
node register-commands.js
```

---

## Backend Railway (Express + SQLite)

**URL prod** : `https://snake-backend-production-e5e8.up.railway.app`
**Health** : `https://snake-backend-production-e5e8.up.railway.app/health`

### Dashboard Railway

1. https://railway.com → login avec `<admin_email>`
2. Projet `snake-backend` → service `production-e5e8`
3. Onglets utiles :
   - **Deployments** : historique des builds, logs de build
   - **Variables** : toutes les env vars (SIGNER_PK, ADMIN_TOKEN, …)
   - **Metrics** : CPU / RAM / requests
   - **Logs** : flux stdout/stderr live
   - **Settings** → **Volumes** : persistance `snake.db` (déjà attaché)

### Env vars critiques (ne pas modifier sans précaution)

```
ADMIN_TOKEN=***                    # Bearer token panels admin
SIGNER_PK=***                      # Clé privée wallet signer (signe claims + mint)
ALCHEMY_KEY=***                    # RPC Polygon
NFT_CONTRACT_ADDRESS=0x...         # Contrat NFT Trophy Polygon
REQUIRE_WALLET_PROOF=0             # 0 = warn-only, 1 = enforce (EIP-191)
PROOF_MAX_AGE_SEC=300              # TTL challenge proof (5 min)
DISCORD_WEBHOOK_HEALTHCHECK=***    # Webhook alerte bot down
BSKY_HANDLE=***                    # Handle Bluesky bot
BSKY_PASSWORD=***                  # App password Bluesky
TWITCH_OAUTH=oauth:***             # Token Twitch bot
TWITCH_CHANNEL=snowdiablo
PORT=3000                          # Géré par Railway
DATABASE_URL=/data/snake.db        # Volume Railway
```

### Redéploiement

Railway re-build automatiquement à chaque push sur `main` du repo **backend** (privé).
Vérifier badge vert dans Deployments après push.

Restart manuel : dashboard → `Deploy` → `Redeploy`.

### Base SQLite

```bash
# Depuis Railway CLI (si installé)
railway run sqlite3 /data/snake.db

# Tables principales
.tables
# claims, nft_drops, scores, sessions, streaks, quests, wallet_links

# Stats rapides
SELECT COUNT(*) FROM claims;
SELECT COUNT(*) FROM scores WHERE created_at > strftime('%s','now','-7 days');
SELECT * FROM nft_drops ORDER BY created_at DESC LIMIT 10;
```

---

## Frontend WebHostOp (CDN)

**URL** : `https://snowdiablo.xyz`
**Deploy** : GitHub Actions FTP auto-deploy à chaque push `main`
**Workflow** : `.github/workflows/deploy.yml` dans le repo

### Forcer un redéploiement frontend

```powershell
cd "$env:USERPROFILE\OneDrive\claude creation\snake-backend-git"
git commit --allow-empty -m "Trigger redeploy"
git push origin main
```

GitHub Actions tab → vérifier le workflow `Deploy to WebHostOp` → badge vert en ~30s.

### Purge cache CDN

Si changement pas visible → CTRL+F5 (purge navigateur), puis :
- Console admin WebHostOp → "Purge cache"
- Attendre 1-2 min propagation

---

## Panel admin web

**URL** : `https://snowdiablo.xyz/admin.html`
**Auth** : password field = `ADMIN_TOKEN` Railway

### Fonctionnalités

- 📊 Stats globales (joueurs, games, $SNAKE distribué)
- 📋 Dernières sessions / claims
- 🏆 Leaderboard admin (filtrable)
- 📥 Export CSV claims / sessions
- 📈 Courbes croissance (chart.js)
- 🎨 NFT drops status
- 🎬 Action season close (→ trigger snapshot top 10)

**Sécurité** :
- Bearer token validé côté backend
- Token JAMAIS logué
- Rate-limit admin : 100 req/min

---

## Endpoints admin (API)

Toutes les requêtes nécessitent `Authorization: Bearer $ADMIN_TOKEN`.

### Stats & exports

```powershell
$env:ADMIN_TOKEN = "xxx"
$base = "https://snake-backend-production-e5e8.up.railway.app"

# Stats globales
Invoke-RestMethod "$base/api/admin/stats?top_limit=50&claims_limit=100" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"}

# Export CSV claims
Invoke-WebRequest "$base/api/admin/export/claims.csv" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -OutFile "claims.csv"

# Export CSV sessions
Invoke-WebRequest "$base/api/admin/export/sessions.csv" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -OutFile "sessions.csv"
```

### Actions saison

```powershell
# Fermer la saison en cours (snapshot top 10 + trigger NFT drops)
Invoke-RestMethod -Method Post -Uri "$base/api/admin/season/close" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -ContentType "application/json" `
  -Body '{"confirm": true}'
```

### Bluesky (auto-post manuel)

```powershell
$body = @{ text = "🐍 Message custom" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/api/admin/bsky/post" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -ContentType "application/json" -Body $body
```

### Twitch (say in chat)

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/admin/twitch/say" `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -ContentType "application/json" `
  -Body '{"message": "🐍 Custom chat message"}'
```

---

## NFT Trophy (contrat Polygon)

- **Standard** : ERC-721 + EIP-2981 (royalties 5%) + EIP-4906 (metadata update)
- **Tiers** : Gold / Silver / Bronze / Top10
- **Pricing** : Chainlink MATIC/USD → $25 / $15 / $10 / $5
- **Mint** : signer-gated (backend signe → user mint)
- **Multiplier** : +25% / +15% / +10% / +5% sur claim `$SNAKE`

### Vérifs post-mint

- Polygonscan → tab NFT → voir totalSupply, royalty, owner
- OpenSea collection page → vérifier images + traits
- Backend `/api/nft/eligibility/<addr>` → retourne tier éligible

### Rotation SIGNER_PK (si compromis)

1. Générer nouveau wallet : `node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"`
2. Fund avec ~2 POL
3. Railway → Variables → `SIGNER_PK` = nouvelle clé
4. Sur contract Polygonscan → `setSigner(<nouvelle address>)` depuis wallet admin
5. Railway redeploy
6. Burn ancienne clé de tous les tracks

---

## Social feeds (Bluesky / Twitch)

### Triggers auto

| Event | Discord | Bluesky | Twitch chat |
|---|---|---|---|
| Nouveau record all-time | ✅ | ✅ | ✅ |
| Whale claim (>10k $SNAKE) | ✅ | ✅ | ❌ |
| Golden snake unlock | ✅ | ✅ | ✅ |
| NFT mint | ✅ | ✅ | ❌ |
| Season close | ✅ | ✅ | ✅ |

### Status

```powershell
Invoke-RestMethod "$base/api/admin/bsky/status" -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"}
Invoke-RestMethod "$base/api/admin/twitch/status" -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"}
```

### Reconnexion

- Bluesky token expire rarement, restart backend suffit
- Twitch IRC → si déconnecté, `pm2 restart snakecoin-bot` (bot réside côté VPS, pas Railway)

---

## Déploiements — workflows

### 1. Modif frontend (HTML/CSS/JS dans index.html, hall-of-fame.html…)

```powershell
# Edits dans snake-backend\ puis :
$src = "$env:USERPROFILE\OneDrive\claude creation\snake-backend"
$dst = "$env:USERPROFILE\OneDrive\claude creation\snake-backend-git"
Copy-Item "$src\index.html" "$dst\index.html" -Force
# (copier aussi les autres fichiers modifiés)

cd $dst
git add .
git diff --cached --stat   # VÉRIFIER avant push
git commit -m "feat: ..."
git push origin main
# → GitHub Actions FTP deploy → snowdiablo.xyz en ~30s
```

### 2. Modif backend (server.js, routes API)

```
Backend = repo privé séparé, PAS dans snake-backend-git.
Push sur repo privé → Railway redeploy auto.
```

### 3. Modif bot Discord (bot.js, commands)

```powershell
# Option A : déploiement automatisé
cd "$env:USERPROFILE\OneDrive\claude creation\snake-backend\discord-bot-snacke"
.\deploy.ps1

# Option B : manuel via SSH
ssh root@<VPS_IP>
cd /opt/discord-bot-snake
git pull
npm install --production
node register-commands.js
pm2 restart snakecoin-bot --update-env
```

### 4. Modif smart contract (Solidity)

```
1. Edit contract + tests
2. npx hardhat test
3. npx hardhat run scripts/deploy.js --network polygon
4. Verify : npx hardhat verify --network polygon <addr> <args>
5. Update Railway env : NFT_CONTRACT_ADDRESS
6. Railway redeploy
7. Vérifier sur Polygonscan
```

---

## Sécurité — runbook défensif

### Checklist mensuelle

- [ ] `apt update && apt upgrade` sur VPS (1er du mois)
- [ ] `fail2ban-client status sshd` : check bans récents
- [ ] `pm2 logs snakecoin-bot --err` : scan erreurs anormales
- [ ] Railway → Metrics : pic de trafic suspect ?
- [ ] Panel admin → stats claims : claim flood suspect ?
- [ ] SSL cert : `echo | openssl s_client -connect snowdiablo.xyz:443 2>&1 | openssl x509 -noout -dates`

### Rotation credentials (tous les 90 jours)

- [ ] `ADMIN_TOKEN` → Railway + admin.html refresh
- [ ] Alchemy API key → dashboard Alchemy + Railway
- [ ] Discord bot token → Discord dev portal + Railway/VPS
- [ ] Twitch OAuth → https://twitchapps.com/tmi/ + VPS

### Signaux d'alerte

| Symptôme | Diagnostic | Action |
|---|---|---|
| Backend 502 Railway | Volume plein / crash | Logs Railway → check disk quota |
| Bot Discord offline | pm2 down / token expired | `pm2 logs snakecoin-bot --err` |
| Claim qui fail | SIGNER_PK hors gas | Fund wallet avec POL |
| 429 sur `/api/claim` | Rate-limit déclenché | Check IP → éventuel ban UFW |
| Fail2ban SSH ban | Brute force attempt | Normal — juste surveiller |
| SSL expiré | Let's Encrypt renew cassé | `certbot renew --dry-run` |

### En cas de compromise suspecté

1. **Isolation** : UFW block tout sauf IP perso
   ```bash
   ufw default deny incoming
   ufw allow from <ton-ip> to any port 22
   ufw allow 443
   ufw enable
   ```
2. **Logs** : `journalctl --since="1 hour ago" > /tmp/audit.log`
3. **Rotation** : TOUS les secrets (ADMIN_TOKEN, SIGNER_PK, DISCORD_TOKEN, etc.)
4. **Reset keys** : `~/.ssh/authorized_keys` → ne garder que la clé connue
5. **Contract** : si SIGNER_PK compromis → `setSigner(newAddr)` d'urgence

---

## Troubleshooting

### 🔴 Bot Discord ne répond plus

```bash
ssh root@<VPS_IP>
pm2 status
pm2 logs snakecoin-bot --err --lines 100

# Si crashed :
pm2 restart snakecoin-bot --update-env
pm2 logs snakecoin-bot --lines 30

# Si token invalide :
cd /opt/discord-bot-snake
nano .env                    # vérifier DISCORD_TOKEN
pm2 restart snakecoin-bot --update-env
```

### 🔴 Backend Railway en vrac

```
Dashboard Railway → Logs → dernières erreurs
Souvent :
- Volume disque plein → supprimer logs vieux
- Crash loop → erreur JS dans dernier deploy → revert
- ERR_ERL_UNEXPECTED_X_FORWARDED_FOR → check trust proxy = 1
- 503 → Railway plateforme issue (status.railway.com)
```

### 🔴 Frontend ne s'update pas

```
1. Check GitHub Actions tab : workflow FTP réussi ?
2. Console WebHostOp : purge cache
3. CTRL+F5 navigateur
4. DNS : nslookup snowdiablo.xyz (doit pointer bon CDN)
```

### 🔴 Claim $SNAKE qui échoue (signature mismatch)

Déjà arrivé (task #41 + #48). Diagnostic :
```
- Contract utilise abi.encode (pas encodePacked) → backend doit matcher
- SIGNER_PK Railway doit === signer address setté dans contract
- Nonce replay → check DB table claim_nonces
```

### 🔴 NFT mint échoue

```
1. Polygonscan → check tx revert reason
2. /api/nft/eligibility/<addr> → user est-il éligible ?
3. Chainlink feed up ? (signal de prix)
4. Contract paused ? (si pause admin activée)
```

---

## Incident playbook

### 🚨 Niveau 1 — Service dégradé (1 composant down)

1. Identifier composant via panel admin + Uptime Kuma
2. Consulter section Troubleshooting ci-dessus
3. Poster status Discord #snake-feed
4. Fix + redeploy
5. Monitorer 15 min post-fix

### 🚨 Niveau 2 — Incident utilisateur (claims bloqués, mint fail mass)

1. Mode maintenance frontend : `pre message` dans admin.html
2. Backend : désactiver route problématique (ou revert dernier deploy)
3. Investigation via logs Railway + SQLite
4. Compensation users si loss $SNAKE (credit manuel via endpoint admin)
5. Post-mortem : changelog interne

### 🚨 Niveau 3 — Compromission / smart-contract exploit

1. **STOP** : pause contract si fonction pause dispo
2. Rotation TOUS secrets immédiate
3. Backup DB : `cp /data/snake.db /tmp/snake-$(date +%s).db`
4. SSH VPS → UFW lockdown
5. Analyse forensic : logs Railway + VPS
6. Communication transparente : Discord announce + post-mortem

---

## Contacts & ressources

### Comptes & services

- **GitHub** : `SnowDiablo` / `<admin_email>`
- **Railway** : `<admin_email>`
- **Alchemy** : `<admin_email>`
- **Discord dev portal** : `<admin_email>`
- **Twitch** : `snowdiablo`
- **Bluesky** : handle selon `BSKY_HANDLE` dans Railway

### Documentation tiers

- pm2 : https://pm2.keymetrics.io/docs
- Discord.js v14 : https://discord.js.org
- ethers.js v6 : https://docs.ethers.org/v6
- Railway : https://docs.railway.com
- Polygon mainnet : chain ID 137 — RPC via Alchemy
- Chainlink feeds Polygon : https://data.chain.link/polygon/mainnet

### Explorers blockchain

- **Polygonscan** : https://polygonscan.com/address/<NFT_CONTRACT_ADDRESS>
- **OpenSea** : https://opensea.io/collection/snakecoin-trophy
- **Tokens** : https://polygonscan.com/token/<SNAKE_TOKEN_ADDRESS>

### Monitoring

- **Uptime Kuma** : (auto-hosté sur VPS) — port configuré
- **Analytics Umami** : https://cloud.umami.is → projet snowdiablo.xyz
- **Railway metrics** : dashboard service

---

## 📦 Backup recommandé (clé USB)

Fichiers à conserver chiffrés sur clé USB :

```
📁 snakecoin-backup/
├── ADMIN_RUNBOOK.md              ← ce fichier
├── .env.vps.example              ← template vars VPS (sans valeurs)
├── .env.railway.example          ← template Railway vars (sans valeurs)
├── snake.db.latest                ← dump SQLite récent
├── contracts/
│   ├── SnakeTrophyNFT.sol
│   └── deployment-addresses.json
├── ssh-keys/
│   ├── snake_vps                  ← clé privée SSH (CHIFFRÉE)
│   └── snake_vps.pub
└── secrets/
    └── secrets.kdbx               ← KeePassXC avec tous les tokens
```

**IMPORTANT** : garder `secrets.kdbx` avec passphrase forte. Jamais en clair.

---

**Dernière mise à jour** : 2026-04-19
**Version** : 1.0
**Mainteneur** : SnowDiablo (`<admin_email>`)
