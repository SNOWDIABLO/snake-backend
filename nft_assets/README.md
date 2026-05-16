# NFT Assets — SnakeCoin Trophy

Images NFT + pipeline IPFS/Pinata pour les trophées saisonniers.

---

## Structure finale

```
nft_assets/
├── tiers/                      ← Les 4 images NFT finales (1 par tier)
│   ├── gold.jpg                ← GOLD  (rank 1)   → 25 USD  | Rouge/feu
│   ├── silver.jpg              ← SILVER (rank 2)  → 15 USD  | Chrome argenté
│   ├── bronze.jpg              ← BRONZE (rank 3)  → 10 USD  | Bronze cosmic
│   └── top10.jpg               ← TOP10 (rank 4-10) → 5 USD  | Vert émeraude
├── reserve/                    ← Stock pour drops événementiels futurs
│   ├── gold_alt_classic.jpg    ← Alt Gold (trophée doré classique)
│   ├── legendary_rainbow.jpg   ← Iridescent multicolor
│   └── legendary_purple.jpg    ← Purple/magenta
├── raw/                        ← Originaux Gemini (backup intouché)
├── metadata/                   ← (généré) JSON metadata par tokenId
├── generate_metadata.js        ← Script génération metadata
├── upload_pinata.js            ← Script upload IPFS via Pinata API
├── package.json                ← Dépendances npm
└── README.md                   ← Ce fichier
```

---

## Workflow déploiement (3 étapes)

### 1️⃣ Préparation Pinata

1. Créer compte : https://app.pinata.cloud (free = 1GB, largement OK)
2. Générer JWT API key : https://app.pinata.cloud/developers/api-keys
   - Scope recommandé : `pinFileToIPFS`, `pinList`, `unpin`
3. Ajouter dans `../snake-backend/.env` :
   ```
   PINATA_JWT=eyJhbGciOiJIUzI1NiIs...
   ```

### 2️⃣ Install dépendances

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\nft_assets"
npm install
```

### 3️⃣ Run upload (full auto)

```powershell
# Upload les 4 images → génère metadata JSON → upload metadata folder → affiche base CID
npm run upload:all
```

Output attendu :
```
📤 Uploading tier images to Pinata...
   ✅ gold: ipfs://bafybeixxx...
   ✅ silver: ipfs://bafybeiyyy...
   ✅ bronze: ipfs://bafybeizzz...
   ✅ top10: ipfs://bafybeiaaa...
💾 Saved CIDs to ./image_cids.json

📝 Generating metadata JSON files...
✅ Generated 100 metadata JSON files in ./metadata/  (S1..S10 × 10 ranks)

📤 Uploading metadata directory to Pinata...
   ✅ Base metadata CID: ipfs://bafybeiBASECID...
💾 Saved to ./base_cid.txt

🎯 NEXT STEP — sur le contract NFT :
   setBaseURI("ipfs://bafybeiBASECID.../")
```

### 4️⃣ Appliquer sur le contract

Sur **Polygonscan → Write Contract** (après deploy + verify) :

```
setBaseURI("ipfs://bafybeiBASECID.../")
```

**OU** dans Remix avec le wallet owner.

Ça déclenche aussi l'event `BatchMetadataUpdate(0, max)` → OpenSea refresh auto les 100+ NFT potentiels.

---

## Scripts disponibles

| Script | Fonction |
|--------|----------|
| `npm run metadata` | Génère les metadata JSON seulement (besoin des CIDs en args) |
| `npm run upload:images` | Upload les 4 images tiers → écrit `image_cids.json` |
| `npm run upload:metadata` | Génère metadata + upload folder → écrit `base_cid.txt` |
| `npm run upload:all` | Fait les 2 en enchaînement (workflow complet) |

### Régénérer metadata pour +10 saisons plus tard

```powershell
# Ex: Ajouter S11..S20 sans refaire l'upload images
node generate_metadata.js --gold $(cat image_cids.json | jq -r .gold) --silver ... --seasons 11-20
# Puis re-upload metadata/
node upload_pinata.js metadata
```

---

## Format metadata généré

Exemple `1001.json` (S1 #1 Gold) :

```json
{
  "name": "SnakeCoin Trophy S1 #1",
  "description": "Top 1 Gold trophy — the ultimate champion of Season 1 on SnakeCoin P2E. Grants permanent $SNAKE claim multiplier and in-game cosmic skin. Earn yours at snowdiablo.xyz",
  "image": "ipfs://bafybeixxx",
  "external_url": "https://snowdiablo.xyz",
  "background_color": "0A0A1A",
  "attributes": [
    {"trait_type": "Season",     "value": 1},
    {"trait_type": "Rank",       "value": 1},
    {"trait_type": "Tier",       "value": "Gold"},
    {"trait_type": "Multiplier", "value": "+25%"},
    {"trait_type": "Game",       "value": "SnakeCoin P2E"},
    {"trait_type": "Chain",      "value": "Polygon"}
  ]
}
```

---

## Mapping tier → image (final)

| Tier | Rank | Prix USD | Image | Multiplier $SNAKE |
|------|------|----------|-------|-------------------|
| **Gold** | 1 | 25 $ | `gold.jpg` (rouge/feu) | +25% permanent |
| **Silver** | 2 | 15 $ | `silver.jpg` (chrome) | +15% permanent |
| **Bronze** | 3 | 10 $ | `bronze.jpg` (cosmic patiné) | +10% permanent |
| **Top10** | 4–10 | 5 $ | `top10.jpg` (emerald) | +5% permanent |

---

## Troubleshooting

**401 Unauthorized** → JWT expiré ou mal copié. Regénérer sur Pinata.

**413 Payload Too Large** → Free tier limite 100MB/file. Nos images font 230-270KB, aucun problème.

**Metadata not showing on OpenSea** → Polygon peut mettre 10-30 min à indexer. Forcer : `refreshAllMetadata()` sur contract, puis bouton "Refresh metadata" sur page OpenSea.

**Image ne charge pas** → Pinata free gateway peut être slow. Ajouter fallback gateway :
- `ipfs://` (accepté par OpenSea)
- `https://gateway.pinata.cloud/ipfs/<CID>` (HTTP fallback)
- `https://ipfs.io/ipfs/<CID>` (public)

---

## Gas cost estimé (Polygon mainnet)

| Action | Gas | POL (~) | USD (~$0.50/POL) |
|--------|-----|---------|-------------------|
| `setBaseURI()` | ~50k | 0.002 | $0.001 |
| `refreshAllMetadata()` | ~30k | 0.001 | $0.0005 |
| `setCustomURI()` (override 1 token) | ~80k | 0.003 | $0.0015 |

---

## Crédit / propriété

- Générées par : **Gemini** (Google AI) — avril 2026
- Prompts / direction artistique : **SnowDiablo**
- Usage : exclusif projet SnakeCoin P2E (snowdiablo.xyz)
