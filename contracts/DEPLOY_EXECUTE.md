# EXECUTE — Deploy SnakeBoostNFT + DEX Launch

Checklist jour-J pour lancer #66 (BoostNFT mainnet) et #65 (QuickSwap v3 LP).

---

## Phase 1 — #66 · SnakeBoostNFT mainnet

### Étape 1.1 · Install deps (à faire 1 fois)

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
npm install
```

Durée : ~2 min (hardhat + openzeppelin).

### Étape 1.2 · Config env local

```powershell
Copy-Item ".env.example" ".env" -Force
notepad .env
```

Remplir :
- `DEPLOYER_PK` = clé privée d'un wallet burner avec **5-10 POL**
- `POLYGONSCAN_API_KEY` = créer 1 clé gratuite sur https://polygonscan.com/myapikey
- Les autres valeurs sont déjà pré-remplies (Chainlink, $SNAKE, FEE_WALLET)

### Étape 1.3 · Compile

```powershell
npm run compile
```

Attendu : `Compiled 1 Solidity file successfully`.
Si warnings OK (pragma unused, etc.), continue. Si errors → stop.

### Étape 1.4 · (Optionnel) Dry-run sur Amoy testnet

```powershell
# Récupère du POL testnet : https://faucet.polygon.technology/
npm run deploy:amoy
```

Valide que tout est OK avant de payer du gas mainnet.

### Étape 1.5 · DEPLOY MAINNET

```powershell
npm run deploy:polygon
```

Output attendu :
```
🚀 Deploying SnakeBoostNFT to polygon...
   Chainlink MATIC/USD : 0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
   $SNAKE token        : 0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1
   Royalty receiver    : 0xFca2595d1EE2d2d417f6e404330Ca72934054fc9
   Deployer            : 0x...
   Balance POL         : 7.42

   Deploy tx           : 0x...
✅ SnakeBoostNFT deployed !
   Address             : 0xNEW_BOOST_ADDRESS
   Explorer            : https://polygonscan.com/address/0xNEW_BOOST_ADDRESS
   Saved               : deployment.polygon.json
⏳ Attente 30s pour propagation Polygonscan avant verify...
✅ Contract verified on Polygonscan
```

**📝 Note l'address → on l'appelle `$BOOST` dans la suite.**

### Étape 1.6 · Activer sur Railway

1. Aller Railway → snake-backend service → Variables
2. Ajouter / mettre à jour :
   ```
   BOOST_NFT_ADDRESS=0xNEW_BOOST_ADDRESS
   BOOST_ENABLED=1
   BOOST_FEE_BPS=3000
   ```
3. Railway redéploie automatiquement (~60s)

### Étape 1.7 · Vérifier logs Railway

Chercher dans les logs :
```
🚀 Contract BOOST  : 0xNEW_BOOST_ADDRESS
   └─ boost cache: 0 wallets · cron every 300s · batch 50
```

### Étape 1.8 · Smoke test endpoints

```powershell
$API = "https://snake-backend-production-e5e8.up.railway.app"
Invoke-RestMethod "$API/api/boost/catalog" | ConvertTo-Json -Depth 4
# Attendu : enabled:true, tiers:[{id:1,name:"Basic",...},{id:2,"Pro"...},{id:3,"Elite"...}]

Invoke-RestMethod "$API/api/boost/inventory/0xFca2595d1EE2d2d417f6e404330Ca72934054fc9" | ConvertTo-Json
# Attendu : enabled:true, items:[]
```

### Étape 1.9 · Frontend test

1. Ouvrir https://snowdiablo.xyz
2. Connect wallet
3. Ouvrir accordéon `🚀 Boost NFT`
4. Les 3 tier cards doivent s'afficher avec prix POL + prix SNAKE
5. (optionnel) Mint un Basic Boost ($3 POL) pour tester end-to-end

### Étape 1.10 · Mark task #66 complete

Une fois le smoke test OK :
```
✅ Task #66 completed
```

---

## Phase 2 — #65 · DEX QuickSwap v3 LP

⚠️ **Stealth reveal day only.** Ne lance pas avant d'être prêt à annoncer publiquement.

### Étape 2.1 · Simuler pricing initial

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
node scripts/price-calc.js
```

Ajuste les constantes `SNAKE_IN_LP` / `POL_IN_LP` dans le script pour matcher ta stratégie.

