/*
 * deploy-boost.js — Deploy SnakeBoostNFT sur Polygon (mainnet ou Amoy testnet)
 *
 * Usage :
 *   npm run deploy:amoy       (dry-run sur Amoy testnet)
 *   npm run deploy:polygon    (prod mainnet)
 *
 * Output :
 *   - Print l'address du contract deployed
 *   - Sauvegarde dans deployments.json
 *   - Auto-verify sur Polygonscan (si POLYGONSCAN_API_KEY set)
 */

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const net = hre.network.name;
  console.log(`\n🚀 Deploying SnakeBoostNFT to ${net}...`);

  // Sanity env
  const CHAINLINK   = process.env.CHAINLINK_MATIC_USD;
  const SNAKE_TOKEN = process.env.SNAKE_TOKEN_ADDRESS;
  const FEE_WALLET  = process.env.FEE_WALLET;

  if (!CHAINLINK || !SNAKE_TOKEN || !FEE_WALLET) {
    throw new Error("Env vars manquantes : CHAINLINK_MATIC_USD, SNAKE_TOKEN_ADDRESS, FEE_WALLET");
  }

  console.log("   Chainlink MATIC/USD :", CHAINLINK);
  console.log("   $SNAKE token        :", SNAKE_TOKEN);
  console.log("   Royalty receiver    :", FEE_WALLET);

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("\n   Deployer            :", deployer.address);
  console.log("   Balance POL         :", hre.ethers.formatEther(balance));

  if (balance < hre.ethers.parseEther("2")) {
    console.warn("   ⚠️  Balance < 2 POL — risque de gas insuffisant");
  }

  // Deploy
  const Factory = await hre.ethers.getContractFactory("SnakeBoostNFT");
  const contract = await Factory.deploy(CHAINLINK, SNAKE_TOKEN, FEE_WALLET);
  const txHash = contract.deploymentTransaction().hash;
  console.log("\n   Deploy tx           :", txHash);

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log("\n✅ SnakeBoostNFT deployed !");
  console.log("   Address             :", address);
  console.log("   Explorer            :", net === "polygon"
    ? `https://polygonscan.com/address/${address}`
    : `https://amoy.polygonscan.com/address/${address}`);

  // Save deployment
  const out = {
    network: net,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    address,
    deployer: deployer.address,
    txHash,
    constructorArgs: [CHAINLINK, SNAKE_TOKEN, FEE_WALLET],
    deployedAt: new Date().toISOString(),
  };
  const file = path.join(__dirname, "..", `deployment.${net}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("   Saved               :", file);

  // Auto-verify
  if (process.env.POLYGONSCAN_API_KEY) {
    console.log("\n⏳ Attente 30s pour propagation Polygonscan avant verify...");
    await new Promise(r => setTimeout(r, 30000));
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments: [CHAINLINK, SNAKE_TOKEN, FEE_WALLET],
      });
      console.log("✅ Contract verified on Polygonscan");
    } catch (e) {
      console.warn("   ⚠️ Verify failed :", e.message);
      console.warn("   Retry manuel :");
      console.warn(`   npx hardhat verify --network ${net} ${address} ${CHAINLINK} ${SNAKE_TOKEN} ${FEE_WALLET}`);
    }
  }

  console.log("\n📋 NEXT STEPS :");
  console.log("   1. Note l'address ci-dessus → BOOST_NFT_ADDRESS_DEPLOYED");
  console.log("   2. (Optionnel) Run configure-tiers.js pour ajuster les 3 tiers");
  console.log("   3. Railway env vars :");
  console.log(`      BOOST_NFT_ADDRESS=${address}`);
  console.log("      BOOST_ENABLED=1");
  console.log("   4. Railway redeploy → check log : '🚀 Contract BOOST'");
  console.log("   5. Smoke test : curl $API/api/boost/catalog\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
