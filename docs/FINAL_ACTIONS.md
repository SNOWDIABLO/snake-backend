# 🚀 FINAL ACTIONS — Commandes copy-paste day-of

Ce fichier = le **minimum vital** à exécuter pour finir #66 et #65.

---

## 1. Git push (le kit deploy)

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend-git"

# Copier les fichiers du kit hardhat
New-Item -ItemType Directory -Path "contracts" -Force | Out-Null
New-Item -ItemType Directory -Path "contracts\src" -Force | Out-Null
New-Item -ItemType Directory -Path "contracts\scripts" -Force | Out-Null

$SRC = "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
Copy-Item "$SRC\hardhat.config.js" ".\contracts\" -Force
Copy-Item "$SRC\package.json" ".\contracts\" -Force
Copy-Item "$SRC\.gitignore" ".\contracts\" -Force
Copy-Item "$SRC\.env.example" ".\contracts\" -Force
Copy-Item "$SRC\DEPLOY_EXECUTE.md" ".\contracts\" -Force
Copy-Item "$SRC\src\SnakeBoostNFT.sol" ".\contracts\src\" -Force
Copy-Item "$SRC\scripts\*.js" ".\contracts\scripts\" -Force
Copy-Item "..\snake-backend\FINAL_ACTIONS.md" ".\" -Force
Copy-Item "..\snake-backend\LAUNCH_ANNOUNCE.md" ".\" -Force

git add contracts/ FINAL_ACTIONS.md LAUNCH_ANNOUNCE.md
git commit -m "feat(launch): hardhat deploy kit + launch announce templates"
git push origin main
```

---

## 2. #66 · DEPLOY SnakeBoostNFT mainnet

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"

# 1. Install (1 fois seulement, ~2min)
npm install

# 2. Config env
Copy-Item ".env.example" ".env" -Force
notepad .env
# Remplir DEPLOYER_PK + POLYGONSCAN_API_KEY

# 3. Compile
npm run compile

# 4. DEPLOY MAINNET
npm run deploy:polygon
# → Note l'address affichée (ex: 0xNewBoostAddress)
```

**Puis sur Railway :**
1. Variables → ajouter `BOOST_NFT_ADDRESS=0xNewBoostAddress` + `BOOST_ENABLED=1`
2. Redeploy (auto)
3. Attendre ~90s

**Smoke test :**
```powershell
$API = "https://snake-backend-production-e5e8.up.railway.app"
Invoke-RestMethod "$API/api/boost/catalog" | ConvertTo-Json -Depth 4
# Attendu : enabled:true, tiers:[Basic/Pro/Elite]
```

**Mark complete :** task #66 → completed

---

## 3. #65 · DEX QuickSwap v3 LP

⚠️ **Launch day only.** Fait les annonces prêtes (LAUNCH_ANNOUNCE.md) avant.

### 3.1 · Pricing simulation

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
# Ajuste SNAKE_IN_LP / POL_IN_LP dans scripts/price-calc.js selon ton plan
node scripts/price-calc.js
```

### 3.2 · Add LP (manuel, MetaMask)

1. https://quickswap.exchange/#/pools → Create Position V3
2. Paire : `WPOL` (0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270) + `$SNAKE` (0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1)
3. Fee tier : **1%**
4. Range : **Full range**
5. Approve WPOL → Approve SNAKE → Add Liquidity
6. Note l'address du pool

### 3.3 · Lock LP NFT via UNCX

1. https://app.uncx.network/lockers/univ3/new
2. Sélectionner position QuickSwap V3
3. Durée : **12 mois minimum**
4. Confirm + pay fee (~0.5 POL)
5. **SCREENSHOT** → post-proof

### 3.4 · Renounce ownership $SNAKE

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
npm run renounce:polygon
# Tape "RENOUNCE" quand demandé
```

Vérif : https://polygonscan.com/address/0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1#readContract → `owner()` = `0x0000000000000000000000000000000000000000`

### 3.5 · Announce

Copy-paste depuis `LAUNCH_ANNOUNCE.md` sur :
- Twitter/X (thread 5 tweets)
- Discord #announcements (@everyone)
- Bluesky
- Twitch (title + go live)
- Reddit r/PolygonNetwork + r/CryptoGaming

### 3.6 · Submissions

- DEX Screener : https://dexscreener.com/update
- CoinGecko : https://www.coingecko.com/en/coins/new
- CoinMarketCap : https://coinmarketcap.com/request/

### 3.7 · Monitoring

- Uptime Kuma : tous les endpoints doivent rester verts
- Railway logs : surveille errors pendant 2h post-launch
- DEX Screener : watch price + volume 24h
- Polygonscan : watch holders count

**Mark complete :** task #65 → completed

---

## 4. Post-launch cleanup

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
# 1. Purger clé privée locale
Remove-Item ".env" -Force

# 2. Générer nouveau wallet burner pour ops futures
# (jamais réutiliser DEPLOYER_PK)

# 3. Verifier .gitignore fonctionne
git status
# .env ne doit PAS apparaître
```

---

**Total critical path estimé : 1h30 side-by-side.**

- Phase 1 (#66) : 20 min
- Phase 2 (#65) : 45 min  
- Announce + submissions : 25 min