**Ratio recommandé** : 10% supply en LP + 10-30k POL.
- Exemple : 10M $SNAKE + 20k POL → 1 $SNAKE = 0.002 POL = ~$0.001

### Étape 2.2 · Préparer le wallet

Le wallet qui va add LP doit avoir :
- **$SNAKE** : montant à locker (doit venir du stock founder, pas du supply backend)
- **WPOL** : montant matching (wrap via https://quickswap.exchange/#/swap)
- **POL natif** : ~5 POL pour gas

### Étape 2.3 · Add Liquidity sur QuickSwap v3

1. Go https://quickswap.exchange/#/pools
2. Click **Create Position** (v3)
3. Select tokens :
   - Token A : **WPOL** (0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270)
   - Token B : **$SNAKE** (coller l'address : `0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1`)
4. Fee tier : **1%** (volume nouveau token → cashback fees)
5. Set price range : **Full range** (pour lock sans IL pilote)
6. Deposit amounts : selon simulation 2.1
7. Click **Approve WPOL** → signer
8. Click **Approve SNAKE** → signer
9. Click **Preview** → **Add Liquidity** → signer la tx finale
10. ✅ Un **NFT Position** est mint sur ton wallet

**Note :** Récupère l'address du pool (visible dans l'URL de la position, ex: `/pool/0xPOOL/`).

### Étape 2.4 · Lock LP NFT via UNCX

1. Go https://app.uncx.network/lockers/univ3/new
2. Sélectionner **QuickSwap V3** comme source
3. Connect wallet qui détient le NFT LP
4. Choisir la position créée
5. Durée : **12 mois minimum** (recommandé 12-24 mois)
6. Fee UNCX : ~0.5 POL + 0.1% du LP
7. Approve + Lock
8. **Screenshot la page de confirmation** → post-proof

### Étape 2.5 · Renounce ownership $SNAKE

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\contracts"
npm run renounce:polygon
# Va demander confirmation "RENOUNCE" — tape-le puis entrée
```

Vérifier sur Polygonscan : https://polygonscan.com/address/0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1#readContract → `owner()` doit retourner `0x0000000000000000000000000000000000000000`.

### Étape 2.6 · Update Railway env var (si pool address used)

Optionnel, si backend track le pool pour price oracle :
```
QUICKSWAP_POOL_ADDRESS=0xPOOL_ADDRESS
```

### Étape 2.7 · Announce

Templates prêts dans `LAUNCH_ANNOUNCE.md` (Twitter/X + Discord + Bluesky).

### Étape 2.8 · DEX Screener submission

1. Après le 1er swap, la pair apparaît automatiquement sur https://dexscreener.com
2. Go https://dexscreener.com/update
3. Upload logo + add socials + description
4. **Boost** (optionnel, payant) : donne une bannière + plus de visibilité

### Étape 2.9 · CoinGecko submission

https://www.coingecko.com/en/coins/new → submission manuelle, review sous 24-48h.

### Étape 2.10 · Mark task #65 complete

```
✅ Task #65 completed
```

---

## Rollback / Contingency

### Si deploy BOOST échoue mid-way
- Le contract est déployé mais pas set dans Railway → pas d'impact user
- Retry juste l'étape 1.6 (Railway env)

### Si LP add échoue mid-way
- WPOL approve peut rester pending → reset approval à 0
- Pas de fonds perdus si tu n'as pas signé la tx "Add Liquidity" finale

### Post-launch crash de prix
- Set Railway `CLAIMS_ENABLED=0` temporairement
- Communication Discord transparente
- LP est locked → pas de rug possible, ça rassure le marché

---

## Secrets hygiene post-deploy

```powershell
# 1. Purger la clé privée
Remove-Item ".env" -Force

# 2. Générer nouveau wallet burner pour les prochaines opérations
# (jamais réutiliser DEPLOYER_PK)

# 3. Vérifier .gitignore
git status contracts/
# .env ne doit PAS apparaître
```

---

**Ordre exécution recommandé :**
1. Phase 1 (BOOST deploy) — 20 min
2. Attendre que UI s'affiche + smoke tests OK
3. Phase 2 (DEX) — 45 min
4. Announce simultané partout
5. Stream Twitch pour l'événement

**Total critical path :** ~1h30 side-by-side.
