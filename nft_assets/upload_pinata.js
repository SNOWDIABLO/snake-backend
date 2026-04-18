#!/usr/bin/env node
/**
 * upload_pinata.js
 * Upload des images NFT + metadata JSON vers Pinata via leur API.
 *
 * Prérequis:
 *   1. Compte Pinata: https://app.pinata.cloud (free tier OK pour <1GB)
 *   2. JWT API key: https://app.pinata.cloud/developers/api-keys
 *   3. Mettre la clé dans .env: PINATA_JWT=eyJhbGc...
 *   4. npm install axios form-data dotenv
 *
 * Usage:
 *   node upload_pinata.js images   → upload tiers/*.jpg → output les 4 CIDs
 *   node upload_pinata.js metadata → upload metadata/  → output base CID
 *   node upload_pinata.js both     → fait les 2 + génère metadata entre
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const { execFileSync } = require('child_process');

const PINATA_JWT = process.env.PINATA_JWT;
if (!PINATA_JWT) {
  console.error('❌ PINATA_JWT manquant dans .env');
  console.error('   Créer une JWT key: https://app.pinata.cloud/developers/api-keys');
  process.exit(1);
}

const TIERS_DIR    = path.join(__dirname, 'tiers');
const METADATA_DIR = path.join(__dirname, 'metadata');

// ── HTTP client Pinata ──────────────────────────────────────────────────────
const pinata = axios.create({
  baseURL: 'https://api.pinata.cloud',
  headers: { Authorization: `Bearer ${PINATA_JWT}` },
  maxBodyLength: Infinity,
});

// ── Upload single file ──────────────────────────────────────────────────────
async function uploadFile(filePath, name) {
  const data = new FormData();
  data.append('file', fs.createReadStream(filePath));
  data.append('pinataMetadata', JSON.stringify({ name }));
  data.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

  const res = await pinata.post('/pinning/pinFileToIPFS', data, {
    headers: { ...data.getHeaders() },
  });
  return res.data.IpfsHash;
}

// ── Upload directory (recursif) ─────────────────────────────────────────────
// IMPORTANT: filepath = juste le nom du fichier (pas de prefix).
// Sinon le baseURI doit inclure le prefix → setBaseURI("ipfs://CID/prefix/")
// au lieu de setBaseURI("ipfs://CID/"). On veut le path le plus clean possible.
async function uploadDir(dirPath, name) {
  const data = new FormData();
  for (const file of fs.readdirSync(dirPath)) {
    const full = path.join(dirPath, file);
    if (fs.statSync(full).isFile()) {
      // Pinata exige un filepath avec un prefix de dossier pour wrapWithDirectory.
      // On utilise un dossier "virtuel" "m" (court, non exposé dans le baseURI).
      // En fait on peut juste utiliser le nom du fichier seul si on laisse wrapWithDirectory
      // faire son travail : tous les files sous le même parent virtuel → CID root = ce parent.
      data.append('file', fs.createReadStream(full), { filepath: `m/${file}` });
    }
  }
  data.append('pinataMetadata', JSON.stringify({ name }));
  data.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: true }));

  const res = await pinata.post('/pinning/pinFileToIPFS', data, {
    headers: { ...data.getHeaders() },
  });
  // Ce CID = CID du "wrapper" qui contient le dossier "m" avec tous les JSON dedans.
  // Donc le baseURI sera : ipfs://<CID>/m/
  // → on doit append "/m" au baseCid avant de le renvoyer à l'appelant.
  return res.data.IpfsHash + '/m';
}

// ── Main ─────────────────────────────────────────────────────────────────────
const mode = process.argv[2] || 'both';

(async () => {
  let cids = {};

  if (mode === 'images' || mode === 'both') {
    console.log('📤 Uploading tier images to Pinata...');
    for (const tier of ['gold', 'silver', 'bronze', 'top10']) {
      const file = path.join(TIERS_DIR, `${tier}.jpg`);
      if (!fs.existsSync(file)) { console.error(`❌ Missing ${file}`); process.exit(1); }
      console.log(`   uploading ${tier}.jpg...`);
      const cid = await uploadFile(file, `snakecoin-trophy-${tier}`);
      cids[tier] = `${cid}/${tier}.jpg`; // path-style ne marche que si dir → on garde juste le file CID
      // Format direct: ipfs://<CID> sans path car upload single file
      cids[tier] = cid;
      console.log(`   ✅ ${tier}: ipfs://${cid}`);
    }
    fs.writeFileSync(path.join(__dirname, 'image_cids.json'), JSON.stringify(cids, null, 2));
    console.log('💾 Saved CIDs to ./image_cids.json');
  } else if (fs.existsSync(path.join(__dirname, 'image_cids.json'))) {
    cids = JSON.parse(fs.readFileSync(path.join(__dirname, 'image_cids.json')));
    console.log('📂 Loaded existing CIDs from image_cids.json');
  }

  if (mode === 'metadata' || mode === 'both') {
    if (!cids.gold) {
      console.error('❌ Pas de CIDs images dispo. Run: node upload_pinata.js images');
      process.exit(1);
    }
    // Génère les metadata avec les CIDs
    // Fix Windows path with spaces (C:\Users\Alien Ware\...) : execFileSync au lieu de execSync
    // → passe les args en array, évite les soucis de shell parsing.
    console.log('📝 Generating metadata JSON files...');
    execFileSync(process.execPath, [
      path.join(__dirname, 'generate_metadata.js'),
      '--gold',   cids.gold,
      '--silver', cids.silver,
      '--bronze', cids.bronze,
      '--top10',  cids.top10,
    ], { stdio: 'inherit' });

    console.log('📤 Uploading metadata directory to Pinata...');
    const baseCid = await uploadDir(METADATA_DIR, 'snakecoin-trophy-metadata');
    console.log(`   ✅ Base metadata CID: ipfs://${baseCid}`);

    fs.writeFileSync(path.join(__dirname, 'base_cid.txt'), baseCid + '\n');
    console.log(`💾 Saved to ./base_cid.txt`);
    console.log(``);
    console.log(`🎯 NEXT STEP — sur le contract NFT (Remix ou Polygonscan "Write Contract") :`);
    console.log(`   setBaseURI("ipfs://${baseCid}/")`);
    console.log(``);
    console.log(`   Verify avec: cast call <CONTRACT> "tokenURI(uint256)(string)" 1001 --rpc-url polygon`);
  }
})().catch(err => {
  console.error('❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
