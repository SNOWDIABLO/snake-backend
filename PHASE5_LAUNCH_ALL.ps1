# ============================================================
#  SnowDiablo Arcade - LAUNCH WAVE one-shot
#  Fires Bluesky thread (5 posts) + Discord embed, all in one run.
#  No intermediate copy-paste.
#
#  Prereqs (one-time, in the SAME PS session) :
#    $env:ADMIN_TOKEN     = "<value from Railway Variables>"
#    $env:DISCORD_WEBHOOK = "https://discord.com/api/webhooks/.../..."
#
#  Usage :
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_ALL.ps1"           # live (asks final confirm)
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_ALL.ps1" -DryRun   # preview only
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_ALL.ps1" -SkipEveryone   # same but no Discord @everyone
#    & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_ALL.ps1" -YoloGo   # skip final confirm prompt
# ============================================================

param(
    [switch]$DryRun,
    [switch]$SkipEveryone,
    [switch]$YoloGo,
    [int]$BskySpacingSeconds = 90,
    [int]$InterWaveGapSeconds = 120    # pause between end-of-bsky and Discord
)

$ErrorActionPreference = 'Continue'   # don't die on non-critical stderr
$root = "$env:USERPROFILE\OneDrive\claude creation\snake-backend"
$bsky = Join-Path $root "PHASE5_LAUNCH_BSKY.ps1"
$disc = Join-Path $root "PHASE5_LAUNCH_DISCORD.ps1"

function Die($msg) {
    Write-Host ""
    Write-Host "ABORT: $msg" -ForegroundColor Red
    Write-Host ""
    exit 1
}

# ----- Preflight checks -----
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host " SNOWDIABLO ARCADE - LAUNCH WAVE (one-shot)" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

if (-not (Test-Path $bsky)) { Die "Missing : $bsky" }
if (-not (Test-Path $disc)) { Die "Missing : $disc" }

function Is-PlaceholderToken($v) {
    if (-not $v) { return $true }
    if ($v -match '^<')                 { return $true }   # <paste from ...>
    if ($v -match 'COLLE')              { return $true }   # COLLE_LA_VRAIE_VALEUR_ICI
    if ($v -match '^copie depuis')      { return $true }
    if ($v.Length -lt 16)               { return $true }   # real admin token is much longer
    return $false
}

function Is-PlaceholderWebhook($v) {
    if (-not $v) { return $true }
    if ($v -match '<') { return $true }
    if ($v -notmatch '^https://discord\.com/api/webhooks/\d+/[\w-]+$') { return $true }
    return $false
}

if (-not $DryRun) {
    # ADMIN_TOKEN : prompt if missing/placeholder
    if (Is-PlaceholderToken $env:ADMIN_TOKEN) {
        Write-Host ""
        Write-Host "[setup] `$env:ADMIN_TOKEN missing or placeholder." -ForegroundColor Yellow
        Write-Host "        Paste it below (input masked). Get it from :"
        Write-Host "        Railway -> snake-backend -> Variables -> ADMIN_TOKEN -> copy"
        $sec = Read-Host "ADMIN_TOKEN" -AsSecureString
        if (-not $sec -or $sec.Length -eq 0) { Die "Nothing pasted. Aborting." }
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        try { $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        if (Is-PlaceholderToken $plain) { Die "Pasted value still looks like a placeholder. Aborting." }
        $env:ADMIN_TOKEN = $plain
        Write-Host ("  token set (length {0})." -f $plain.Length) -ForegroundColor Green
    }

    # DISCORD_WEBHOOK : prompt if missing/malformed
    if (Is-PlaceholderWebhook $env:DISCORD_WEBHOOK) {
        Write-Host ""
        Write-Host "[setup] `$env:DISCORD_WEBHOOK missing or malformed." -ForegroundColor Yellow
        Write-Host "        Paste the full webhook URL (visible input) :"
        $v = Read-Host "DISCORD_WEBHOOK"
        $v = $v.Trim('"').Trim()
        if (Is-PlaceholderWebhook $v) { Die "Pasted URL is malformed. Expected : https://discord.com/api/webhooks/<id>/<token>" }
        $env:DISCORD_WEBHOOK = $v
        Write-Host "  webhook set." -ForegroundColor Green
    }

    # Sanity hit on Railway admin endpoint - no posting
    Write-Host ""
    Write-Host "[preflight] Checking Railway admin API + Bluesky session..." -ForegroundColor Cyan
    try {
        $h = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }
        $s = Invoke-RestMethod "https://snake-backend-production-e5e8.up.railway.app/api/admin/bsky/status" -Headers $h -TimeoutSec 10
        Write-Host ("  admin_token  : OK") -ForegroundColor Green
        Write-Host ("  bsky enabled : {0}" -f $s.enabled)
        Write-Host ("  bsky session : {0}" -f $s.session)
        Write-Host ("  handle       : {0}" -f $s.handle)
        if (-not $s.enabled -or -not $s.session) {
            Die "Bluesky not ready server-side. Check BSKY_HANDLE / BSKY_APP_PASSWORD on Railway."
        }
    } catch {
        Die "Preflight failed : $($_.Exception.Message). Token probably wrong, or Railway down."
    }

    # Validate Discord webhook with a GET (no publish). Re-prompt on 404/401.
    $webhookOk = $false
    for ($try = 0; $try -lt 3 -and -not $webhookOk; $try++) {
        Write-Host ""
        Write-Host "[preflight] Checking Discord webhook..." -ForegroundColor Cyan
        try {
            $w = Invoke-RestMethod $env:DISCORD_WEBHOOK -TimeoutSec 10
            Write-Host ("  webhook id   : {0}" -f $w.id) -ForegroundColor Green
            Write-Host ("  webhook name : {0}" -f $w.name)
            Write-Host ("  channel id   : {0}" -f $w.channel_id)
            $webhookOk = $true
        } catch {
            $code = 0
            if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
            Write-Host "  webhook check failed : $($_.Exception.Message)" -ForegroundColor Yellow
            if ($code -eq 404 -or $code -eq 401) {
                Write-Host "  Webhook is revoked/deleted. Create a NEW one in Discord :" -ForegroundColor Yellow
                Write-Host "    Server Settings -> Integrations -> Webhooks -> New Webhook -> Copy Webhook URL"
                Write-Host ""
                $v = Read-Host "Paste the NEW webhook URL"
                $v = $v.Trim('"').Trim()
                if (Is-PlaceholderWebhook $v) {
                    Die "URL malformed. Expected : https://discord.com/api/webhooks/<id>/<token>"
                }
                $env:DISCORD_WEBHOOK = $v
                # loop will retry
            } else {
                Die "Discord webhook check failed with HTTP $code. Aborting."
            }
        }
    }
    if (-not $webhookOk) { Die "Too many failed Discord webhook attempts." }
}

