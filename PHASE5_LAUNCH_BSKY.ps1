# ============================================================
#  SnowDiablo Arcade - Publish Bluesky launch thread (5 posts)
#
#  Uses the existing admin endpoint /api/admin/bsky/post
#  (bypass local 5-min cooldown, one shot per call).
#
#  Requirements :
#    - Env var  ADMIN_TOKEN  set in the current PowerShell session
#      $env:ADMIN_TOKEN = "<copy from Railway Variables>"
#    - BSKY_HANDLE + BSKY_APP_PASSWORD already configured on Railway
#
#  Usage :
#    & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_BSKY.ps1"          # live
#    & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_BSKY.ps1" -DryRun  # preview only
# ============================================================

param(
    [switch]$DryRun,
    [int]$SpacingSeconds = 90   # delay between each post (Bluesky server rate-limit safety)
)

$ErrorActionPreference = 'Stop'
$api = "https://snake-backend-production-e5e8.up.railway.app/api/admin/bsky/post"

if (-not $env:ADMIN_TOKEN -and -not $DryRun) {
    Write-Host "ERROR: `$env:ADMIN_TOKEN is empty." -ForegroundColor Red
    Write-Host "  Set it first : `$env:ADMIN_TOKEN = '<paste from Railway Variables>'"
    exit 1
}

# -----------------------------------------------------------------
# Thread content - keep EACH post <= 300 chars (Bluesky hard limit)
# IMPORTANT : use SINGLE-quoted here-strings @'...'@ so $SNAKE stays literal
# (double-quoted @"..."@ would expand $SNAKE as a PS variable = empty string)
# -----------------------------------------------------------------
$posts = @(
@'
$SNAKE just became an arcade.

Launched as a solo snake game on Polygon. Today: 7 skill-based games, one token.

Play then earn $SNAKE on-chain. Leaderboard, NFTs, tournaments, clans.

No presale. No team tokens. 100% minted via gameplay.

https://snowdiablo.xyz
'@,
@'
The 7 games live right now:

- Snake (the OG)
- Pong
- Flappy
- Breakout
- Space Invaders
- 2048
- Minesweeper

All HTML5 canvas, 60 fps, mobile + desktop, 13 languages.

Every session is server-signed and claimable on Polygon.
'@,
@'
Economy:
- 10 pts = 1 $SNAKE (100 pts for 2048)
- Daily cap 100 $SNAKE / wallet
- Anti-cheat server-side (pts/sec + session duration)
- EIP-191 wallet proof before every claim
- No airdrop, no stamina bullshit

Pure reflex. Bring receipts.
'@,
@'
On-chain utility:
- NFT Trophies top 10 seasonal (SVG on-chain, EIP-2981)
- Boost NFTs: Basic +2% / Pro +4% / Elite +8%
- 24h tournaments (1 POL entry, 70/30/10)
- Clans - burn 1000 $SNAKE to create, weekly top-3 payout

$SNAKE has utility *before* DEX listing.
'@,
@'
DEX listing: TBA.

LP Fund bootstrapped organically from game usage. Public tracker: snowdiablo.xyz/lp-fund.html

Listing + lock happens when the fund hits target. No mercenary liquidity, no micro-pool pump.

Game works today. Come earn while it grows.

https://snowdiablo.xyz
'@
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " BLUESKY LAUNCH WAVE - 5 posts" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Endpoint  : $api"
Write-Host " Spacing   : $SpacingSeconds sec between posts"
Write-Host " Mode      : $(if ($DryRun) { 'DRY-RUN (no network)' } else { 'LIVE' })"
Write-Host ""

# ----- Length check first (abort before anything if any post > 300) -----
$failLen = $false
for ($i = 0; $i -lt $posts.Count; $i++) {
    $len = $posts[$i].Length
    $status = if ($len -le 300) { "OK " } else { "TOO LONG" }
    $color  = if ($len -le 300) { 'DarkGray' } else { 'Red' }
    Write-Host ("  Post {0} : {1} chars  [{2}]" -f ($i+1), $len, $status) -ForegroundColor $color
    if ($len -gt 300) { $failLen = $true }
}
if ($failLen) {
    Write-Host ""
    Write-Host "ABORT: at least one post exceeds 300 chars. Edit PHASE5_LAUNCH_BSKY.ps1 and retry." -ForegroundColor Red
    exit 1
}

if ($DryRun) {
    Write-Host ""
    Write-Host "--- DRY-RUN PREVIEW ---" -ForegroundColor Yellow
    for ($i = 0; $i -lt $posts.Count; $i++) {
        Write-Host ""
        Write-Host ("--- POST {0} ({1} chars) ---" -f ($i+1), $posts[$i].Length) -ForegroundColor DarkYellow
        Write-Host $posts[$i]
    }
    Write-Host ""
    Write-Host "Dry-run done. No network calls made." -ForegroundColor Yellow
    exit 0
}

# ----- Live publish -----
$headers = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
$results = @()

for ($i = 0; $i -lt $posts.Count; $i++) {
    $n    = $i + 1
    $text = $posts[$i]
    Write-Host ""
    Write-Host ">>> Posting $n / $($posts.Count) ($($text.Length) chars)..." -ForegroundColor Cyan
    try {
        $body = @{ text = $text } | ConvertTo-Json -Compress
        $r = Invoke-RestMethod -Method Post -Uri $api -Headers $headers -ContentType 'application/json' -Body $body
        if ($r.ok -eq $true) {
            Write-Host "  ok     : $($r.uri)" -ForegroundColor Green
            $results += [pscustomobject]@{ n = $n; ok = $true; uri = $r.uri; cid = $r.cid }
        } else {
            Write-Host "  failed : $($r.error)" -ForegroundColor Red
            $results += [pscustomobject]@{ n = $n; ok = $false; error = $r.error }
            Write-Host "  Stopping wave (manual recovery needed)." -ForegroundColor Yellow
            break
        }
    } catch {
        Write-Host "  HTTP error : $($_.Exception.Message)" -ForegroundColor Red
        $results += [pscustomobject]@{ n = $n; ok = $false; error = $_.Exception.Message }
        break
    }
    if ($n -lt $posts.Count) {
        Write-Host "  sleeping $SpacingSeconds sec..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $SpacingSeconds
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " Summary" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
$results | Format-Table -AutoSize

$ok  = ($results | Where-Object { $_.ok }).Count
$bad = ($results | Where-Object { -not $_.ok }).Count
Write-Host ""
Write-Host "  Published : $ok" -ForegroundColor Green
if ($bad -gt 0) {
    Write-Host "  Failed    : $bad" -ForegroundColor Red
    Write-Host "  Check Railway logs : railway logs --service snake-backend --follow | Select-String bsky"
    exit 1
}

Write-Host ""
Write-Host "Feed : https://bsky.app/profile/$env:BSKY_HANDLE" -ForegroundColor Cyan
Write-Host "(or just https://bsky.app/profile/snowdiablo.bsky.social)"
Write-Host ""
Write-Host "Next step : publish Discord embed" -ForegroundColor Yellow
Write-Host '  & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_DISCORD.ps1"'

# Force clean exit 0 - sinon $LASTEXITCODE herite d'une commande externe
# precedente (git push, etc.) et le wrapper croit que le step a failed.
exit 0
