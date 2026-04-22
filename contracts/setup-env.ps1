#
# setup-env.ps1 — Configure le .env pour hardhat deploy de SnakeBoostNFT
# Lance avec : .\setup-env.ps1
#

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  SnakeBoostNFT — .env setup"                  -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1 : PK ---
do {
  Write-Host "Colle la PK du deployer (format 0x + 64 hex chars, total 66 caracteres)"
  Write-Host "Attention : pas d'espace, pas de retour ligne." -ForegroundColor Yellow
  $pk = Read-Host "PK"
  $pk = $pk.Trim()

  if ($pk.Length -ne 66) {
    Write-Host "  PROBLEME : longueur = $($pk.Length), attendu 66. Recommence." -ForegroundColor Red
  } elseif (-not $pk.StartsWith("0x")) {
    Write-Host "  PROBLEME : doit commencer par 0x. Recommence." -ForegroundColor Red
  } else {
    Write-Host "  OK (66 chars, starts with 0x)" -ForegroundColor Green
  }
} while ($pk.Length -ne 66 -or -not $pk.StartsWith("0x"))

Write-Host ""

# --- Step 2 : API key ---
do {
  Write-Host "Colle ta Polygonscan API key (snake-verify) — 30-35 chars alphanumeriques"
  $api = Read-Host "API"
  $api = $api.Trim()

  if ($api.Length -lt 20 -or $api.Length -gt 50) {
    Write-Host "  PROBLEME : longueur $($api.Length), doit etre entre 20 et 50. Recommence." -ForegroundColor Red
  } else {
    Write-Host "  OK ($($api.Length) chars)" -ForegroundColor Green
  }
} while ($api.Length -lt 20 -or $api.Length -gt 50)

Write-Host ""

# --- Step 3 : write .env ---
$envContent = @"
POLYGON_RPC=https://polygon-rpc.com
AMOY_RPC=https://rpc-amoy.polygon.technology
DEPLOYER_PK=$pk
POLYGONSCAN_API_KEY=$api
CHAINLINK_MATIC_USD=0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
SNAKE_TOKEN_ADDRESS=0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1
FEE_WALLET=0xFca2595d1EE2d2d417f6e404330Ca72934054fc9
"@

$envContent | Out-File -FilePath ".env" -Encoding ascii -Force

Write-Host ".env ecrit dans $(Get-Location)\.env" -ForegroundColor Green
Write-Host ""

# --- Step 4 : verif ---
Write-Host "Verification (safe pour screen) :" -ForegroundColor Cyan
$check = node -e "require('dotenv').config(); const e=process.env; const pk=e.DEPLOYER_PK||''; const api=e.POLYGONSCAN_API_KEY||''; console.log('pk_len:', pk.length); console.log('pk_preview:', pk.slice(0,6)+'**********'+pk.slice(-4)); console.log('api_len:', api.length); console.log('api_preview:', api.slice(0,4)+'**********'+api.slice(-2)); console.log('chainlink:', e.CHAINLINK_MATIC_USD); console.log('snake:', e.SNAKE_TOKEN_ADDRESS); console.log('fee:', e.FEE_WALLET);"
$check

Write-Host ""
Write-Host "Derivation address + solde POL (mainnet) :" -ForegroundColor Cyan

# Derive address + balance (optionnel, necessite ethers installe)
$ethersCheck = node -e "try { const ethers=require('ethers'); require('dotenv').config(); (async()=>{const p=new ethers.JsonRpcProvider(process.env.POLYGON_RPC); const w=new ethers.Wallet(process.env.DEPLOYER_PK,p); const b=await p.getBalance(w.address); console.log('Deployer address:', w.address); console.log('Balance POL    :', ethers.formatEther(b));})().catch(e=>console.log('RPC err:', e.message)); } catch(e) { console.log('skip (ethers not installed yet)'); }"
$ethersCheck

# --- Step 5 : cleanup ---
$pk = $null
$api = $null
$envContent = $null
[GC]::Collect()

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host "  Setup termine. Next steps :"                  -ForegroundColor Green
Write-Host "    npm run compile"                            -ForegroundColor Green
Write-Host "    npm run deploy:polygon"                     -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green