# ----- Show plan -----
Write-Host ""
Write-Host "[plan]" -ForegroundColor Yellow
Write-Host "  1. Bluesky  : 5 posts, spaced $BskySpacingSeconds s  (~ $([math]::Round(4*$BskySpacingSeconds/60,1)) min)"
Write-Host "  2. pause    : $InterWaveGapSeconds s"
Write-Host "  3. Discord  : embed $(if ($SkipEveryone) { '(no @everyone)' } else { '(with @everyone ping)' })"
if ($DryRun) {
    Write-Host "  mode      : DRY-RUN - no network calls on publish steps" -ForegroundColor DarkYellow
}

# ----- Confirm -----
if (-not $DryRun -and -not $YoloGo) {
    Write-Host ""
    $c = Read-Host "Type 'FIRE' to launch, anything else to abort"
    if ($c -ne 'FIRE') { Die "User cancelled." }
}

# ====================================================================
# Step 1 - Bluesky
# ====================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " STEP 1/2 - BLUESKY" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bskyArgs = @{ SpacingSeconds = $BskySpacingSeconds }
if ($DryRun) { $bskyArgs.DryRun = $true }

& $bsky @bskyArgs
$bskyExit = $LASTEXITCODE
if ($bskyExit -ne 0) {
    Write-Host ""
    Write-Host "Bluesky step exited non-zero ($bskyExit). Aborting before Discord." -ForegroundColor Red
    Write-Host "Fix the issue, then run only the Discord script :"
    Write-Host '  & "$env:USERPROFILE\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_DISCORD.ps1"'
    exit $bskyExit
}

# ====================================================================
# Step 2 - Pause
# ====================================================================
if (-not $DryRun) {
    Write-Host ""
    Write-Host ("[pause] {0} s before Discord..." -f $InterWaveGapSeconds) -ForegroundColor DarkGray
    for ($i = $InterWaveGapSeconds; $i -gt 0; $i--) {
        Write-Host -NoNewline "`r  T-${i}s   "
        Start-Sleep -Seconds 1
    }
    Write-Host "`r              "
}

# ====================================================================
# Step 3 - Discord
# ====================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " STEP 2/2 - DISCORD" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$discArgs = @{}
if ($DryRun)        { $discArgs.DryRun = $true }
if ($SkipEveryone)  { $discArgs.SkipEveryone = $true }

& $disc @discArgs
$discExit = $LASTEXITCODE

# ====================================================================
# Recap
# ====================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " LAUNCH WAVE COMPLETE" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

Write-Host ""
Write-Host "Verify :"
Write-Host "  - Bluesky : https://bsky.app/profile/snowdiablo.bsky.social"
Write-Host "  - Discord : check the channel bound to your webhook"
Write-Host ""
Write-Host "Growth check in ~1h :"
Write-Host '  $h = @{ Authorization = "Bearer $env:ADMIN_TOKEN" }'
Write-Host '  Invoke-RestMethod "https://snake-backend-production-e5e8.up.railway.app/api/admin/growth" -Headers $h'
Write-Host ""
Write-Host "Post-launch hygiene (recommended, 30 sec each) :"
Write-Host "  1. Railway -> Variables -> ADMIN_TOKEN -> regen + save"
Write-Host "  2. Discord -> Server Settings -> Integrations -> Webhooks -> delete + recreate"
Write-Host ""

if ($discExit -ne 0) { exit $discExit }
if ($bskyExit -ne 0) { exit $bskyExit }
exit 0
