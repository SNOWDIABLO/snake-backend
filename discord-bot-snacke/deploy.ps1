# ─────────────────────────────────────────────────────────────────────────────
# SnakeCoin Discord Bot — PowerShell deploy local (Windows) → VPS Linux
#
# Usage:
#   .\deploy.ps1                   # full deploy
#   .\deploy.ps1 -DryRun           # scp --dry-run (stage seulement)
#   .\deploy.ps1 -NoRestart        # push files only, skip pm2
#   .\deploy.ps1 -Rollback         # restaure dernier snapshot sur VPS
#
# Prérequis Windows :
#   - OpenSSH client (Windows 10/11 built-in) : ssh, scp
#   - Clé SSH configurée (ssh-add ~/.ssh/id_ed25519)
#   - Le VPS possède : node >=20, pm2, dossier ~/discord-bot-snacke avec .env
# ─────────────────────────────────────────────────────────────────────────────
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$NoRestart,
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'

# ── CONFIG (override via env vars) ───────────────────────────────────────────
$VPS_USER       = if ($env:VPS_USER) { $env:VPS_USER } else { 'root' }
$VPS_HOST       = if ($env:VPS_HOST) { $env:VPS_HOST } else { 'snowdiablo.xyz' }
$VPS_PORT       = if ($env:VPS_PORT) { $env:VPS_PORT } else { '22' }
$VPS_PATH       = if ($env:VPS_PATH) { $env:VPS_PATH } else { '/root/discord-bot-snacke' }
$PM2_NAME       = if ($env:PM2_NAME) { $env:PM2_NAME } else { 'snakecoin-bot' }
$BACKUP_DIR     = '/root/backups/bot-snapshots'
$KEEP_SNAPSHOTS = 5

$LOCAL_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$REMOTE    = "${VPS_USER}@${VPS_HOST}"
$SSH_OPTS  = @('-p', $VPS_PORT, '-o', 'ServerAliveInterval=30')

