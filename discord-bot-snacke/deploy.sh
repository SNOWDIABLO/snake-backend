#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# SnakeCoin Discord Bot — deploy local → VPS (idempotent, rollback-safe)
#
# Usage:
#   ./deploy.sh                   # full deploy
#   ./deploy.sh --dry-run         # rsync --dry-run (pas d'écriture)
#   ./deploy.sh --no-restart      # push files only, skip pm2
#   ./deploy.sh --rollback        # restaure snapshot précédent
#
# Requis côté local : rsync, ssh, bash >=4
# Requis côté VPS   : node >=20, pm2, répertoire ~/discord-bot-snacke existant,
#                     .env déjà configuré sur le VPS (jamais pushé depuis local)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── CONFIG (override via env) ────────────────────────────────────────────────
VPS_USER="${VPS_USER:-root}"
VPS_HOST="${VPS_HOST:-snowdiablo.xyz}"
VPS_PORT="${VPS_PORT:-22}"
VPS_PATH="${VPS_PATH:-/root/discord-bot-snacke}"
PM2_NAME="${PM2_NAME:-snakecoin-bot}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/bot-snapshots}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-5}"
HEALTH_CMD="${HEALTH_CMD:-pm2 describe ${PM2_NAME} | grep -E 'status.*online' -q}"

# Files / dirs à synchroniser (exclusions via --exclude plus bas)
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── COLOR LOG ────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET='\033[0m'; C_GREEN='\033[1;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[1;31m'; C_BLUE='\033[1;34m'
else
  C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi
log()  { echo -e "${C_BLUE}[$(date +%H:%M:%S)]${C_RESET} $*"; }
ok()   { echo -e "${C_GREEN}[OK]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
err()  { echo -e "${C_RED}[ERR]${C_RESET} $*" >&2; }

# ── ARGS ─────────────────────────────────────────────────────────────────────
DRY_RUN=0; NO_RESTART=0; ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --no-restart) NO_RESTART=1 ;;
    --rollback)   ROLLBACK=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"; exit 0 ;;
    *) err "Arg inconnu: $arg"; exit 2 ;;
  esac
done

SSH="ssh -p ${VPS_PORT} -o ServerAliveInterval=30 ${VPS_USER}@${VPS_HOST}"

# ── ROLLBACK ─────────────────────────────────────────────────────────────────
if [[ $ROLLBACK -eq 1 ]]; then
  log "Rollback: restoration du dernier snapshot..."
  $SSH bash -s <<EOSSH
