# 🚀 deploy.sh / deploy.ps1 — SnakeCoin Discord Bot

Scripts de déploiement local → VPS avec snapshot pré-deploy, rsync incrémental, pm2 reload et healthcheck post-deploy.

## Pré-requis VPS (one-time)

```bash
# Côté VPS
mkdir -p /root/discord-bot-snacke
cd /root/discord-bot-snacke

# Crée .env (JAMAIS pushé depuis local)
cat > .env <<EOF
DISCORD_TOKEN=xxx
DISCORD_CLIENT_ID=xxx
DISCORD_GUILD_ID=xxx
BACKEND_URL=https://snake-backend-production-e5e8.up.railway.app
CONTRACT_ADDRESS=0x...
RPC_URL=https://polygon-rpc.com
EOF
chmod 600 .env

# Install pm2 global si pas déjà fait (cf task #4)
npm install -g pm2
```

## Pré-requis local

### Linux / macOS / WSL / Git Bash
```bash
which rsync ssh   # installer si manquant
chmod +x deploy.sh
```

### Windows PowerShell natif
```powershell
Get-Command ssh, scp, tar   # intégré Windows 10/11
# Si manquant : Settings > Apps > Optional Features > OpenSSH Client
```

### Clé SSH (une fois)
```bash
# Local → génère clé si pas déjà
ssh-keygen -t ed25519 -f ~/.ssh/snake_vps

# Push clé publique sur VPS
ssh-copy-id -i ~/.ssh/snake_vps.pub root@snowdiablo.xyz

# Ajoute à l'agent pour éviter de retaper le passphrase
ssh-add ~/.ssh/snake_vps
```

## Usage

### Linux / WSL / Git Bash
```bash
./deploy.sh                  # deploy standard
./deploy.sh --dry-run        # preview (rsync --dry-run, pas d'écriture)
./deploy.sh --no-restart     # push fichiers, skip pm2 reload
./deploy.sh --rollback       # restaure dernier snapshot sur VPS
```

### Windows PowerShell
```powershell
.\deploy.ps1                 # deploy standard
.\deploy.ps1 -DryRun         # preview (archive tar locale, pas d'upload)
.\deploy.ps1 -NoRestart      # push, skip pm2
.\deploy.ps1 -Rollback       # restaure snapshot
```

## Override via env vars

```bash
VPS_HOST=my-vps.example.com \
VPS_USER=deploy \
VPS_PORT=2222 \
PM2_NAME=snakecoin-bot-staging \
./deploy.sh
```

## Pipeline du script

1. **Pre-flight** : vérifie rsync/ssh présents, bot.js existe, clé SSH fonctionne
2. **Snapshot** : `rsync` current VPS content vers `/root/backups/bot-snapshots/<timestamp>/` (rotation: garde 5 derniers)
3. **Upload** : rsync incrémental avec exclusions (`node_modules`, `.env`, `logs`, `*.db`)
4. **Deps** : `npm ci --omit=dev` seulement si `package.json` plus récent que `node_modules`
5. **Reload** : `pm2 reload snakecoin-bot --update-env` (zero-downtime si cluster, graceful sinon)
6. **Healthcheck** : vérifie `pm2 describe snakecoin-bot | grep status.*online`
7. **Logs** : affiche les 10 dernières lignes pour validation visuelle

## Rollback

Si le healthcheck fail, le script termine avec exit 1 sans rollback auto (volontaire pour laisser le temps d'investiguer).

Pour revert manuellement :
```bash
./deploy.sh --rollback
```

## Exclusions rsync

- `.git/`, `.env`, `.env.*` — secrets + bazar version control
- `node_modules/` — re-installé côté VPS via npm ci
- `logs/`, `*.log` — générés par pm2
- `snake.db`, `snake.db-*` — DB locale ne doit jamais écraser celle du VPS
- `.DS_Store` — macOS cruft

## Sécurité

- `.env` strictement jamais pushé (double-check `.gitignore` + exclusion rsync)
- Clé SSH recommandée : `ed25519` avec passphrase + `ssh-agent`
- Permissions VPS : `.env` en `chmod 600`
- Fail2ban déjà actif (cf task #5) protège SSH brute force

## Intégration CI/CD (optionnel)

Le script peut être wrappé dans GitHub Actions avec secret `SSH_PRIVATE_KEY` :
```yaml
- uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.VPS_SSH_KEY }}
- run: |
    cd discord-bot-snacke
    VPS_HOST=${{ secrets.VPS_HOST }} ./deploy.sh
```

Mais pour un bot single-dev comme SnakeCoin, un run local post-commit est amplement suffisant.
