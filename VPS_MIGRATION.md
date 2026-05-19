# VPS_MIGRATION.md — snake-backend : Railway → VPS

Migration de `snake-backend` du free tier Railway (qui ne supporte plus les volumes persistants) vers le VPS SnowDiablo `65.75.209.135`, sous PM2 + nginx.

> ⚠️ **Lis la phase 0 EN PREMIER.** Si Railway suspend ton service, tu perds l'accès à `SIGNER_PK` et à la DB live. Sauvegarde avant tout.

---

## Phase 0 — Sauvegardes URGENTES (à faire AVANT toute autre étape)

### 0.1 — Récupérer les variables d'environnement Railway

Dans le dashboard Railway → `supportive-transformation` → `snake-backend` → onglet **Variables** → bouton **Raw editor** :

```
copie TOUT le contenu et colle-le dans un fichier local :
  C:\Users\Alexi\OneDrive\claude creation\snake-backend\.env.railway-backup
```

**Clés critiques** (la perte de la première = catastrophe — tu ne peux plus mint $SNAKE) :
- `SIGNER_PK`
- `ADMIN_TOKEN`
- `CONTRACT_ADDRESS`, `NFT_CONTRACT_ADDRESS`, `BOOST_NFT_ADDRESS`
- `RPC_URL`
- `DISCORD_WEBHOOK`, `PUBLIC_FEED_WEBHOOK`
- Tous les feature flags (`TOURNAMENT_*`, `CLAN_*`, `MIN_*`, `MAX_*`, `DAILY_LIMIT`…)

> Note : `.env.railway-backup` est ignoré par git (pattern `.env.*` dans `.gitignore`). Ne le commit jamais.

### 0.2 — Sauvegarder la DB Railway (tant qu'elle répond)

Si le service est offline, **relance un deploy temporairement** depuis le dashboard. Une fois `/health` répond :

```powershell
# Remplace TOKEN par la vraie valeur d'ADMIN_TOKEN
$token = "TOKEN"
$url = "https://snake-backend-production-e5e8.up.railway.app/api/admin/backup"
Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $token" } `
  -OutFile "C:\Users\Alexi\OneDrive\claude creation\snake-backend\snake.db.railway-backup"
```

Vérifie la taille (>0 octet) :
```powershell
Get-Item .\snake.db.railway-backup | Select-Object Name, Length
```

Si Railway ne répond plus du tout, fallback : `railway run cat /data/snake.db > snake.db.railway-backup` depuis la Railway CLI si encore loggé.

---

## Phase 1 — DNS

Tu dois pointer un sous-domaine vers `65.75.209.135`. Recommandation : **`api.snowdiablo.xyz`** (court, clair).

Chez ton registrar (OVH, Cloudflare, Namecheap…) :

| Type | Nom  | Valeur          | TTL   |
|------|------|-----------------|-------|
| A    | api  | 65.75.209.135   | 3600  |

Attends que `nslookup api.snowdiablo.xyz` retourne `65.75.209.135` (généralement < 5 min, max 1 h) **avant** de passer à la phase 3 (certbot a besoin que le DNS résolve).

---

## Phase 2 — Push des nouveaux fichiers de déploiement sur GitHub

J'ai créé ces fichiers dans ton OneDrive :
- `snake-backend/ecosystem.config.js` (config PM2)
- `snake-backend/deploy/nginx-snake-api.conf` (config nginx)
- `snake-backend/deploy/vps-setup.sh` (script one-shot)
- `snake-backend/VPS_MIGRATION.md` (ce fichier)

Comme OneDrive corrompt `.git/objects`, push depuis ton mirror `C:\dev\snake-backend` (cf. `CLAUDE.md` §4) :

```powershell
robocopy "C:\Users\Alexi\OneDrive\claude creation\snake-backend" C:\dev\snake-backend /E /XD node_modules .git /XF .env snake.db secrets.local.ps1 *.local.ps1 .env.railway-backup snake.db.railway-backup
cd C:\dev\snake-backend
git add ecosystem.config.js deploy/ VPS_MIGRATION.md
git commit -m "deploy: add VPS migration scripts (PM2 + nginx + setup script)"
git push origin main
```

---

## Phase 3 — Setup VPS (~10 min)

### 3.1 — SSH sur le VPS

```bash
ssh root@65.75.209.135
# ou ton user habituel + sudo
```

### 3.2 — Lancer le script de setup

```bash
# Option A : tout-en-un via curl
curl -fsSL https://raw.githubusercontent.com/SnowDiablo/snake-backend/main/deploy/vps-setup.sh \
  | sudo bash -s -- api.snowdiablo.xyz

# Option B : clone puis exec (si tu préfères inspecter le script avant)
sudo git clone https://github.com/SnowDiablo/snake-backend.git /var/www/snake-backend
sudo bash /var/www/snake-backend/deploy/vps-setup.sh api.snowdiablo.xyz
```

Le script installe Node 18, PM2, nginx, certbot, ouvre le firewall, configure le vhost et fait le SSL. Idempotent — tu peux le relancer.

### 3.3 — Coller le .env

Copie `.env.railway-backup` (depuis ton PC) vers le VPS :

```powershell
# Depuis ton PC Windows
scp "C:\Users\Alexi\OneDrive\claude creation\snake-backend\.env.railway-backup" root@65.75.209.135:/var/www/snake-backend/.env
```

Puis sur le VPS, édite ce qui doit changer :

```bash
sudo nano /var/www/snake-backend/.env
```

**Change cette ligne** (Railway → VPS) :
```diff
- DB_PATH=/data/snake.db
+ DB_PATH=/var/www/snake-backend/data/snake.db
```

Vérifie aussi `PORT=3000` (la valeur attendue par nginx → `proxy_pass http://127.0.0.1:3000`).

