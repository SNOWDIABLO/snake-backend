# ============================================================
#  SnowDiablo Arcade — Phase 5 ship script
#  Run from PowerShell, NOT from OneDrive folder.
#  Usage :
#    cd C:\dev\snake-backend ; & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_SHIP.ps1"
# ============================================================

$ErrorActionPreference = 'Stop'

$src = "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend"
$dst = "C:\dev\snake-backend"

if (-not (Test-Path $dst)) {
    Write-Host "[setup] Cloning mirror to $dst ..." -ForegroundColor Yellow
    git clone https://github.com/SnowDiablo/snake-backend.git $dst
}

Write-Host "[1/5] Sync OneDrive -> mirror (robocopy, excluding node_modules/.git/.env/snake.db)" -ForegroundColor Cyan
robocopy $src $dst /E /XD node_modules .git dist /XF .env snake.db *.db-journal | Out-Null

Set-Location $dst

Write-Host "[2/5] git status" -ForegroundColor Cyan
git status --short

Write-Host "[3/5] Staging changes" -ForegroundColor Cyan
git add -A

$msg = @"
feat(arcade): Phase 5 - 6 canvas games shipped (Pong/Flappy/Breakout/Invaders/2048/Minesweeper)

Engines (src/*-game.js) :
 - pong-game.js       800x400  - AI adaptatif, rally scoring
 - flappy-game.js     400x600  - gravity/jump, difficulty ramp
 - breakout-game.js   720x480  - 6x12 bricks, refill on clear
 - invaders-game.js   720x540  - wave progression, alien bombs
 - game2048-game.js   500x500  - slide+merge rotate algorithm
 - minesweeper-game.js 400x400 - flood fill, first-click safety

Bootstrap (src/main-*.js) : wallet-gated, sessionStart({game: ID}) for Phase 4 backend
Styles   (src/*-style.css): shared base (~13.4 kB gzip 2.79)
Pages    ({game}/index.html): HUD + canvas + widgets (player/quests/tournament/clans/boost)
i18n     : 13 locales x 183 keys (+61 new per locale)

Vite build : 11 pages OK, bundles 7-10 kB JS each.

Ratio : 10 pts = 1 `$SNAKE (all games except 2048 = 100 pts = 1 `$SNAKE)
Normalized IDs : snake | pong | flappy | breakout | space-invaders | 2048 | minesweeper
"@

Write-Host "[4/5] Commit" -ForegroundColor Cyan
git commit -m $msg

Write-Host "[5/5] Push origin main (triggers Railway + GH Actions FTP)" -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "OK. Deploy pipelines kicked off :" -ForegroundColor Green
Write-Host "  Railway  -> https://snake-backend-production-e5e8.up.railway.app/health"
Write-Host "  WebHostOp-> https://snowdiablo.xyz/ (Actions FTP)"
Write-Host ""
Write-Host "Smoke tests :"
Write-Host '  iwr https://snake-backend-production-e5e8.up.railway.app/health -UseBasicParsing | % Content'
Write-Host '  iwr https://snowdiablo.xyz/pong/           -UseBasicParsing | % StatusCode'
Write-Host '  iwr https://snowdiablo.xyz/flappy/         -UseBasicParsing | % StatusCode'
Write-Host '  iwr https://snowdiablo.xyz/breakout/       -UseBasicParsing | % StatusCode'
Write-Host '  iwr https://snowdiablo.xyz/space-invaders/ -UseBasicParsing | % StatusCode'
Write-Host '  iwr https://snowdiablo.xyz/2048/           -UseBasicParsing | % StatusCode'
Write-Host '  iwr https://snowdiablo.xyz/minesweeper/    -UseBasicParsing | % StatusCode'
