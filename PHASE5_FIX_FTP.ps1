# ============================================================
#  SnowDiablo Arcade — Fix FTP workflow (deploy-arcade.yml)
#  - Nettoie les vite.config.js.timestamp-*.mjs (restent lockés côté OneDrive depuis le sandbox)
#  - Untrack ces fichiers côté git + syncs le nouveau .gitignore / workflow
#  - Commit + push : declenche deploy-arcade.yml (Vite build + FTP dist/)
#
#  Usage :
#    cd C:\dev\snake-backend
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_FIX_FTP.ps1"
# ============================================================

$ErrorActionPreference = 'Stop'

$src = "$env:USERPROFILE\OneDrive\claude creation\snake-backend"
$dst = "C:\dev\snake-backend"

if (-not (Test-Path $dst)) {
    Write-Host "[setup] Cloning mirror to $dst ..." -ForegroundColor Yellow
    git clone https://github.com/SnowDiablo/snake-backend.git $dst
}

Write-Host "[1/7] Delete vite.config.js.timestamp-*.mjs in OneDrive (PowerShell bypass)" -ForegroundColor Cyan
$stamps = Get-ChildItem "$src\frontend-v2" -Filter 'vite.config.js.timestamp-*.mjs' -ErrorAction SilentlyContinue
if ($stamps) {
    $stamps | ForEach-Object { Write-Host "  rm $($_.Name)" ; Remove-Item -Force $_.FullName }
} else {
    Write-Host "  (none found)"
}

Write-Host "[2/7] Sync OneDrive -> mirror" -ForegroundColor Cyan
# /MIR miroir exact (y compris suppressions) - scope limité à frontend-v2 + workflows + .gitignore
robocopy $src $dst /E /XD node_modules .git dist .vite /XF .env snake.db *.db-journal | Out-Null

Set-Location $dst

Write-Host "[3/7] Untrack timestamp files (git rm --cached)" -ForegroundColor Cyan
git ls-files "frontend-v2/vite.config.js.timestamp-*.mjs" 2>$null | ForEach-Object {
    Write-Host "  untrack $_"
    git rm --cached --quiet -- $_
}

Write-Host "[4/7] git status" -ForegroundColor Cyan
git status --short

Write-Host "[5/7] Staging changes" -ForegroundColor Cyan
git add -A

$msg = @"
ci(frontend): fix FTP workflow - build Vite + deploy frontend-v2/dist/

Problem : old deploy.yml only triggered on root *.html and didn't build Vite,
so /snake/, /pong/, /flappy/, etc. returned 404 after Phase 5 push.

Changes :
 - Add .github/workflows/deploy-arcade.yml
     - triggers on frontend-v2/**, admin.html, logos, workflow itself
     - setup-node 18 + npm ci + vite build in frontend-v2/
     - copy legacy files (admin, hall-of-fame, lp-fund, logos) into dist/
     - FTP dist/ -> public_html/ (delta sync via state file)
 - Disable old deploy.yml (workflow_dispatch only, manual recovery)
 - Add root .gitignore (covers .env, node_modules/, dist/,
   vite.config.js.timestamp-*.mjs, *.sqlite, OS junk)
 - Untrack 17 accidental vite.config.js.timestamp-*.mjs files
"@

Write-Host "[6/7] Commit" -ForegroundColor Cyan
git commit -m $msg

Write-Host "[7/7] Push origin main" -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "Done. Watch the Action :" -ForegroundColor Green
Write-Host "  https://github.com/SnowDiablo/snake-backend/actions"
Write-Host ""
Write-Host "After ~3 min :" -ForegroundColor Yellow
Write-Host '  foreach ($p in "", "snake","pong","flappy","breakout","space-invaders","2048","minesweeper","leaderboard","profile","lp-fund","admin") {'
Write-Host '    try {'
Write-Host '      $code = (iwr "https://snowdiablo.xyz/$p/" -UseBasicParsing -Method Head).StatusCode'
Write-Host '    } catch {'
Write-Host '      $code = $_.Exception.Response.StatusCode.value__'
Write-Host '    }'
Write-Host '    "{0,-18} {1}" -f "/$p/", $code'
Write-Host '  }'
