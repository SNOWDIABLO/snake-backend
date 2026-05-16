# check-snake-supply.ps1
# Verifie le total supply on-chain du token $SNAKE
# Si le nombre est petit/raisonnable -> pas de mint sauvage
# Si le nombre est enorme -> exploit possible

$ErrorActionPreference = 'Stop'

$CONTRACT = "0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1"
$RPC      = "https://polygon-bor-rpc.publicnode.com"

# Method ID de totalSupply() = keccak256("totalSupply()")[:4] = 0x18160ddd
$body = @{
  jsonrpc = "2.0"
  method  = "eth_call"
  params  = @(
    @{
      to   = $CONTRACT
      data = "0x18160ddd"
    },
    "latest"
  )
  id = 1
} | ConvertTo-Json -Compress

Write-Host "Querying RPC..." -ForegroundColor Cyan
Write-Host "Contract: $CONTRACT"
Write-Host "RPC:      $RPC"
Write-Host ""

try {
  $resp = Invoke-WebRequest -Uri $RPC -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 15
  $json = $resp.Content | ConvertFrom-Json

  if ($json.error) {
    Write-Host "RPC ERROR:" -ForegroundColor Red
    $json.error | Format-List
    exit 1
  }

  $hex = $json.result
  $bigInt = [System.Numerics.BigInteger]::Parse("0" + $hex.Substring(2), 'AllowHexSpecifier')
  $supply = [decimal]$bigInt / [decimal]1e18

  Write-Host "=== RESULT ===" -ForegroundColor Green
  Write-Host "Raw hex:      $hex"
  Write-Host "Raw wei:      $bigInt"
  Write-Host "Total supply: $supply SNAKE"
  Write-Host ""

  if ($supply -lt 100000) {
    Write-Host "VERDICT: Total supply faible/raisonnable" -ForegroundColor Green
    Write-Host "         AUCUN mint sauvage detecte." -ForegroundColor Green
  } elseif ($supply -lt 10000000) {
    Write-Host "VERDICT: Total supply moyen" -ForegroundColor Yellow
    Write-Host "         A verifier manuellement vs claims legitimes." -ForegroundColor Yellow
  } else {
    Write-Host "VERDICT: Total supply ENORME" -ForegroundColor Red
    Write-Host "         Possible exploit - investiguer immediatement." -ForegroundColor Red
  }

} catch {
  Write-Host "EXCEPTION: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Stack:" -ForegroundColor DarkGray
  Write-Host $_.ScriptStackTrace
  exit 1
}
