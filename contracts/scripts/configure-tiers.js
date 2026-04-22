/*
 * configure-tiers.js — Ajuste les 3 tiers Basic/Pro/Elite du SnakeBoostNFT
 *
 * Les valeurs par défaut du constructor sont déjà prod-ready :
 *   Basic : $3   / 500 $SNAKE burn / supply 10000 / +2%
 *   Pro   : $10  / 2000 $SNAKE    / supply 2000  / +4%
 *   Elite : $25  / 5000 $SNAKE    / supply 500   / +8%
 *
 * Ce script permet de RESET ces valeurs si besoin.
 * À n'utiliser que si on veut changer les tiers.
 *
 * Usage :
 *   BOOST_NFT_ADDRESS=0x... npm run configure:polygon
 */

const hre = require("hardhat");

// Ajuste ici si tu veux d'autres valeurs :
const TIERS = [
  // [tier, priceUsdCents (1e8), snakeBurnAmount (tokens), multBps, supplyCap, active]
  { id: 1, name: "Basic", priceUsd: "3",   snakeBurn: "500",  multBps: 200, cap: 10000, active: true },
  { id: 2, name: "Pro",   priceUsd: "10",  snakeBurn: "2000", multBps: 400, cap: 2000,  active: true },
  { id: 3, name: "Elite", priceUsd: "25",  snakeBurn: "5000", multBps: 800, cap: 500,   active: true },
];

async function main() {
  const ADDR = process.env.BOOST_NFT_ADDRESS;
  if (!ADDR) throw new Error("Env BOOST_NFT_ADDRESS manquante");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n⚙️  Configuring tiers on ${ADDR}`);
  console.log(`   Caller : ${deployer.address}\n`);

  const boost = await hre.ethers.getContractAt("SnakeBoostNFT", ADDR);

  for (const t of TIERS) {
    const priceUsdScaled = hre.ethers.parseUnits(t.priceUsd, 8);           // Chainlink 1e8
    const snakeWei       = hre.ethers.parseUnits(t.snakeBurn, 18);         // ERC-20 1e18
    console.log(`   Setting ${t.name}: $${t.priceUsd} / ${t.snakeBurn} $SNAKE / +${t.multBps/100}% / cap ${t.cap}`);
    const tx = await boost.setTierConfig(t.id, priceUsdScaled, snakeWei, t.multBps, t.cap, t.active);
    console.log(`      tx : ${tx.hash}`);
    await tx.wait();
    console.log(`      ✅ confirmed\n`);
  }

  console.log("✅ All tiers configured");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
