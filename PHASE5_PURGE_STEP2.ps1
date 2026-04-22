# ============================================================
#  Continuation : git filter-repo + force-push
#  PHASE5_PURGE_DB.ps1 a deja fait l'audit + HEAD cleanup (commit 831c86f).
#  Ce script continue a partir de l'etape "purge history".
# ============================================================

$ErrorActionPreference = 'Stop'
Set-Location C:\dev\snake-backend

$leakFiles = @(
    "snake-2026-04-22.db",
    "admin.html.bak",
    "server.js.bak"
)

# ----- Step A : ajoute le path Python Scripts au PATH de session -----
$pyScripts = "$env:LOCALAPPDATA\Packages\PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0\LocalCache\local-packages\Python312\Scripts"
if (Test-Path $pyScripts) {
    $env:PATH = "$pyScripts;$env:PATH"
    Write-Host "[PATH] + $pyScripts" -ForegroundColor DarkGray
}

# ----- Step B : verifie git-filter-repo -----
Write-Host ""
Write-Host "[1/3] Verify git-filter-repo" -ForegroundColor Cyan
$frPath = (Get-Command git-filter-repo -ErrorAction SilentlyContinue).Source
if (-not $frPath) {
    # Essai via le path direct
    $candidate = Join-Path $pyScripts "git-filter-repo.exe"
    if (Test-Path $candidate) {
        $frPath = $candidate
    } else {
        Write-Host "  NOT FOUND. Try : pip install git-filter-repo" -ForegroundColor Red
        exit 1
    }
}
Write-Host "  found : $frPath"

# ----- Step C : purge chaque fichier leak de toute l'historique -----
Write-Host ""
Write-Host "[2/3] Purging from git history (rewrites commits!)" -ForegroundColor Cyan
Write-Host "  Files that will be scrubbed from every commit :"
foreach ($f in $leakFiles) { Write-Host "    - $f" }
Write-Host ""
$confirm = Read-Host "  Continue ? (yes / no)"
if ($confirm -ne 'yes') {
    Write-Host "  Aborted." -ForegroundColor Yellow
    exit 1
}

foreach ($f in $leakFiles) {
    Write-Host "  purging : $f" -ForegroundColor DarkYellow
    & $frPath --force --invert-paths --path $f
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  filter-repo failed on $f (exit $LASTEXITCODE)" -ForegroundColor Red
        exit 1
    }
}

# filter-repo vire origin pour securite : on le remet
Write-Host ""
Write-Host "[3/3] Re-add origin + force-push" -ForegroundColor Cyan
git remote remove origin 2>$null | Out-Null
git remote add origin https://github.com/SnowDiablo/snake-backend.git
git push --force origin main

# ----- Recap post-purge -----
$recap = @'

============================================================
 POST-PURGE ACTIONS (based on audit of snake-2026-04-22.db)
============================================================

Leak contents (no secrets found, only user data) :
  - sessions          30 rows
  - claims            15 rows (on-chain tx already public anyway)
  - leaderboard        3 rows (wallet addresses + scores)
  - usernames          2 rows
  - tournament_entries 2 rows
  - proof_nonces       0 rows  <-- GOOD, no active auth tokens
  - score_history     39 rows
  - boost_mult_cache   5 rows
  - daily_claims       6 rows
  - seasons            1 row
  - clan_weekly_payouts 1 row
  - tournaments        3 rows

Risk assessment : LOW.
  - No private keys, no JWT, no API tokens in the DB schema.
  - Wallet addresses are public on-chain (Polygonscan) anyway.
  - User-submitted usernames are already publicly queryable via /api/leaderboard.

Recommended hygiene steps (nice-to-have, not urgent) :
  1. Rotate ADMIN_TOKEN in Railway env (cheap insurance)
     Railway Dashboard -> Variables -> ADMIN_TOKEN -> regen
  2. Check GitHub Insights -> Traffic for unique clones since bce98af push
  3. Keep watching signer balance (Discord webhook) for unusual activity

NOT required (based on audit) :
  - SIGNER_PK rotation (never in DB)
  - DEX liquidity pause
  - Emergency user communication

History is now clean on origin/main. Anyone with a local clone
must re-clone or run `git fetch && git reset --hard origin/main`.

============================================================
'@
Write-Host $recap -ForegroundColor Green
