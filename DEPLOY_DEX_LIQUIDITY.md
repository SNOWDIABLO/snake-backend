# DEPLOY — Add Liquidity $SNAKE sur Polygon DEX (Task #65)

Runbook pour ajouter la liquidité initiale $SNAKE/WPOL ou $SNAKE/USDC sur QuickSwap v3 (Polygon mainnet).

**⚠️ STEALTH REVEAL — à exécuter le jour du launch public uniquement.**

## 0. Pré-requis

- Wallet deployer avec :
  - $SNAKE : montant à locker (ex: 10% du supply total)
  - WPOL ou USDC : montant matching (ratio détermine le prix initial)
  - POL : 5-10 pour couvrir gas de approve + mint NFT position
- Decision : **QuickSwap v3** (recommandé — natif Polygon, concentrated liquidity, plus de volume)
  - Alternative : Uniswap v3 (plus universel mais moins de volume Polygon)

## 1. Choix de la pair

| Pair | Avantages | Inconvénients |
|------|-----------|---------------|
| `$SNAKE / WPOL` | Native Polygon, gas plus cheap | Volatilité POL |
| `$SNAKE / USDC` | Prix stable en USD | Moins de TVL disponible |

**Recommandé :** démarrer avec **$SNAKE/WPOL** pour capter le volume natif, ajouter $SNAKE/USDC plus tard.

## 2. Calcul du prix initial

Formule : `price = amountPair / amountSnake`

Exemple :
- Locker 1 000 000 $SNAKE + 2 000 WPOL → prix = 0.002 WPOL/$SNAKE (~0.0016 USD selon POL)

Utiliser ce script pour simuler avant :

```js
// price-calc.js
const SNAKE_SUPPLY = 100_000_000n * 10n**18n;  // 100M total
const SNAKE_LOCKED = 10_000_000n * 10n**18n;   // 10% en LP
const POL_LOCKED   = 20_000n    * 10n**18n;   // 20k POL
const POL_USD      = 0.80;

const snakePerPol = Number(SNAKE_LOCKED) / Number(POL_LOCKED);
const snakeUsd    = POL_USD / snakePerPol;
console.log(`Initial price: 1 $SNAKE = ${snakePerPol.toFixed(6)} POL = $${snakeUsd.toFixed(6)}`);
console.log(`Market cap initial: $${(snakeUsd * Number(SNAKE_SUPPLY/10n**18n)).toLocaleString()}`);
```

## 3. QuickSwap v3 — Étapes UI (recommandé)

1. Aller sur https://quickswap.exchange/#/pools → **Add Liquidity V3**
2. Selectionner `$SNAKE` (coller adresse du token) + `WPOL`
3. Fee tier : **1%** (recommandé pour nouveau token, plus de frais captés)
4. Price range :
   - **Full range** si on veut max couverture (recommandé pour lockup)
   - **Concentrated** si on veut scalper le spread (risque IL accru)
5. Deposit amounts :
   - SNAKE: 10 000 000
   - WPOL : 20 000 (ou ajuster selon ratio)
6. **Approve** SNAKE puis **Approve** WPOL → signer les 2 tx
7. **Add Liquidity** → signer la tx finale
8. Un NFT LP position est mint sur ton wallet

## 4. Lock LP (optional mais RECOMMANDÉ)

Lock le NFT LP position pour prouver rug-proof :

- **UNCX Network** : https://app.uncx.network/lockers/univ3/new (supporte QuickSwap v3)
- **Team Finance** : https://team.finance
- Durée recommandée : **12 mois minimum** pour credibility

Étape :
1. Connect wallet qui détient le LP NFT
2. Sélectionner la position
3. Choisir durée (12-24 mois)
4. Approve + Lock

Screenshot + post sur snowdiablo.xyz pour proof.

## 5. Renounce ownership du token (si smart contract)

Si le token $SNAKE a une `Ownable` function :

```bash
# Polygonscan UI → Write Contract → renounceOwnership()
# OU via cast :
cast send $CONTRACT_ADDRESS "renounceOwnership()" --private-key $DEPLOYER_PK --rpc-url $POLYGON_RPC
```

⚠️ **Irréversible.** Vérifier qu'aucune fonctionnalité ownerOnly n'est encore nécessaire (mint new supply, etc.) avant renounce.

## 6. Update backend avec address pair

Après LP création, récupérer l'adresse du pool (visible dans l'URL du NFT position QuickSwap) et l'ajouter aux env vars si un système de price oracle utilise le pool :

```bash
# Railway env
QUICKSWAP_POOL_ADDRESS=0x...
```

## 7. Announce

Post simultané :
- **Twitter/X** : "🐍 $SNAKE is LIVE — QuickSwap v3 LP opened, LP locked 12mo via UNCX. Ownership renounced. Let's go."
- **Discord** : pinned post avec link LP + scanner
- **Bluesky** : repost
- **Site** : bannière "$SNAKE is LIVE" avec bouton "Buy on QuickSwap"

## 8. Add to DEX Screener + CoinGecko

- **DEX Screener** : auto-detect après 1st swap. Ajouter les infos token (logo, description, socials) via https://dexscreener.com/update
- **GeckoTerminal** : idem, auto-detect
- **CoinGecko** : manual submission sous 24-48h — https://www.coingecko.com/en/coins/new

## 9. Monitoring post-launch

- **DEX Screener** : watch price + volume 24h
- **Polygonscan** : watch token holders + top movements
- **Uptime Kuma** : check que le backend survive au spike de load
- **Bot whale alert** : déjà en place via task #25 (Bluesky/Discord auto-post sur top scorers/whales)

## 10. Contingency

Si flash-crash post-launch :
- Pas de rug possible (LP locked + owner renounced), mais...
- Pause des claims $SNAKE backend side via `CLAIMS_ENABLED=0` pour laisser le prix se stabiliser
- Communication transparente sur Discord
- Potentiellement add emergency liquidity via team multisig si fonds dispo

---

**Ordre d'exécution day-of :**
1. ✅ Tournois/Clans live sur site (stealth ok)
2. ✅ NFT Boost deploy mainnet (task #66) + activé
3. 🚀 LP QuickSwap v3 creation
4. 🔒 LP NFT lock UNCX
5. 🚫 Renounce ownership contract
6. 📢 Announce partout simultané
7. 🎙️ Stream launch day sur Twitch

**À préparer :**
- Tweet draft prêt dans un .md
- Graphic launch (Canva ou photoshop)
- Discord announcement rédigé
- Liste investors/whales à notifier en DM 30min avant
