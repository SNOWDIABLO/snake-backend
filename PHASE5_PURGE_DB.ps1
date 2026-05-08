# ============================================================
#  SnowDiablo Arcade — CRITIQUE : purge DB + backups du repo public
#
#  Un snake-2026-04-22.db (+ admin.html.bak + server.js.bak) a leaké
#  dans le commit 2e1c6af sur github.com/SnowDiablo/snake-backend (public).
#
#  Ce script :
#   1. audit le contenu de la DB (tables + row counts)
#   2. git rm les 3 fichiers + update .gitignore
#   3. commit normal
#   4. purge de l'historique git (git filter-repo)
#   5. force-push origin main
#   6. affiche recommendations rotation secrets selon contenu
#
#  Usage :
#    cd C:\dev\snake-backend
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_PURGE_DB.ps1"
# ============================================================

$ErrorActionPreference = 'Stop'
$dst = "C:\dev\snake-backend"
Set-Location $dst

$dbFile    = "snake-2026-04-22.db"
$bakFiles  = @("admin.html.bak","server.js.bak")
$leakFiles = @($dbFile) + $bakFiles

Write-Host "=============================================" -ForegroundColor Red
Write-Host " SECURITY PURGE - Public repo leak cleanup"    -ForegroundColor Red
Write-Host "=============================================" -ForegroundColor Red

# ----- Step 1 : audit DB contents -----
Write-Host ""
Write-Host "[1/6] Audit $dbFile" -ForegroundColor Cyan
if (Test-Path "$dst\$dbFile") {
    $sz = (Get-Item "$dst\$dbFile").Length
    Write-Host "  size : $sz bytes"
    # Try python3 then python — if neither available, skip audit but still purge
    $py = (Get-Command python3 -ErrorAction SilentlyContinue) `
        -or (Get-Command python  -ErrorAction SilentlyContinue)
    if ($py) {
        $exe = if (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "python" }
        & $exe -c @"
import sqlite3
c = sqlite3.connect(r'$dst\$dbFile')
tables = [r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\").fetchall()]
print('  tables :', len(tables))
for t in tables:
    try:
        n = c.execute(f'SELECT COUNT(*) FROM \"{t}\"').fetchone()[0]
        print(f'    {t:30s} {n:>6} rows')
    except Exception as e:
        print(f'    {t:30s} ERR {e}')
"@
    } else {
        Write-Host "  (python non dispo - audit skip)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  file not present in mirror - already cleaned ?" -ForegroundColor Yellow
}

# ----- Step 2 : update .gitignore -----
Write-Host ""
Write-Host "[2/6] Update .gitignore (bak + date-suffixed .db)" -ForegroundColor Cyan
$gi = Join-Path $dst ".gitignore"
$giContent = if (Test-Path $gi) { Get-Content $gi -Raw } else { "" }
$additions = @"

# Backup files
*.bak
*.orig

# Date-stamped DB dumps (local backups, never commit)
snake-*.db
snake-*.db-journal
snake-*-backup.db
"@
if ($giContent -notmatch [regex]::Escape("snake-*.db")) {
    Add-Content -Path $gi -Value $additions
    Write-Host "  .gitignore updated"
} else {
    Write-Host "  .gitignore already has the rules"
}

# ----- Step 3 : git rm + commit -----
Write-Host ""
Write-Host "[3/6] Remove leak files from HEAD and commit" -ForegroundColor Cyan
foreach ($f in $leakFiles) {
    if (git ls-files $f) {
        git rm -f --quiet -- $f
        Write-Host "  rm $f"
    }
}
git add .gitignore
git commit -m "security(repo): remove leaked DB + .bak files from HEAD

- snake-2026-04-22.db (accidental DB snapshot)
- admin.html.bak, server.js.bak

Also :
- .gitignore now excludes *.bak, *.orig, snake-*.db, snake-*-backup.db
- Historical commit 2e1c6af will be purged separately via git filter-repo"

# ----- Step 4 : install git-filter-repo if needed -----
Write-Host ""
Write-Host "[4/6] Check for git-filter-repo" -ForegroundColor Cyan
$hasFR = $null
try { $hasFR = git filter-repo --help 2>&1 | Select-String -Pattern 'filter-repo' -Quiet } catch {}
if (-not $hasFR) {
    Write-Host "  installing git-filter-repo via pip..." -ForegroundColor Yellow
    pip install git-filter-repo --quiet 2>&1 | Out-Null
    $hasFR = git filter-repo --help 2>&1 | Select-String -Pattern 'filter-repo' -Quiet
}

if (-not $hasFR) {
    Write-Host ""
    Write-Host "  git-filter-repo not available. Fallback path :" -ForegroundColor Yellow
    Write-Host "    1. pip install git-filter-repo"
    Write-Host "       OR download :  https://github.com/newren/git-filter-repo/releases"
    Write-Host "       drop git-filter-repo.py into a PATH folder as 'git-filter-repo'"
    Write-Host "    2. Rerun this script"
    Write-Host ""
    Write-Host "  Alternative without filter-repo : BFG Repo-Cleaner" -ForegroundColor Yellow
    Write-Host "    java -jar bfg.jar --delete-files snake-2026-04-22.db"
    Write-Host "    java -jar bfg.jar --delete-files 'admin.html.bak'"
    Write-Host "    java -jar bfg.jar --delete-files 'server.js.bak'"
    Write-Host "    git reflog expire --expire=now --all && git gc --prune=now --aggressive"
    Write-Host "    git push --force origin main"
    Write-Host ""
    Write-Host "  Pushing the HEAD cleanup commit (leak still in history)..." -ForegroundColor Yellow
    git push origin main
    exit 1
}

# ----- Step 5 : purge history + force push -----
Write-Host ""
Write-Host "[5/6] Purge leak files from git history (rewrites commits!)" -ForegroundColor Cyan
Write-Host "  This will rewrite every commit that touched these files."
Write-Host "  After force-push, anyone with a local clone must re-clone."
Write-Host ""
$confirm = Read-Host "  Continue ? (yes / no)"
if ($confirm -ne 'yes') {
    Write-Host "  Aborted by user. HEAD commit was pushed but history still contains leak." -ForegroundColor Yellow
    git push origin main
    exit 1
}

foreach ($f in $leakFiles) {
    Write-Host "  purging history : $f"
    git filter-repo --force --invert-paths --path $f
}

# filter-repo removes origin remote for safety - re-add it
git remote add origin https://github.com/SnowDiablo/snake-backend.git 2>$null
git push --force origin main

# ----- Step 6 : recommendations -----
Write-Host ""
Write-Host "[6/6] Post-purge recommendations" -ForegroundColor Cyan
$recap = @'
  - Any secret value that was in the DB (nonces, signatures, keys, emails)
    should be considered LEAKED. Rotate if applicable :
      * SIGNER_PK if it was anywhere near the DB (should NOT be, but audit above)
      * ADMIN_TOKEN (easy : regenerate + update Railway env)
      * WebHostOp FTP password (unrelated but good hygiene)

  - Invalidate open proof_nonces in prod DB :
      Run from Railway shell (after : apt-get install -y sqlite3) :
      sqlite3 /data/snake.db "DELETE FROM proof_nonces WHERE ts < strftime('%s','now','-24 hours');"

  - GitHub cached clone invalidation : delete repo + recreate if paranoid
      (brutal but effective ; alternative = GitHub Support ticket to purge CDN)

  - Audit GitHub Insights | Traffic : count unique clones since 2e1c6af push
'@
Write-Host $recap
Write-Host ""
Write-Host "DONE." -ForegroundColor Green
