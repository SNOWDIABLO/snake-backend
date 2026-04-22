# ==================================================================
#  DIAG_CLAIM_REVERT.ps1
#  Diagnostic ciblé pour le revert claimReward() du wallet 0x71A4
#  Exécuter depuis : C:\dev\snake-backend\  (ou OneDrive, osef)
#  Usage : powershell -ExecutionPolicy Bypass -File .\DIAG_CLAIM_REVERT.ps1
# ==================================================================

$ErrorActionPreference = 'Stop'

# ---- Config ------------------------------------------------------
$RPC       = 'https://polygon-bor-rpc.publicnode.com'
$FALLBACK  = 'https://polygon-rpc.com'
$TOKEN     = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1'   # $SNAKE
$WALLET    = '0x71A4e15f491203632B1bcb7C55BCD98ECE114372'   # wallet qui revert
$SIGNER    = '0xFca2595d1EE2d2d417f6e404330Ca72934054fc9'   # backend signer
$BACKEND   = 'https://snake-backend-production-e5e8.up.railway.app'

# ---- Helpers -----------------------------------------------------
function Rpc([string]$method, $params) {
  $body = @{ jsonrpc='2.0'; id=1; method=$method; params=$params } | ConvertTo-Json -Depth 10 -Compress
  try {
    $r = Invoke-RestMethod -Uri $RPC -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
    return $r
  } catch {
    Write-Host "   (fallback RPC) " -NoNewline -ForegroundColor DarkGray
    $r = Invoke-RestMethod -Uri $FALLBACK -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15
    return $r
  }
}

function HexToBigInt([string]$hex) {
  if (-not $hex -or $hex -eq '0x') { return [bigint]0 }
  return [System.Numerics.BigInteger]::Parse('0' + $hex.Substring(2), 'AllowHexSpecifier')
}

function HexToAddr([string]$hex) {
  if (-not $hex -or $hex.Length -lt 66) { return '(empty)' }
  return '0x' + $hex.Substring($hex.Length - 40).ToLower()
}

function Sel([string]$sig) {
  # keccak256 via ethers in node ? Trop lourd. On hardcode les selectors courants.
  # (calculés hors-ligne)
  return $sig
}

# Selectors (pré-calculés via keccak256 ; sources : https://www.4byte.directory)
$sel = @{
  'signer()'                   = '0x238ac933'
  'trustedSigner()'            = '0x2ac72bfd'
  'owner()'                    = '0x8da5cb5b'
  'paused()'                   = '0x5c975abb'
  'totalSupply()'              = '0x18160ddd'
  'balanceOf(address)'         = '0x70a08231'
  'dailyLimit()'               = '0x4d5fbd8d'
  'maxPerClaim()'              = '0xa5a67b6a'
  'cooldown()'                 = '0xb1cb0e9e'
  'lastClaim(address)'         = '0x38f80b8b'
  'claimedToday(address)'      = '0x9f8a13d7'
  'totalClaimed(address)'      = '0xe6fd48bc'
  'blacklisted(address)'       = '0x08f5b57e'
  'isBlacklisted(address)'     = '0xfe575a87'
  'used(bytes32)'              = '0xb07576ac'
  'nonceUsed(bytes32)'         = '0xc59d4847'
  'cap()'                      = '0x355274ea'
}

function CallView([string]$label, [string]$data) {
  try {
    $r = Rpc 'eth_call' @(@{ to=$TOKEN; data=$data }, 'latest')
    if ($r.error) {
      return "  [x] $label → revert (function probablement absente)"
    }
    return "  [OK] $label → $($r.result)"
  } catch {
    return "  [!] $label → $($_.Exception.Message)"
  }
}

# ---- Start -------------------------------------------------------
Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  DIAG /api/claim revert pour $WALLET" -ForegroundColor Cyan
Write-Host "==================================================================`n" -ForegroundColor Cyan

# 1) Info basique du token
Write-Host "[1] Contract state (view)" -ForegroundColor Yellow
$r = Rpc 'eth_getCode' @($TOKEN, 'latest')
$codeLen = ($r.result.Length - 2) / 2
Write-Host "  Code size   : $codeLen bytes  $(if($codeLen -gt 0){'OK'}else{'ERREUR : code vide'})"

