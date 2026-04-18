#!/usr/bin/env node
/**
 * generate_metadata.js
 * Génère les metadata JSON pour chaque tokenId (season × 1000 + rank)
 * Pour chaque tier, utilise le CID IPFS de l'image correspondante.
 *
 * Usage:
 *   node generate_metadata.js --gold bafy... --silver bafy... --bronze bafy... --top10 bafy... [--seasons 1-10]
 *
 * Output: ./metadata/1001.json, 1002.json, ... (crée 10 tokens/saison × N saisons)
 */

const fs = require('fs');
const path = require('path');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, def = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}

const CIDS = {
  gold:   arg('gold'),
  silver: arg('silver'),
  bronze: arg('bronze'),
  top10:  arg('top10'),
};
const seasonsArg = arg('seasons', '1-10'); // Par défaut : prépare S1..S10
const [sStart, sEnd] = seasonsArg.split('-').map(Number);

// ── Validation ───────────────────────────────────────────────────────────────
const missing = Object.entries(CIDS).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error('❌ Missing CIDs:', missing.join(', '));
  console.error('Usage: node generate_metadata.js --gold <CID> --silver <CID> --bronze <CID> --top10 <CID>');
  console.error('Un CID doit inclure le path complet (ex: bafybeixxx/gold.jpg)');
  process.exit(1);
}

// ── Output dir ───────────────────────────────────────────────────────────────
const OUT_DIR = path.join(__dirname, 'metadata');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Tier helper ──────────────────────────────────────────────────────────────
function tierFor(rank) {
  if (rank === 1) return { name: 'Gold',   cid: CIDS.gold,   desc: 'the ultimate champion' };
  if (rank === 2) return { name: 'Silver', cid: CIDS.silver, desc: 'the relentless second' };
  if (rank === 3) return { name: 'Bronze', cid: CIDS.bronze, desc: 'the rising threat' };
  return             { name: 'Top10',  cid: CIDS.top10,  desc: 'among the top 10 elite' };
}

// ── Génération ───────────────────────────────────────────────────────────────
let count = 0;
for (let season = sStart; season <= sEnd; season++) {
  for (let rank = 1; rank <= 10; rank++) {
    const tokenId = season * 1000 + rank;
    const tier = tierFor(rank);

    // Description : évite le doublon "Top 5 Top10" en n'affichant le tier name que pour rank 1-3
    const tierLabel = rank <= 3 ? `${tier.name} trophy` : `trophy`;
    const meta = {
      name: `SnakeCoin Trophy S${season} #${rank}`,
      description: `Top ${rank} ${tierLabel} — ${tier.desc} of Season ${season} on SnakeCoin P2E. Grants permanent $SNAKE claim multiplier and in-game cosmic skin. Earn yours at snowdiablo.xyz`,
      image: `ipfs://${tier.cid}`,
      external_url: 'https://snowdiablo.xyz',
      background_color: '0A0A1A',
      attributes: [
        { trait_type: 'Season',     value: season },
        { trait_type: 'Rank',       value: rank },
        { trait_type: 'Tier',       value: tier.name },
        { trait_type: 'Multiplier', value: rank === 1 ? '+25%' : rank === 2 ? '+15%' : rank === 3 ? '+10%' : '+5%' },
        { trait_type: 'Game',       value: 'SnakeCoin P2E' },
        { trait_type: 'Chain',      value: 'Polygon' },
      ],
    };

    const outPath = path.join(OUT_DIR, `${tokenId}.json`);
    fs.writeFileSync(outPath, JSON.stringify(meta, null, 2));
    count++;
  }
}

console.log(`✅ Generated ${count} metadata JSON files in ./metadata/`);
console.log(`   Seasons: ${sStart}..${sEnd}`);
console.log(`   Ranks: 1..10`);
console.log(`   Tiers CIDs:`);
for (const [k, v] of Object.entries(CIDS)) console.log(`     ${k.padEnd(8)} → ipfs://${v}`);
console.log(``);
console.log(`Next: upload ./metadata/ folder to Pinata → get base CID → setBaseURI("ipfs://<BASE_CID>/") on contract`);