set -e
LAST=\$(ls -1dt ${BACKUP_DIR}/*/ 2>/dev/null | head -n1 || true)
if [[ -z "\$LAST" ]]; then echo "Aucun snapshot trouvé dans ${BACKUP_DIR}"; exit 1; fi
echo "Restore depuis \$LAST"
rsync -a --delete "\$LAST" "${VPS_PATH}/"
pm2 restart ${PM2_NAME} --update-env
pm2 save
EOSSH
  ok "Rollback effectué"
  exit 0
fi

# ── PRE-FLIGHT ───────────────────────────────────────────────────────────────
log "Pre-flight check..."
command -v rsync >/dev/null || { err "rsync requis"; exit 1; }
command -v ssh   >/dev/null || { err "ssh requis"; exit 1; }
[[ -f "${LOCAL_DIR}/bot.js" ]] || { err "bot.js introuvable dans ${LOCAL_DIR}"; exit 1; }
[[ -f "${LOCAL_DIR}/package.json" ]] || { err "package.json manquant"; exit 1; }

# Vérifie que .env local N'EST PAS poussé (paranoïa)
if grep -qE '^\.env$' "${LOCAL_DIR}/.gitignore" 2>/dev/null; then
  ok ".env bien exclu via .gitignore"
fi

# Test SSH
log "Test SSH vers ${VPS_USER}@${VPS_HOST}:${VPS_PORT}..."
if ! $SSH -o ConnectTimeout=10 -o BatchMode=yes "echo OK" >/dev/null 2>&1; then
  err "Connexion SSH impossible. Configure la clé SSH ou SSH agent."
  exit 1
fi
ok "SSH OK"

# Version Node côté VPS
NODE_VERSION_REMOTE=$($SSH "node -v 2>/dev/null || echo 'none'")
log "Node VPS: ${NODE_VERSION_REMOTE}"

# ── BACKUP SNAPSHOT AVANT DEPLOY ─────────────────────────────────────────────
if [[ $DRY_RUN -eq 0 ]]; then
  TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
  log "Snapshot actuel VPS → ${BACKUP_DIR}/${TIMESTAMP}/"
  $SSH bash -s <<EOSSH
set -e
mkdir -p ${BACKUP_DIR}/${TIMESTAMP}
if [[ -d ${VPS_PATH} ]]; then
  rsync -a --exclude='node_modules' --exclude='logs' --exclude='.env' --exclude='snake.db*' \
    ${VPS_PATH}/ ${BACKUP_DIR}/${TIMESTAMP}/
fi
# Purge old snapshots (keep KEEP_SNAPSHOTS most recent)
cd ${BACKUP_DIR} && ls -1dt */ 2>/dev/null | tail -n +$((${KEEP_SNAPSHOTS}+1)) | xargs -r rm -rf
EOSSH
  ok "Snapshot créé"
fi

# ── RSYNC ────────────────────────────────────────────────────────────────────
log "Rsync ${LOCAL_DIR} → ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
RSYNC_FLAGS=(
  -az
  --delete
  --info=progress2,stats1
  -e "ssh -p ${VPS_PORT}"
  --exclude='.git/'
  --exclude='node_modules/'
  --exclude='logs/'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='snake.db'
  --exclude='snake.db-*'
  --exclude='*.log'
  --exclude='.DS_Store'
  --exclude='deploy.sh.bak'
)
[[ $DRY_RUN -eq 1 ]] && RSYNC_FLAGS+=(--dry-run) && warn "DRY-RUN: aucun écriture"

rsync "${RSYNC_FLAGS[@]}" "${LOCAL_DIR}/" "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"
ok "Rsync terminé"

if [[ $DRY_RUN -eq 1 ]]; then
  log "DRY-RUN fini. Aucun restart."
  exit 0
fi

# ── INSTALL DEPS + MIGRATIONS ────────────────────────────────────────────────
log "npm ci --omit=dev + validation .env sur VPS..."
$SSH bash -s <<EOSSH
set -e
cd ${VPS_PATH}
if [[ ! -f .env ]]; then
  echo "❌ .env manquant sur le VPS — crée-le manuellement avant deploy"
  exit 1
fi
# Install deps si package.json / package-lock ont changé
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]] || [[ package-lock.json -nt node_modules 2>/dev/null ]]; then
  echo "→ npm ci --omit=dev"
  npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -n 5
else
  echo "→ node_modules à jour, skip npm ci"
fi
EOSSH
ok "Deps OK"

# ── RESTART PM2 ──────────────────────────────────────────────────────────────
if [[ $NO_RESTART -eq 1 ]]; then
  warn "Skip pm2 restart (--no-restart)"
  exit 0
fi

log "Reload PM2 (${PM2_NAME})..."
$SSH bash -s <<EOSSH
set -e
cd ${VPS_PATH}
if pm2 describe ${PM2_NAME} >/dev/null 2>&1; then
  pm2 reload ${PM2_NAME} --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save >/dev/null
EOSSH
ok "PM2 reload"

# ── HEALTHCHECK ──────────────────────────────────────────────────────────────
log "Healthcheck (attente 5s avant vérif)..."
sleep 5
if $SSH "${HEALTH_CMD}" 2>/dev/null; then
  ok "Bot online ✅"
else
  err "Healthcheck FAIL — status non online"
  $SSH "pm2 logs ${PM2_NAME} --lines 30 --nostream" || true
  warn "Rollback disponible: ./deploy.sh --rollback"
  exit 1
fi

# ── TAIL RECENT LOGS ─────────────────────────────────────────────────────────
log "Derniers logs:"
$SSH "pm2 logs ${PM2_NAME} --lines 10 --nostream" | tail -n 15 || true

ok "🚀 Deploy terminé avec succès"