function Log($msg)  { Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Err($msg)  { Write-Host "[ERR] $msg" -ForegroundColor Red }

function Invoke-SSH($cmd) {
    $args = @() + $SSH_OPTS + @($REMOTE, $cmd)
    & ssh @args
    if ($LASTEXITCODE -ne 0) { throw "SSH exit $LASTEXITCODE: $cmd" }
}

# ── ROLLBACK ─────────────────────────────────────────────────────────────────
if ($Rollback) {
    Log "Rollback: restore dernier snapshot..."
    $rollbackCmd = @"
set -e
LAST=\$(ls -1dt ${BACKUP_DIR}/*/ 2>/dev/null | head -n1 || true)
if [[ -z "\$LAST" ]]; then echo "Aucun snapshot trouvé"; exit 1; fi
echo "Restore depuis \$LAST"
rsync -a --delete "\$LAST" "${VPS_PATH}/"
pm2 restart ${PM2_NAME} --update-env
pm2 save
"@
    Invoke-SSH "bash -c '$rollbackCmd'"
    Ok "Rollback effectué"
    exit 0
}

# ── PRE-FLIGHT ───────────────────────────────────────────────────────────────
Log "Pre-flight check..."
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Err "ssh non trouvé. Active OpenSSH Client dans Windows Features."; exit 1
}
if (-not (Get-Command scp -ErrorAction SilentlyContinue)) {
    Err "scp non trouvé."; exit 1
}
if (-not (Test-Path "$LOCAL_DIR\bot.js")) {
    Err "bot.js introuvable dans $LOCAL_DIR"; exit 1
}

Log "Test SSH vers ${REMOTE}:${VPS_PORT}..."
try {
    & ssh @SSH_OPTS -o ConnectTimeout=10 -o BatchMode=yes $REMOTE 'echo OK' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "exit $LASTEXITCODE" }
    Ok "SSH OK"
} catch {
    Err "Connexion SSH impossible: $_"; exit 1
}

$nodeVersion = & ssh @SSH_OPTS $REMOTE 'node -v 2>/dev/null || echo none'
Log "Node VPS: $nodeVersion"

# ── STAGING : tar local excluant les dossiers non-souhaités ──────────────────
$stagingTar = Join-Path $env:TEMP "snake-bot-deploy-$((Get-Date).ToString('yyyyMMddHHmmss')).tar"
Log "Création archive staging: $stagingTar"

# Utilise tar Windows built-in (bsdtar) - exclusions
$excludeArgs = @(
    '--exclude=.git', '--exclude=node_modules', '--exclude=logs',
    '--exclude=.env', '--exclude=.env.*', '--exclude=snake.db',
    '--exclude=snake.db-*', '--exclude=*.log', '--exclude=.DS_Store'
)
Push-Location $LOCAL_DIR
try {
    & tar -cf $stagingTar @excludeArgs .
    if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally { Pop-Location }

$archiveSize = [math]::Round((Get-Item $stagingTar).Length / 1KB, 1)
Ok "Archive prête: ${archiveSize} KB"

if ($DryRun) {
    Warn "DRY-RUN: archive créée, pas d'upload. Contenu:"
    & tar -tf $stagingTar | Select-Object -First 30
    Remove-Item $stagingTar -Force
    exit 0
}

# ── SNAPSHOT VPS ─────────────────────────────────────────────────────────────
$ts = (Get-Date -AsUTC).ToString('yyyyMMdd-HHmmss')
Log "Snapshot VPS → ${BACKUP_DIR}/${ts}/"
$snapCmd = @"
set -e
mkdir -p ${BACKUP_DIR}/${ts}
if [[ -d ${VPS_PATH} ]]; then
  rsync -a --exclude='node_modules' --exclude='logs' --exclude='.env' --exclude='snake.db*' \
    ${VPS_PATH}/ ${BACKUP_DIR}/${ts}/
fi
cd ${BACKUP_DIR} && ls -1dt */ 2>/dev/null | tail -n +$(($KEEP_SNAPSHOTS+1)) | xargs -r rm -rf
"@
Invoke-SSH "bash -c '$snapCmd'"
Ok "Snapshot créé"

# ── UPLOAD + EXTRACTION ──────────────────────────────────────────────────────
$remoteTar = "/tmp/snake-bot-deploy.tar"
Log "Upload archive vers VPS..."
& scp -P $VPS_PORT $stagingTar "${REMOTE}:${remoteTar}"
if ($LASTEXITCODE -ne 0) { Err "scp failed"; exit 1 }
Remove-Item $stagingTar -Force

Log "Extraction sur VPS..."
$extractCmd = @"
set -e
mkdir -p ${VPS_PATH}
cd ${VPS_PATH}
tar -xf ${remoteTar} --overwrite
rm -f ${remoteTar}
if [[ ! -f .env ]]; then echo '❌ .env manquant'; exit 1; fi
if [[ ! -d node_modules ]] || [[ package.json -nt node_modules ]]; then
  npm ci --omit=dev --no-audit --no-fund 2>&1 | tail -n 5
else
  echo '→ node_modules à jour'
fi
"@
Invoke-SSH "bash -c '$extractCmd'"
Ok "Déploiement files OK"

# ── RESTART PM2 ──────────────────────────────────────────────────────────────
if ($NoRestart) {
    Warn "Skip pm2 restart (-NoRestart)"; exit 0
}

Log "Reload PM2 ($PM2_NAME)..."
$pmCmd = @"
set -e
cd ${VPS_PATH}
if pm2 describe ${PM2_NAME} >/dev/null 2>&1; then
  pm2 reload ${PM2_NAME} --update-env
else
  pm2 start ecosystem.config.js
fi
pm2 save >/dev/null
"@
Invoke-SSH "bash -c '$pmCmd'"
Ok "PM2 reload"

# ── HEALTHCHECK ──────────────────────────────────────────────────────────────
Log "Healthcheck (5s)..."
Start-Sleep -Seconds 5
$health = & ssh @SSH_OPTS $REMOTE "pm2 describe $PM2_NAME | grep -E 'status.*online' -q && echo OK || echo FAIL"
if ($health -match 'OK') {
    Ok "Bot online"
} else {
    Err "Healthcheck FAIL"
    & ssh @SSH_OPTS $REMOTE "pm2 logs $PM2_NAME --lines 30 --nostream"
    Warn "Rollback: .\deploy.ps1 -Rollback"
    exit 1
}

Log "Derniers logs:"
& ssh @SSH_OPTS $REMOTE "pm2 logs $PM2_NAME --lines 10 --nostream"

Ok "🚀 Deploy terminé avec succès"
