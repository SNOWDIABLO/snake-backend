/*
 * renounce-ownership.js — Renounce ownership des contracts pour prouver "no rug"
 *
 * ⚠️ IRRÉVERSIBLE. À exécuter UNIQUEMENT day-of launch,
 * après validation que tous les tiers + royalty sont bien configurés.
 *
 * Par défaut, renounce le contract $SNAKE ERC-20 (process.env.SNAKE_TOKEN_ADDRESS).
 * Pour renounce d'autres contracts (BOOST, TROPHY) : set TARGET_CONTRACT.
 *
 * Usage :
 *   # Renounce le token $SNAKE (standard)
 *   npm run renounce:polygon
 *
 *   # Renounce un autre contract
 *   TARGET_CONTRACT=0x... npm run renounce:polygon
 */

const hre = require("hardhat");
const readline = require("readline");

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a); }));
}

// Minimal ABI : Ownable renounceOwnership + owner read
const OWNABLE_ABI = [
  "function owner() view returns (address)",
  "function renounceOwnership()",
];

async function main() {
  const target = (process.env.TARGET_CONTRACT || process.env.SNAKE_TOKEN_ADDRESS || "").trim();
  if (!target) throw new Error("Env TARGET_CONTRACT ou SNAKE_TOKEN_ADDRESS manquante");

  const [signer] = await hre.ethers.getSigners();
  const c = new hre.ethers.Contract(target, OWNABLE_ABI, signer);

  const currentOwner = await c.owner();
  console.log(`\n🔥 RENOUNCE OWNERSHIP`);
  console.log(`   Contract       : ${target}`);
  console.log(`   Current owner  : ${currentOwner}`);
  console.log(`   Signer         : ${signer.address}`);

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Signer n'est pas l'owner — abort");
  }

  if (currentOwner === "0x0000000000000000000000000000000000000000") {
    console.log("   ⚠️ Déjà renounced (owner = 0x0)");
    return;
  }

  console.log("\n⚠️  IRRÉVERSIBLE. Owner passera à 0x0.");
  console.log("   Plus aucune fonction onlyOwner ne sera appelable.");
  const answer = await ask('   Taper "RENOUNCE" pour confirmer : ');
  if (answer.trim() !== "RENOUNCE") {
    console.log("   Aborted.");
    return;
  }

  const tx = await c.renounceOwnership();
  console.log(`\n   tx : ${tx.hash}`);
  await tx.wait();
  const newOwner = await c.owner();
  console.log(`   ✅ Ownership renounced. New owner : ${newOwner}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
