# DEPLOY — Tournois 24h + Clans/Guildes (Tasks #69 + #70)

Runbook admin pour activer les deux systèmes en prod sur Railway (backend) + CI FTP (frontend).

## 1. Pre-deploy sanity check (local PowerShell)

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend"
node --check server.js
# Doit retourner: (rien) — pas d'erreur
```

Si erreur de syntaxe, **NE PAS** push. Lire la ligne signalée et corriger.

## 2. Générer le signer wallet dédié tournois/clans (si pas déjà fait)

Le même `SIGNER_PRIVATE_KEY` que NFT trophy peut être réutilisé s'il a du POL pour les gas + du `$SNAKE` pour les payouts clans. Sinon crée un wallet dédié :

```bash
node -e "const w = require('ethers').Wallet.createRandom(); console.log('addr:', w.address, '\npk :', w.privateKey)"
```

Fund ce wallet :
- **POL** : suffisant pour couvrir les payouts tournois (3 tx par tournoi × N tournois/mois) + gas des transfers `$SNAKE` clans. Charger 5-10 POL pour commencer.
- **$SNAKE** : charger le wallet avec `CLAN_WEEKLY_POOL_SNAKE × 4 semaines` minimum (ex: 40 000 $SNAKE pour un pool hebdo de 10 000).

## 3. Config Railway env vars

Dashboard Railway → snake-backend service → Variables :

```bash
# Tournois
TOURNAMENT_ENABLED=1
TOURNAMENT_ENTRY_POL=1
TOURNAMENT_DURATION_H=24
TOURNAMENT_PAYOUT_WALLET=0xAddressQuiRecoitLesEntriesPol
TOURNAMENT_MIN_CONFIRMATIONS=2

# Clans
CLAN_ENABLED=1
CLAN_CREATE_BURN_AMOUNT=1000
CLAN_MAX_MEMBERS=10
CLAN_WEEKLY_POOL_SNAKE=10000

# Partagé (si pas déjà set)
POLYGON_RPC=https://polygon-rpc.com
SIGNER_PRIVATE_KEY=0x...
CONTRACT_ADDRESS=0xAddressDuToken$SNAKE
```

**Note :** `TOURNAMENT_PAYOUT_WALLET` peut être = `SIGNER_PRIVATE_KEY` wallet pour simplifier : il reçoit les entries et signe les payouts en retour.

## 4. Push + deploy

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend-git"
# copier les 2 fichiers modifiés
Copy-Item "..\snake-backend\server.js" ".\server.js" -Force
Copy-Item "..\snake-backend\index.html" ".\index.html" -Force
Copy-Item "..\snake-backend\hall-of-fame.html" ".\hall-of-fame.html" -Force

git add server.js index.html hall-of-fame.html
git commit -m "feat: tournois 24h + clans/guildes weekly (tasks #69 + #70)"
git push origin main
```

Railway va auto-deploy via webhook. CI GitHub Actions pousse index.html + hall-of-fame.html sur WebHostOp via FTP.

## 5. Smoke tests post-deploy

### Backend (logs pm2 ou Railway logs)

```bash
# Logs startup attendus
🏆 Tournaments    : ENABLED (entry 1 POL, 24h rolling)
   └─ 1 open · 1 total · payout_wallet=0x...
🛡️  Clans          : ENABLED (create burn 1000 $SNAKE · max 10 members)
   └─ 0 clans · 0 members · weekly pool=10000 $SNAKE
```

### Endpoints publics

```bash
curl -s https://api.snowdiablo.xyz/api/tournament/current | jq
# Attendu: { enabled: true, active: true, id: 1, end_at: ..., prize_pool_wei: "0", entries_count: 0, ... }

curl -s https://api.snowdiablo.xyz/api/tournament/leaderboard | jq
# Attendu: { enabled: true, active: true, entries: [] }

curl -s https://api.snowdiablo.xyz/api/clan/list | jq
# Attendu: { enabled: true, clans: [] }
```

### Frontend

1. Ouvrir https://snowdiablo.xyz
2. Connecter wallet
3. Vérifier apparition des 2 nouveaux accordions : `🏆 Tournament` et `🛡️ Clans`
4. Click sur `🏆 Tournament` → countdown doit défiler, bouton "Enter (1 POL)" cliquable
5. Click sur `🛡️ Clans` → form create (name + tag), liste des clans existants

## 6. Dry-run tournois (test avec 0.01 POL)

```bash
# Override temporairement TOURNAMENT_ENTRY_POL=0.01 sur Railway pour tester
# Faire un entry depuis le front, check :
curl -s https://api.snowdiablo.xyz/api/tournament/current | jq '.prize_pool_wei, .entries_count'
# prize_pool_wei doit augmenter de 0.01 POL (10^16 wei)

# Puis remettre TOURNAMENT_ENTRY_POL=1
```

## 7. Dry-run clan (test avec 10 $SNAKE)

```bash
# Override temporairement CLAN_CREATE_BURN_AMOUNT=10
# Create un clan depuis le front
# Check burn tx dans polygonscan
# Puis remettre à 1000
```

## 8. Monitoring prod

Ajouter dans Uptime Kuma :

```
https://api.snowdiablo.xyz/api/tournament/current   → 200 OK, JSON valide
https://api.snowdiablo.xyz/api/clan/list             → 200 OK, JSON valide
```

Alertes Discord si down.

## 9. Rollback

Si problème critique, désactiver sans rollback code :

```bash
# Railway env:
TOURNAMENT_ENABLED=0
CLAN_ENABLED=0
```

Les endpoints renvoient alors `{ enabled: false }` et les UI se cachent automatiquement (graceful no-op).

## 10. Cron timing

- **Tournois** : tick chaque 5 min. Auto-close quand `end_at < now` → payout top 3 (40/20/10%) → ouvre nouveau tournoi 24h.
- **Clans** : tick chaque 1h. Payout hebdo déclenché dimanche 20:00 UTC uniquement (gate `_lastSundayAt20UTC`). Split 50/30/20.

## 11. Disclaimer légal

Les tournois utilisent du POL (pas des fiat). Payouts 70% aux joueurs, 30% project cut. Vérifier la conformité dans ta juridiction avant launch public si l'audience dépasse l'UE (US state-by-state, UK, etc.).

---

**Status :** Toutes les tasks #69 et #70 sont `completed`. Reste #65 (DEX liquidity) et #66 (boost NFT deploy mainnet) comme dernières actions stealth-reveal.
