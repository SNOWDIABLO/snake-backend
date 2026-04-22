/*
 * price-calc.js — Simulate DEX initial pricing BEFORE creating LP
 *
 * Usage (stand-alone node, pas besoin de hardhat) :
 *   node scripts/price-calc.js
 */

const SNAKE_TOTAL_SUPPLY = 100_000_000n * 10n ** 18n;   // 100M ajuster si différent
const SNAKE_IN_LP        = 10_000_000n  * 10n ** 18n;   // 10% en LP
const POL_IN_LP          = 20_000n      * 10n ** 18n;   // 20k POL
const POL_USD            = 0.50;                         // prix POL courant

// Ratio $SNAKE / POL
const snakePerPolRaw = Number(SNAKE_IN_LP) / Number(POL_IN_LP);
const polPerSnake    = 1 / snakePerPolRaw;
const snakeUsd       = POL_USD * polPerSnake;

console.log("\n═══════════════════════════════════════════");
console.log("  $SNAKE DEX INITIAL PRICING SIMULATION");
console.log("═══════════════════════════════════════════\n");
console.log(`  $SNAKE en LP          : ${(Number(SNAKE_IN_LP) / 1e18).toLocaleString()}  (${(Number(SNAKE_IN_LP * 100n / SNAKE_TOTAL_SUPPLY))}% du supply)`);
console.log(`  POL en LP             : ${(Number(POL_IN_LP) / 1e18).toLocaleString()} POL`);
console.log(`  POL price hypo        : $${POL_USD}`);
console.log(`  TVL initial           : $${(Number(POL_IN_LP) / 1e18 * POL_USD * 2).toLocaleString()}`);
console.log("");
console.log(`  Prix 1 $SNAKE         : ${polPerSnake.toFixed(8)} POL`);
console.log(`  Prix 1 $SNAKE         : $${snakeUsd.toFixed(8)}`);
console.log("");
console.log(`  FDV (100M supply)     : $${(snakeUsd * Number(SNAKE_TOTAL_SUPPLY / 10n ** 18n)).toLocaleString()}`);
console.log(`  MC circulating        : dépend du supply en circulation hors LP`);
console.log("");
console.log("  QuickSwap v3 params   :");
console.log(`    Fee tier            : 1% (recommandé nouveau token)`);
console.log(`    Range               : full range (pour lock UNCX)`);
console.log(`    Initial price ratio : 1 POL = ${snakePerPolRaw.toFixed(2)} $SNAKE`);
console.log("\n═══════════════════════════════════════════\n");