Permissions :
```bash
sudo chown www-data:www-data /var/www/snake-backend/.env
sudo chmod 600 /var/www/snake-backend/.env
```

### 3.4 — Restaurer la DB

```powershell
# Depuis ton PC
scp "C:\Users\Alexi\OneDrive\claude creation\snake-backend\snake.db.railway-backup" root@65.75.209.135:/var/www/snake-backend/data/snake.db
```

Sur le VPS :
```bash
sudo chown www-data:www-data /var/www/snake-backend/data/snake.db
sudo chmod 640 /var/www/snake-backend/data/snake.db
```

### 3.5 — Démarrer PM2

```bash
cd /var/www/snake-backend
sudo -u www-data pm2 start ecosystem.config.js
sudo -u www-data pm2 save

# Auto-démarrage au reboot
sudo pm2 startup systemd -u www-data --hp /var/www
# (suit l'instruction `sudo env PATH=... pm2 startup` que la commande te donne)

# Vérifie
sudo -u www-data pm2 status
sudo -u www-data pm2 logs snake-backend --lines 50
```

Le log doit montrer le bind sur port 3000 et `db_ok`. Si erreur `SQLITE_CANTOPEN`, c'est le chemin DB ou les perms — recheck `DB_PATH` et `chown`.

---

## Phase 4 — Vérification

### 4.1 — Smoke test backend direct

```bash
# Sur le VPS
curl -s http://127.0.0.1:3000/health | jq .
```

Attendu : `{ "uptime": ..., "db_ok": true, "signer_balance": "..." }`.

### 4.2 — Smoke test via nginx + SSL

```powershell
# Depuis ton PC
iwr https://api.snowdiablo.xyz/health -UseBasicParsing | % Content
```

Attendu : même réponse, status 200.

### 4.3 — Vérifie quelques endpoints publics

```powershell
iwr https://api.snowdiablo.xyz/api/stats -UseBasicParsing | % Content
iwr https://api.snowdiablo.xyz/api/leaderboard -UseBasicParsing | % Content
```

---

## Phase 5 — Bascule du frontend

Le frontend hardcode l'URL backend dans 2 fichiers (cf. `CLAUDE.md` §4) :

```
snake-backend/index.html           ligne ~1838  →  const BACKEND_URL = "..."
snake-backend/hall-of-fame.html    ligne ~404   →  const API = "..."
```

Cherche-remplace :
```
ancienne : https://snake-backend-production-e5e8.up.railway.app
nouvelle : https://api.snowdiablo.xyz
```

Puis push depuis le mirror — GitHub Actions FTP redeploy le frontend vers WebHostOp :

```powershell
robocopy "C:\Users\Alexi\OneDrive\claude creation\snake-backend" C:\dev\snake-backend /E /XD node_modules .git /XF .env snake.db secrets.local.ps1 *.local.ps1 .env.railway-backup snake.db.railway-backup
cd C:\dev\snake-backend
git add index.html hall-of-fame.html
git commit -m "deploy: switch BACKEND_URL Railway → api.snowdiablo.xyz"
git push origin main
```

Attends que le workflow FTP termine (~1 min), puis :
```powershell
iwr https://snowdiablo.xyz/ -UseBasicParsing | % StatusCode  # 200
```

Joue une partie sur le site et vérifie qu'un claim passe end-to-end.

---

## Phase 6 — Désactivation Railway

Une fois 24-48 h de fonctionnement stable confirmé sur le VPS :

1. Railway dashboard → `supportive-transformation` → `snake-backend` → Settings → **Delete service**.
2. Supprime aussi `snake-backend-volume` (s'il consomme du quota).
3. Garde les `.env.railway-backup` et `snake.db.railway-backup` en local pendant au moins 1 mois (au cas où).

---

## Annexe — Commandes d'ops quotidiennes (VPS)

| Action                         | Commande                                                     |
|--------------------------------|--------------------------------------------------------------|
| Voir les logs                  | `sudo -u www-data pm2 logs snake-backend`                    |
| Restart après edit `.env`      | `sudo -u www-data pm2 restart snake-backend --update-env`    |
| Status                         | `sudo -u www-data pm2 status`                                |
| Pull update GitHub + restart   | `cd /var/www/snake-backend && sudo -u www-data git pull && sudo -u www-data npm install --omit=dev && sudo -u www-data pm2 restart snake-backend` |
| Backup DB ponctuel             | `sudo cp /var/www/snake-backend/data/snake.db /root/backups/snake-$(date +%F).db` |
| Cron backup DB quotidien       | voir `ADMIN_RUNBOOK.md`                                      |
| Renouvellement cert            | `sudo certbot renew --dry-run` (auto via systemd timer)      |
| Reload nginx                   | `sudo nginx -t && sudo systemctl reload nginx`               |

---

## Annexe — Monitoring (à adapter de l'ancien setup Railway)

`CLAUDE.md` §11 mentionne Uptime Kuma + Discord webhook signer balance + PM2.

- **Uptime Kuma** : change l'URL surveillée `https://snake-backend-production-e5e8.up.railway.app/health` → `https://api.snowdiablo.xyz/health`.
- **PM2** est déjà actif sur le VPS — `pm2 monit` te donne CPU/RAM live.
- **Logrotate** : PM2 supporte `pm2-logrotate` :
  ```bash
  sudo -u www-data pm2 install pm2-logrotate
  sudo -u www-data pm2 set pm2-logrotate:max_size 10M
  sudo -u www-data pm2 set pm2-logrotate:retain 14
  ```

---

_Créé 2026-05-19 lors de la migration Railway → VPS._
