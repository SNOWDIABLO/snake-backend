# Guide Déploiement — SnakeTrophyNFT (Task #22)

Déploiement du contract ERC-721 des trophées NFT saisonniers sur Polygon mainnet.

---

## 1. Prérequis

- Wallet admin avec **~2 POL** (pour deploy + tx init)
- Même `SIGNER_PK` que le contract $SNAKE (ou nouvelle clé dédiée NFT)
- MetaMask connecté à **Polygon mainnet** (chainId 137)
- Accès **Railway** (service backend) pour set l'env var
- Accès **GitHub** (repo snake-backend-git) pour push l'index.html

---

## 2. Compiler dans Remix

1. Va sur [remix.ethereum.org](https://remix.ethereum.org)
2. Crée un nouveau workspace ou upload le fichier `snake-contract/SnakeTrophyNFT.sol`
3. Dans l'onglet **Solidity Compiler** :
   - Version : **0.8.24** (ou plus récent, minimum 0.8.20)
   - Optimizer : **ON**, runs = **200**
   - EVM Version : **paris** (par défaut OK)
   - **⚠️ Advanced Configurations → Use `viaIR`** : **ON** (obligatoire, sinon "stack too deep" à cause du SVG volumineux)
   - Language : **Solidity**
4. Clique **Compile SnakeTrophyNFT.sol**
5. ✅ Doit compiler sans erreur ni warning. Bytecode déployé **~21.4 KB (11% de marge EIP-170)**.

> 💡 Le contract intègre maintenant : 3-tier metadata fallback + Chainlink POL/USD pricing. Voir sections 11 et 12 pour le détail.

---

## 3. Déployer sur Polygon mainnet

1. Onglet **Deploy & Run Transactions** dans Remix
2. Environment : sélectionne **Injected Provider - MetaMask**
3. MetaMask ouvre → sélectionne **Polygon Mainnet** (chainId 137)
4. Dans le dropdown Contract : **SnakeTrophyNFT**
5. Paramètres constructor :
   - `_signer` : l'adresse du signer backend
     ```
     # Pour récupérer l'adresse de ton signer backend (sur Railway) :
     ssh railway / node -e "console.log(new (require('ethers').Wallet)(process.env.SIGNER_PK).address)"
     # OU via un log du backend au boot (ligne "✅ Signer wallet:")
     ```
   - `_priceFeed` : adresse Chainlink POL/USD sur Polygon mainnet
     ```
     0xAB594600376Ec9fD91F8e885dADF0CE036862dE0
     ```
     (passer `0x0000000000000000000000000000000000000000` pour désactiver Chainlink → fallback flat `mintFee`)
6. Clique **Deploy**
7. MetaMask confirme → attends la tx minée (~5 sec sur Polygon)
8. Copie l'**adresse du contract déployé** (visible dans "Deployed Contracts" en bas à gauche)

---

## 4. Vérifier le source code sur Polygonscan

Obligatoire pour que OpenSea affiche les NFT correctement + que les users puissent lire le code.

1. Va sur [polygonscan.com](https://polygonscan.com) → cherche ton contract address
2. Onglet **Contract** → **Verify and Publish**
3. Options :
   - Compiler : **v0.8.20**
   - License : **MIT**
   - Optimization : **Yes, 200 runs**
4. Upload **single file flattened** :
   - Dans Remix : clic droit sur `SnakeTrophyNFT.sol` → **Flatten**
   - Copie le contenu du `_flattened.sol` généré
   - Colle dans Polygonscan
5. Constructor args : **ABI-encoded** des 2 adresses (signer + price feed) :
   ```
   # Dans Remix console :
   web3.eth.abi.encodeParameters(
     ['address', 'address'],
     ['0xTonSignerAddress', '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0']
   )
   # Retire le préfixe 0x, c'est ton constructor argument
   ```
6. Submit → attends ~30 sec → ✅ "Contract Source Code Verified"

---

## 5. Configurer Railway (backend)

Dans ton service Railway → **Variables** → **+ New Variable** :

```
NFT_CONTRACT_ADDRESS = 0xTonContractNFTAddress
```

Redeploy automatique (~2 min). Check les logs pour :
```
🏆 Contract NFT    : 0xTonContractNFTAddress
```

---

## 6. Configurer le frontend (index.html)

Dans `snake-backend/index.html` ligne 759 :

```javascript
const NFT_CONTRACT_ADDRESS = '0xTonContractNFTAddress';
```

Puis :

```powershell
# Copy vers le repo git
Copy-Item "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\index.html" "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend-git\index.html" -Force

cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend-git"
git add index.html
git commit -m "feat(nft): plug NFT contract address"
git push
```

FTP GitHub Actions déploie vers snowdiablo.xyz en ~30s.

---

## 7. Test en local

```powershell
# Check backend reconnaît le contract
Invoke-RestMethod "https://snake-backend-production-e5e8.up.railway.app/api/nft/eligibility/0x0000000000000000000000000000000000000000"

# Réponse attendue :
# {
#   "address": "0x0000000000000000000000000000000000000000",
#   "contract": "0xTonContractNFT...",
#   "mintFee_pol": "10",
#   "drops": []
# }
```

---

## 8. Setup OpenSea collection

Une fois un premier NFT minté (via un premier drop de saison + mint d'un user), la collection apparaîtra automatiquement sur :

```
https://opensea.io/collection/snakecoin-trophy
```

Pour customiser :

1. Va sur https://opensea.io/account/collected
2. Clique sur ton NFT SnakeCoin Trophy
3. Onglet collection → **Edit** (si tu es owner du contract, détecté via signed msg)
4. Upload logo, banner, description
5. Set **Royalties** : 500 basis points (5%) → wallet admin (déjà hardcodé dans contract mais OpenSea override)

---

## 9. Trigger le premier drop de saison

Une fois tout déployé, pour tester le flow complet (ou pour clôturer une saison en prod) :

```powershell
# Clôture la saison en cours + lance une nouvelle
Invoke-RestMethod -Uri "https://snake-backend-production-e5e8.up.railway.app/api/admin/season/close" `
  -Method POST `
  -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} `
  -ContentType "application/json" `
  -Body '{"newName":"Season 2"}'
```

Cela va :
- Archiver les résultats top 500 dans `season_results`
- Insérer les **top 10** dans `nft_drops` avec status=`eligible`
- Auto-post sur **Bluesky** + **Discord** + **Twitch** l'annonce des drops
- Les top 10 peuvent mint leur trophée depuis snowdiablo.xyz

---

## 10. Monitoring

**Admin endpoint pour voir tous les drops :**

```powershell
# Ajoute un endpoint à server.js si tu veux un dashboard des NFT drops :
# GET /api/admin/nft/drops (retourne tous les drops avec status)
```

**Alertes Discord** : chaque mint trigger déjà un embed dans ton channel public (géré par `/api/nft/confirm`).

**Withdraw les POL collectés** (fees de mint) :

```javascript
// Depuis Remix avec le wallet owner :
contract.withdraw()
// Transfère tous les POL du contract vers l'owner
```

---

## Checklist de vérif post-deploy

- [ ] Contract déployé sur Polygon mainnet ✅
- [ ] Source verified sur Polygonscan ✅
- [ ] Adresse signer du contract = `wallet.address` du backend ✅
- [ ] `NFT_CONTRACT_ADDRESS` set dans Railway env ✅
- [ ] `NFT_CONTRACT_ADDRESS` set dans index.html ✅
- [ ] Railway rebuild OK, log `🏆 Contract NFT : 0x...` ✅
- [ ] FTP deploy index.html → snowdiablo.xyz OK ✅
- [ ] Test `GET /api/nft/eligibility/0x0...` retourne `contract` non null ✅
- [ ] Section "Mes Trophées" invisible quand aucun drop éligible ✅
- [ ] Premier drop de saison trigger les autopost Bluesky/Discord/Twitch ✅

---

## Paramètres ajustables post-deploy

Tous via Remix + ton wallet owner :

| Paramètre | Fonction | Default |
|-----------|----------|---------|
| mintFee legacy (POL) | `setMintFee(uint256 _newFee)` | 10 POL |
| **mintFee USD par tier** (cents) | `setMintFeeUSD(uint256 rank, uint256 cents)` | Gold 2500 / Silver 1500 / Bronze 1000 / Top10 500 |
| **Price feed Chainlink** | `setPriceFeed(address _feed)` | POL/USD Polygon mainnet |
| **Feed staleness max** | `setMaxStaleSec(uint256 _sec)` | 3600 (1h) |
| Royalty % | `setRoyalty(address receiver, uint96 bps)` | 5% (500 bps) |
| Signer backend | `setSigner(address _newSigner)` | constructor |
| Renderer V2 (fan art) | `setRenderer(address _renderer)` | address(0) |
| BaseURI hosting | `setBaseURI(string)` | "" |
| Override 1 token | `setCustomURI(uint256 tokenId, string)` | "" |
| Refresh metadata | `refreshMetadata(uint256)` / `refreshAllMetadata()` | — |
| Mint de secours | `ownerMint(address to, uint256 season, uint256 rank)` | — |
| Retrait fees | `withdraw()` | — |

---

## 11. Upgrader l'apparence des NFT (futur graphiste / fan art)

Le contract supporte un **3-tier metadata fallback** + override per-token. Tu peux changer le visuel sans toucher au contract principal.

### Ordre de priorité (du plus haut au plus bas)

```
customURI[tokenId]  →  renderer  →  baseURI  →  SVG on-chain default
```

### Workflow A : Renderer V2 (recommandé pour redesign global)

1. Le graphiste te fournit un SVG (ou tu lui files `SnakeTrophyRendererTemplate.sol`)
2. Tu copies le SVG dans la fonction `_buildSVG()` du template
3. Compile + deploy `SnakeTrophyRendererV2` sur Polygon (Remix → ~0.05 POL gas)
4. Récupère l'adresse du renderer déployé
5. Sur le contract NFT principal, appelle :
   ```
   setRenderer("0xAdresseDuNouveauRenderer")
   ```
6. TOUS les NFT existants + futurs utilisent le nouveau visuel
7. OpenSea refresh auto via event EIP-4906 `BatchMetadataUpdate` (~5-30 min)

**Pour revenir à l'ancien design :** `setRenderer(0x0000000000000000000000000000000000000000)` → fallback sur SVG on-chain initial.

### Workflow B : BaseURI hosting (assets PNG/JPG haute qualité)

1. Génère les 10 metadata JSON + images (1001.json, 1002.json, ...) avec le format OpenSea standard
2. Upload sur IPFS (Pinata, web3.storage) ou Cloudflare R2 / serveur perso
3. Récupère le CID/URL de base
4. Appelle :
   ```
   setBaseURI("ipfs://bafy.../")
   # OU
   setBaseURI("https://snowdiablo.xyz/nft/metadata/")
   ```
5. Le tokenURI deviendra `baseURI + tokenId + ".json"` (ex: `ipfs://bafy.../1001.json`)
6. ATTENTION : renderer doit être à 0x0 pour que baseURI prenne effet

### Workflow C : Override d'un seul token (cas spécial fan art unique)

```javascript
// Ex: tu fais peindre un fan art unique pour le Gold S1 (tokenId 1001)
nft.setCustomURI(1001, "ipfs://bafyUniqueArt/metadata.json")
```

Annule l'override : `setCustomURI(1001, "")`

### Refresh forcé OpenSea

Si le visuel ne se met pas à jour automatiquement après 30 min :
- Single token : `refreshMetadata(tokenId)`
- Tous : `refreshAllMetadata()`
- Manuel sur OpenSea : page du NFT → bouton "Refresh metadata" en haut à droite

### Format JSON metadata standard OpenSea

```json
{
  "name": "SnakeCoin Trophy S1 #1",
  "description": "Top 1 trophy for Season 1 on SnakeCoin P2E.",
  "image": "ipfs://bafy.../gold-1.png",
  "external_url": "https://snowdiablo.xyz",
  "attributes": [
    {"trait_type": "Season", "value": 1},
    {"trait_type": "Rank", "value": 1},
    {"trait_type": "Tier", "value": "Gold"}
  ]
}
```

### Coûts gas estimés (Polygon mainnet, ~0.001 POL/tx)

| Action | Gas | Prix POL (~) |
|---|---|---|
| Deploy nouveau renderer | ~1.5M gas | 0.05 POL |
| `setRenderer()` | ~50k gas | 0.002 POL |
| `setBaseURI()` | ~50k gas | 0.002 POL |
| `setCustomURI()` | ~80k gas | 0.003 POL |
| `refreshAllMetadata()` | ~30k gas | 0.001 POL |

---

## 12. Pricing tiered USD via Chainlink

Le contract calcule le prix de mint **en USD**, converti en POL wei via l'oracle Chainlink POL/USD (polygon mainnet). Si le feed est down ou stale (> `maxStaleSec`), le contract retombe automatiquement sur `mintFee` (valeur plate en POL).

### Grille de prix par défaut (en cents USD)

| Rank | Tier | Prix USD | Gas-safe fallback POL |
|------|------|----------|-----------------------|
| 1 | Gold | **2500** (= 25.00 $) | 10 POL |
| 2 | Silver | **1500** (= 15.00 $) | 10 POL |
| 3 | Bronze | **1000** (= 10.00 $) | 10 POL |
| 4–10 | Top10 | **500** (= 5.00 $) | 10 POL |

### Formule de calcul

```
wei = cents * 10^(feedDecimals + 16) / answer
```

Exemple POL à 0.50 $ (answer = 50_000_000 avec 8 decimals) :
- Gold : `2500 * 1e24 / 5e7 = 5e20 wei = 50 POL` → 50 × 0.50 = **25 $** ✓
- Top10 : `500 * 1e24 / 5e7 = 1e20 wei = 10 POL` → 10 × 0.50 = **5 $** ✓

### Vérifier le pricing live (après deploy)

Dans Remix ou via Polygonscan "Read Contract" :

```
mintFeeFor(1)   // retourne wei pour Gold
mintFeeFor(2)   // Silver
mintFeeFor(3)   // Bronze
mintFeeFor(4)   // Top10
```

Compare avec le prix POL live sur CoinGecko. Si c'est proche de la grille USD × prix_pol, c'est OK.

### Ajuster un prix tier après deploy

```javascript
// Monter Gold à 30 $
contract.setMintFeeUSD(1, 3000)

// Tous les ranks 4-10 à 7.50 $ (via slot 4)
contract.setMintFeeUSD(4, 750)
```

### Migrer vers un autre feed Chainlink

Si Chainlink deprecate le POL/USD actuel (rare mais possible), check la liste officielle : https://data.chain.link/polygon/mainnet

```javascript
contract.setPriceFeed("0xNouveauFeedAddress")
```

### Désactiver Chainlink (fallback 100% flat POL)

```javascript
contract.setPriceFeed("0x0000000000000000000000000000000000000000")
// mint() utilisera maintenant mintFee (flat POL)
```

### Feed staleness

Par défaut `maxStaleSec = 3600` (1h). Sur Polygon mainnet, le POL/USD feed update ~toutes les 30 min (deviation > 1%). Si tu veux être plus strict :

```javascript
contract.setMaxStaleSec(1800)  // 30 min
```

---

## Troubleshooting

**Erreur "Signature invalide" au mint :**
→ Vérifier que `NFT_CONTRACT_ADDRESS` dans Railway = adresse réelle du contract.
→ Vérifier que le signer du contract (constructor arg) = `wallet.address` du backend Railway.

**Erreur "Fee insuffisant" :**
→ User n'envoie pas assez de POL. Le frontend lit `mintFee()` du contract, vérifier que `getNftMintFee()` retourne bien `10 ether` = 10e18 wei.

**Mint passe mais rien ne s'affiche sur OpenSea :**
→ Polygon peut mettre 10-30 min à indexer. Force refresh : https://opensea.io/assets/matic/0xCONTRACT/TOKENID + bouton "Refresh metadata".

**SVG cassé sur OpenSea :**
→ Copie le tokenURI retourné par `contract.tokenURI(tokenId)`, décoder le base64 JSON, vérifier que le champ `image` est bien un data-URI valide.
