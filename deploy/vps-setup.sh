#!/usr/bin/env bash
# ============================================================================
# snake-backend — VPS one-shot setup
# Target: Ubuntu 22.04 / 24.04 LTS on 65.75.209.135 (snowdiablo.xyz host)
#
# This script is IDEMPOTENT — safe to re-run. It will skip what's already done.
#
# Usage (as root or via sudo):
#   curl -fsSL https://raw.githubusercontent.com/SnowDiablo/snake-backend/main/deploy/vps-setup.sh | sudo bash -s -- <subdomain>
#   # or, after cloning:
#   sudo bash deploy/vps-setup.sh <subdomain>
#
# Example:
#   sudo bash deploy/vps-setup.sh api.snowdiablo.xyz
# ============================================================================
set -euo pipefail

SUBDOMAIN="${1:-}"
if [ -z "$SUBDOMAIN" ]; then
  echo "Usage: $0 <subdomain>  (e.g. api.snowdiablo.xyz)"
  exit 1
fi

APP_DIR="/var/www/snake-backend"
DATA_DIR="$APP_DIR/data"
LOG_DIR="/var/log/snake-backend"
REPO_URL="https://github.com/SnowDiablo/snake-backend.git"
NODE_MAJOR=18

echo "==> [1/9] apt update + base packages"
apt-get update -y
apt-get install -y curl git ufw nginx ca-certificates gnupg lsb-release build-essential python3

echo "==> [2/9] Node.js ${NODE_MAJOR}.x (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" != "$NODE_MAJOR" ]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> [3/9] PM2 global"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
pm2 -v

echo "==> [4/9] App directory + log directory"
mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
chown -R www-data:www-data "$APP_DIR" "$LOG_DIR"

echo "==> [5/9] npm install --omit=dev"
cd "$APP_DIR"
sudo -u www-data npm install --omit=dev
# better-sqlite3 needs native compile — build-essential covers that.

echo "==> [6/9] .env file check"
if [ ! -f "$APP_DIR/.env" ]; then
  echo ""
  echo "!! WARNING: $APP_DIR/.env is missing."
  echo "!! Copy your Railway env vars to $APP_DIR/.env before starting PM2."
  echo "!! Critical keys: SIGNER_PK, ADMIN_TOKEN, CONTRACT_ADDRESS,"
  echo "!! NFT_CONTRACT_ADDRESS, BOOST_NFT_ADDRESS, DISCORD_WEBHOOK..."
  echo "!! Set DB_PATH=$DATA_DIR/snake.db  (NOT /data/snake.db — that was Railway)"
  echo ""
fi

echo "==> [7/9] UFW firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true
ufw status

echo "==> [8/9] nginx site"
NGINX_CONF="/etc/nginx/sites-available/snake-backend"
if [ ! -f "$NGINX_CONF" ]; then
  sed "s/SUBDOMAIN_PLACEHOLDER/${SUBDOMAIN}/g" "$APP_DIR/deploy/nginx-snake-api.conf" > "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/snake-backend
fi
nginx -t
systemctl reload nginx

echo "==> [9/9] certbot SSL"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get install -y certbot python3-certbot-nginx
fi
echo "Running: certbot --nginx -d ${SUBDOMAIN}"
certbot --nginx -d "${SUBDOMAIN}" --non-interactive --agree-tos --redirect \
  --email "$(grep -E '^USERNAME_FEE_WALLET|^DISCORD_WEBHOOK' "$APP_DIR/.env" >/dev/null 2>&1 && echo admin@snowdiablo.xyz || echo admin@example.com)" \
  || echo "certbot non-interactive failed — re-run manually: certbot --nginx -d ${SUBDOMAIN}"

echo ""
echo "============================================================"
echo "  Setup complete."
echo ""
echo "  Next steps:"
echo "    1. Edit $APP_DIR/.env with real values (from Railway)."
echo "    2. Drop your Railway snake.db backup at $DATA_DIR/snake.db"
echo "       chown www-data:www-data $DATA_DIR/snake.db"
echo "    3. Start PM2:"
echo "         cd $APP_DIR"
echo "         sudo -u www-data pm2 start ecosystem.config.js"
echo "         sudo -u www-data pm2 save"
echo "         pm2 startup systemd -u www-data --hp /var/www"
echo "    4. Smoke test:"
echo "         curl https://${SUBDOMAIN}/health"
echo "============================================================"