# signer / owner / paused
CallView 'signer()'         ($sel['signer()'])              | Write-Host
CallView 'trustedSigner()'  ($sel['trustedSigner()'])       | Write-Host
CallView 'owner()'          ($sel['owner()'])               | Write-Host
CallView 'paused()'         ($sel['paused()'])              | Write-Host

# totalSupply
$ts = Rpc 'eth_call' @(@{ to=$TOKEN; data=$sel['totalSupply()'] }, 'latest')
if ($ts.result) {
  $tsBig = HexToBigInt $ts.result
  $tsFmt = [decimal]$tsBig / [decimal]([bigint]::Pow(10,18))
  Write-Host ("  [OK] totalSupply() : {0:N4} SNAKE" -f $tsFmt)
}

# cap
CallView 'cap()' ($sel['cap()']) | Write-Host

# 2) Per-wallet checks
Write-Host "`n[2] Per-wallet state : $WALLET" -ForegroundColor Yellow
$addrArg = $WALLET.Substring(2).ToLower().PadLeft(64, '0')
$nonceArg = '0123456789abcdef'.PadLeft(64, '0')  # nonce bidon pour tester used()

CallView 'balanceOf(...)'     ($sel['balanceOf(address)']     + $addrArg)  | Write-Host
CallView 'lastClaim(...)'     ($sel['lastClaim(address)']     + $addrArg)  | Write-Host
CallView 'claimedToday(...)'  ($sel['claimedToday(address)']  + $addrArg)  | Write-Host
CallView 'totalClaimed(...)'  ($sel['totalClaimed(address)']  + $addrArg)  | Write-Host
CallView 'blacklisted(...)'   ($sel['blacklisted(address)']   + $addrArg)  | Write-Host
CallView 'isBlacklisted(...)' ($sel['isBlacklisted(address)'] + $addrArg)  | Write-Host

# 3) Config claims
Write-Host "`n[3] Claim config" -ForegroundColor Yellow
CallView 'dailyLimit()'   ($sel['dailyLimit()'])   | Write-Host
CallView 'maxPerClaim()'  ($sel['maxPerClaim()'])  | Write-Host
CallView 'cooldown()'     ($sel['cooldown()'])     | Write-Host

# 4) Vérifier le backend
Write-Host "`n[4] Backend Railway health" -ForegroundColor Yellow
try {
  $h = Invoke-RestMethod -Uri "$BACKEND/health" -TimeoutSec 10
  $h | ConvertTo-Json -Depth 5 | Out-Host
} catch {
  Write-Host "  [!] Backend injoignable : $($_.Exception.Message)" -ForegroundColor Red
}

# 5) Reproduire la signature backend + simuler on-chain
Write-Host "`n[5] Essayer un /api/session/end → /api/claim + eth_call simulation" -ForegroundColor Yellow
Write-Host "   (Requis : jouer une partie réelle via snowdiablo.xyz d'abord, récupérer sessionId/score)"
Write-Host "   Pour simuler manuellement :"
Write-Host "   1) POST /api/claim → récup data = { amount, nonce, sig }"
Write-Host "   2) Encoder calldata claimReward(amount, nonce, sig) selector 0x76618f27"
Write-Host "   3) eth_call avec from=$WALLET → revert.data ou revert.message`n"

# 6) Trouver le dernier tx claim réussi d'un autre wallet pour comparer
Write-Host "[6] Tx récents en entrée du contract (pour comparaison)" -ForegroundColor Yellow
Write-Host "   Ouvre : https://polygonscan.com/address/$TOKEN#tokentxns"
Write-Host "   Note les wallets qui ONT claim avec succès (colonne From)"
Write-Host "   → Cherche un wallet qui a claimé même amount que toi (1 SNAKE)"
Write-Host "   → Si lui marche et toi pas → c'est soit cooldown, soit cap, soit blacklist"

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  FIN DIAG" -ForegroundColor Cyan
Write-Host "==================================================================`n" -ForegroundColor Cyan
