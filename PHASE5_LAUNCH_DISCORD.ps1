# ============================================================
#  SnowDiablo Arcade - Publish Discord launch embed
#
#  Uses the webhook defined in either :
#    1. -WebhookUrl parameter
#    2. $env:DISCORD_WEBHOOK  (preferred, never commit in a file)
#
#  Payload file : LAUNCH_WAVE_ARCADE.discord.json (same folder)
#
#  Usage :
#    $env:DISCORD_WEBHOOK = "https://discord.com/api/webhooks/..."
#    & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_DISCORD.ps1"
#    & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_DISCORD.ps1" -DryRun
#    & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_LAUNCH_DISCORD.ps1" -WebhookUrl "https://discord.com/api/webhooks/..."
# ============================================================

param(
    [string]$WebhookUrl,
    [string]$PayloadPath = "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\LAUNCH_WAVE_ARCADE.discord.json",
    [switch]$DryRun,
    [switch]$SkipEveryone    # strip @everyone mention (safe mode)
)

$ErrorActionPreference = 'Stop'

# ----- Resolve webhook -----
if (-not $WebhookUrl) { $WebhookUrl = $env:DISCORD_WEBHOOK }
if (-not $WebhookUrl -and -not $DryRun) {
    Write-Host "ERROR: no webhook URL." -ForegroundColor Red
    Write-Host "  Either :"
    Write-Host "    `$env:DISCORD_WEBHOOK = 'https://discord.com/api/webhooks/.../...'"
    Write-Host "    Then rerun the script"
    Write-Host "  Or pass it inline :"
    Write-Host '    -WebhookUrl "https://discord.com/api/webhooks/.../..."'
    exit 1
}

# ----- Load payload -----
if (-not (Test-Path $PayloadPath)) {
    Write-Host "ERROR: payload not found : $PayloadPath" -ForegroundColor Red
    exit 1
}
$raw = Get-Content $PayloadPath -Raw -Encoding UTF8

try {
    $obj = $raw | ConvertFrom-Json
} catch {
    Write-Host "ERROR: payload is not valid JSON : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($SkipEveryone) {
    $obj.content = ""
    Write-Host "  -SkipEveryone : @everyone mention removed" -ForegroundColor DarkYellow
}

$payload = $obj | ConvertTo-Json -Depth 20 -Compress

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " DISCORD LAUNCH EMBED" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Payload    : $PayloadPath"
Write-Host " Webhook    : $($WebhookUrl -replace '(/webhooks/\d+/)[^/]+', '$1***REDACTED***')"
Write-Host " Size       : $($payload.Length) chars"
Write-Host " Embeds     : $($obj.embeds.Count)"
Write-Host " @everyone  : $(if ($obj.content -match '@everyone') { 'YES' } else { 'no' })"
Write-Host " Mode       : $(if ($DryRun) { 'DRY-RUN (no network)' } else { 'LIVE' })"
Write-Host ""

if ($DryRun) {
    Write-Host "--- PAYLOAD PREVIEW ---" -ForegroundColor Yellow
    $obj | ConvertTo-Json -Depth 20 | Write-Host
    Write-Host ""
    Write-Host "Dry-run done. No network call made." -ForegroundColor Yellow
    exit 0
}

# ----- Post -----
try {
    # Append ?wait=true so Discord returns the message object (validation + id)
    $url = if ($WebhookUrl -match '\?') { "$WebhookUrl&wait=true" } else { "$WebhookUrl`?wait=true" }
    $resp = Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json' -Body $payload -TimeoutSec 20
    Write-Host "OK - Discord message published" -ForegroundColor Green
    Write-Host "  message id : $($resp.id)"
    Write-Host "  channel id : $($resp.channel_id)"
    if ($resp.guild_id) {
        Write-Host "  jump link  : https://discord.com/channels/$($resp.guild_id)/$($resp.channel_id)/$($resp.id)"
    }
} catch {
    Write-Host "FAIL - $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  body : $($_.ErrorDetails.Message)" -ForegroundColor DarkRed
    }
    Write-Host ""
    Write-Host "Common causes :" -ForegroundColor Yellow
    Write-Host "  - 404 Not Found  -> webhook URL wrong / deleted / revoked"
    Write-Host "  - 401 Unauthorized -> token portion of URL is wrong"
    Write-Host "  - 400 Bad Request -> payload too big (>6000 chars across embeds) or invalid fields"
    exit 1
}

Write-Host ""
Write-Host "Next step : Telegram broadcast (manual copy-paste from LAUNCH_WAVE_ARCADE.md section 3)" -ForegroundColor Yellow

# Force clean exit 0 - empeche le LASTEXITCODE pollue de faire croire au wrapper que ca a failed.
exit 0
