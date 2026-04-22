/*
 * verify-boost.js — Re-vérifie manuellement sur Polygonscan si auto-verify a échoué
 *
 * Usage :
 *   BOOST_NFT_ADDRESS=0x... npm run verify:polygon
 */

const hre = require("hardhat");

async function main() {
  const ADDR = process.env.BOOST_NFT_ADDRESS;
  if (!ADDR) throw new Error("Env BOOST_NFT_ADDRESS manquante");

  const args = [
    process.env.CHAINLINK_MATIC_USD,
    process.env.SNAKE_TOKEN_ADDRESS,
    process.env.FEE_WALLET,
  ];

  console.log(`\n🔍 Verifying ${ADDR} on Polygonscan...`);
  console.log("   Constructor args :", args);

  await hre.run("verify:verify", {
    address: ADDR,
    constructorArguments: args,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
