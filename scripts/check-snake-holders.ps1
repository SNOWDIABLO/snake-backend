# check-snake-holders.ps1
# Verifie OU sont les SNAKE tokens (qui les detient)
# Compare contre les wallets connus du projet

$ErrorActionPreference = 'Stop'

$CONTRACT = "0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1"
$RPC      = "https://polygon-bor-rpc.publicnode.com"

# Wallets connus du projet (CLAUDE.md)
$WALLETS = @(
  @{ name = "LP Fund          "; addr = "0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E" }
  @{ name = "Signer (mint+gas)"; addr = "0xFca2595d1EE2d2d417f6e404330Ca72934054fc9" }
  @{ name = "Burn address     "; addr = "0x000000000000000000000000000000000000dEaD" }
  @{ name = "$SNAKE contract  "; addr = "0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1" }
  @{ name = "Trophy NFT       "; addr = "0xda4167D97caAa90DAf5510bcE338a90134BBdfA9" }
  @{ name = "Boost NFT        "; addr = "0x0a507FeAD82014674a0160CEf04570F19334E52C" }
)

function Get-SnakeBalance($address) {
  # balanceOf(address) = 0x70a08231 + padded address
  $paddedAddr = $address.Substring(2).PadLeft(64, '0')
  $data = "0x70a08231$paddedAddr"

  $body = @{
    jsonrpc = "2.0"
    method  = "eth_call"
    params  = @(
      @{ to = $CONTRACT; data = $data },
      "latest"
    )
    id = 1
  } | ConvertTo-Json -Compress

  $resp = Invoke-WebRequest -Uri $RPC -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
  $hex  = ($resp.Content | ConvertFrom-Json).result
  $bigInt = [System.Numerics.BigInteger]::Parse("0" + $hex.Substring(2), 'AllowHexSpecifier')
  return [decimal]$bigInt / [decimal]1e18
}

# Total supply
$body = '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"' + $CONTRACT + '","data":"0x18160ddd"},"latest"],"id":1}'
$resp = Invoke-WebRequest -Uri $RPC -Method POST -Body $body -ContentType "application/json" -UseBasicParsing -TimeoutSec 10
$hex  = ($resp.Content | ConvertFrom-Json).result
$totalSupply = [decimal]([System.Numerics.BigInteger]::Parse("0" + $hex.Substring(2), 'AllowHexSpecifier')) / [decimal]1e18

Write-Host "=== SNAKE Token Distribution ===" -ForegroundColor Cyan
Write-Host "Total supply on-chain: $totalSupply SNAKE`n" -ForegroundColor White

$totalKnown = [decimal]0
foreach ($w in $WALLETS) {
  try {
    $bal = Get-SnakeBalance $w.addr
    $pct = if ($totalSupply -gt 0) { [math]::Round(($bal / $totalSupply) * 100, 2) } else { 0 }
    $totalKnown += $bal
    $color = if ($bal -gt 0) { "Green" } else { "DarkGray" }
    Write-Host ("  {0} : {1,15:N2} SNAKE  ({2,5}%)  [{3}]" -f $w.name, $bal, $pct, $w.addr) -ForegroundColor $color
  } catch {
    Write-Host ("  {0} : ERROR - {1}" -f $w.name, $_.Exception.Message) -ForegroundColor Red
  }
}

$unaccounted = $totalSupply - $totalKnown
$unaccountedPct = if ($totalSupply -gt 0) { [math]::Round(($unaccounted / $totalSupply) * 100, 2) } else { 0 }

Write-Host ""
Write-Host ("  TOTAL TRACKED  : {0,15:N2} SNAKE" -f $totalKnown) -ForegroundColor Cyan
Write-Host ("  UNACCOUNTED    : {0,15:N2} SNAKE  ({1}%)" -f $unaccounted, $unaccountedPct) -ForegroundColor $(if ($unaccountedPct -gt 50) { "Red" } elseif ($unaccountedPct -gt 10) { "Yellow" } else { "Green" })

Write-Host ""
Write-Host "Interpretation:" -ForegroundColor Cyan
Write-Host "  - Si LP Fund a 1M SNAKE = pre-mint legitime pour DEX liquidity"
Write-Host "  - Si UNACCOUNTED > 50% = des tokens sont chez des inconnus (potentiel exploit)"
Write-Host "  - Si UNACCOUNTED ~ somme des claims joueurs = NORMAL (joueurs detiennent leurs gains)"
