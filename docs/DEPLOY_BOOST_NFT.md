# DEPLOY — SnakeBoostNFT.sol sur Polygon Mainnet (Task #66)

Runbook pour déployer le contract marketplace NFT Boost et activer l'UI publique.

**Prérequis :** tasks #67, #71, #72 toutes `completed` (contract + backend + frontend déjà prêts).

## 1. Fichiers pertinents

- **Contract** : `contracts/SnakeBoostNFT.sol` (ou équivalent — task #67)
- **Deploy script** : `scripts/deploy-boost.js` (Hardhat ou Foundry)
- **ABI** : déjà intégré dans `server.js` (task #74)

## 2. Hardhat config check

```bash
cd contracts/
cat hardhat.config.js | grep -E "polygon|networks"
```

Attendu :

```js
networks: {
  polygon: {
    url: process.env.POLYGON_RPC,
    accounts: [process.env.DEPLOYER_PK],
    chainId: 137,
  }
}
```

## 3. Env local pour deploy (NE PAS commit)

```bash
# contracts/.env
POLYGON_RPC=https://polygon-rpc.com
DEPLOYER_PK=0x...                     # wallet avec 5-10 POL de gas
POLYGONSCAN_API_KEY=...                # pour auto-verify
CHAINLINK_MATIC_USD=0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
SNAKE_TOKEN_ADDRESS=0x...              # address du token $SNAKE déployé
FEE_WALLET=0x...                       # wallet qui reçoit les 30% project cut
BURN_ADDRESS=0x000000000000000000000000000000000000dEaD
```

## 4. Pre-flight

```bash
cd contracts/
npx hardhat compile
# Doit finir sans warning critique

# Dry-run sur Mumbai (Polygon testnet) d'abord si possible
npx hardhat run scripts/deploy-boost.js --network mumbai
```

## 5. Deploy mainnet

```bash
npx hardhat run scripts/deploy-boost.js --network polygon
# Output attendu:
# SnakeBoostNFT deployed to: 0x...
# Verifying on Polygonscan...
# Successfully verified contract SnakeBoostNFT on the block explorer.
```

Noter l'address → `BOOST_NFT_ADDRESS_DEPLOYED`.

## 6. Config initiale post-deploy

Définir les tiers via `setTier(tierId, polPriceUsdCents, snakePrice, supply, multBps, durationDays)` :

```bash
# Via Hardhat console ou script
# Exemples (adjustable):
# Tier 1 — Bronze : $5   / 1000 $SNAKE burn / supply 1000 / +10% / 7j
# Tier 2 — Silver : $15  / 3000 $SNAKE burn / supply 500  / +20% / 14j
# Tier 3 — Gold   : $30  / 7500 $SNAKE burn / supply 200  / +35% / 30j
# Tier 4 — Diamond: $100 / 25000 $SNAKE burn / supply 50  / +75% / 90j

npx hardhat run scripts/configure-tiers.js --network polygon
```

## 7. Activate backend

Railway env vars :

```bash
BOOST_NFT_ADDRESS=0x...(address_deployed)
BOOST_ENABLED=1                        # si flag existe
BOOST_FEE_BPS=3000                     # 30% project cut
```

Railway redeploy → check logs :

```bash
🚀 Contract BOOST  : 0xAddressDeployed
   └─ boost cache: 0 wallets · cron every 300s · batch 50
```

## 8. Smoke test endpoints

```bash
curl -s https://api.snowdiablo.xyz/api/boost/catalog | jq
# Attendu: 4 tiers avec pol_price_wei calculé via Chainlink, snake_burn_amount, supply_remaining

curl -s "https://api.snowdiablo.xyz/api/boost/multiplier/0xYourWallet" | jq
# Attendu: { enabled: true, boost_mult_bps: 0 } (0 car pas encore minté)

curl -s "https://api.snowdiablo.xyz/api/boost/inventory/0xYourWallet" | jq
# Attendu: { enabled: true, items: [] }
```

## 9. Frontend test

1. Ouvrir site + connect wallet
2. Ouvrir accordion `🚀 Boost NFT`
3. Les 4 tier cards s'affichent avec prix POL + prix SNAKE burn
4. Click "Mint POL" sur un tier → MetaMask ouvre avec la tx de mint + valeur correcte
5. Approve + Confirm → tx confirm
6. UI affiche le boost actif en header + badge dans inventory

## 10. Dry-run production

Premier mint en test — acheter un tier Bronze avec wallet deployer :

```bash
# Vérifier côté contract sur polygonscan:
# - balanceOf(deployer) = 1
# - tokenURI(tokenId) retourne bien le JSON metadata
# - royaltyInfo() = 5% au fee wallet (EIP-2981)
```

## 11. Marketing activation

- Update site banner : "🚀 BOOST NFT MARKETPLACE LIVE"
- Tweet annonce avec screenshot UI
- Discord pin : explication des 4 tiers + prix + multipliers
- Reddit r/PolygonNetwork + r/CryptoGaming post

## 12. Monitoring

- Uptime Kuma : `/api/boost/catalog` check
- Polygonscan contract watch : alert sur nouveaux mints
- Dashboard admin : table `boost_mult_cache` doit se peupler via cron

## 13. Post-launch

- Watch stats mint volume vs tier distribution
- Si un tier sell-out, envisager nouvelle édition ou tier supérieur
- Potentiellement ajouter "Founder's Edition" limited supply après 1000 mint total

## 14. Secrets hygiene

```bash
# Après deploy réussi:
# 1. Rotate DEPLOYER_PK dans un nouveau wallet burner
# 2. Purger le fichier contracts/.env local
# 3. Verifier .gitignore contient bien contracts/.env

git status contracts/
# NE DOIT PAS afficher .env en untracked si gitignore correct
```

## 15. Rollback path

Pas de rollback possible pour un contract deployed. Mais on peut :
- `BOOST_ENABLED=0` backend → endpoints renvoient `{enabled: false}`
- UI se cache automatiquement
- Nouveau contract peut être deployed avec adresse différente

---

**Post-deploy = unblock task #66.** Après le deploy, marquer la task `completed`.

**Status global :**
- ✅ #67 contract écrit
- ✅ #71 backend intégré
- ✅ #72 frontend UI
- ⏳ #66 — **YOU ARE HERE** : deploy mainnet
- ⏳ #65 — DEX liquidity (day of launch)
