/* ==================================================================
   inspect-mint-history.js — v2 (chunks 1000 blocks + multi-RPC)
   Scrappe les mint events du token $SNAKE et identifie le selector
   de chaque tx qui a réussi. Réponse directe : quelle fonction mint.
   ================================================================== */

const fs = require('fs');
const path = require('path');
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (m) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = val;
      }
    });
  }
} catch {}

const { ethers } = require('ethers');

const TOKEN = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1';
const RPCS  = [
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon-rpc.com',
  'https://rpc.ankr.com/polygon',
  'https://polygon.llamarpc.com',
];

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const FROM_ZERO      = '0x' + '0'.repeat(64);

const KNOWN_SELECTORS = {
  '0x76618f27': 'claimReward(uint256,uint256,bytes)',
  '0x40c10f19': 'mint(address,uint256)',
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0x449a52f8': 'mintTo(address,uint256)',
  '0x6a627842': 'mint(address)',
  '0x1249c58b': 'mint()',
  '0x94bf804d': 'mint(uint256,address)',
  '0xb3af1f81': 'distribute(address,uint256)',
  '0xd505accf': 'permit(...)',
};

async function rpc(rpcUrl, method, params, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctl.signal,
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function rpcMulti(method, params) {
  let lastErr;
  for (const url of RPCS) {
    try {
      return await rpc(url, method, params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function toHex(n) { return '0x' + BigInt(n).toString(16); }

(async () => {
  console.log('\n=================================================================');
  console.log('  Inspect mint history —', TOKEN);
  console.log('=================================================================\n');

  const latestHex = await rpcMulti('eth_blockNumber', []);
  const latest = parseInt(latestHex, 16);
  console.log('latest block =', latest);

  // Scan les 50k derniers blocks (~30h sur Polygon)
  const SCAN_BLOCKS = 50000;
  const FROM_BLOCK = latest - SCAN_BLOCKS;
  const CHUNK = 1000;

  console.log(`scanning from ${FROM_BLOCK} to ${latest} (${SCAN_BLOCKS} blocks, ~30h)`);
  console.log(`chunk size = ${CHUNK} blocks, ${Math.ceil(SCAN_BLOCKS / CHUNK)} requests\n`);

  const mintLogs = [];
  let rpcIdx = 0;

  for (let start = FROM_BLOCK; start <= latest; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, latest);
    process.stdout.write(`  ${start}→${end}  `);

    let logs = null;
    for (let attempt = 0; attempt < RPCS.length; attempt++) {
      const url = RPCS[(rpcIdx + attempt) % RPCS.length];
      try {
        logs = await rpc(url, 'eth_getLogs', [{
          address: TOKEN,
          topics: [TRANSFER_TOPIC, FROM_ZERO],
          fromBlock: toHex(start),
          toBlock: toHex(end),
        }], 12000);
        rpcIdx = (rpcIdx + attempt) % RPCS.length; // garde celui qui marche
        break;
      } catch (e) {
        if (attempt === RPCS.length - 1) {
          console.log(`SKIP (${e.message.slice(0, 50)})`);
        }
      }
    }
    if (logs === null) continue;

    console.log(`${logs.length} mints`);
    mintLogs.push(...logs);
  }

  if (!mintLogs.length) {
    console.log('\n❌ AUCUN mint dans les 30 dernières heures.');
    console.log('   → Le contract n\'a PAS émis de $SNAKE récemment.');
    console.log('   → Soit backend ne mint jamais vraiment on-chain,');
    console.log('     soit tous les mints sont trop anciens (étends SCAN_BLOCKS).\n');
    return;
  }

  console.log(`\n✅ ${mintLogs.length} mints trouvés. Analyse des tx...\n`);

  const seenTx = new Set();
  const selectorCount = {};
  const samples = [];
  const allTxs = [];

  for (const log of mintLogs) {
    if (seenTx.has(log.transactionHash)) continue;
    seenTx.add(log.transactionHash);
    try {
      const tx = await rpcMulti('eth_getTransactionByHash', [log.transactionHash]);
      const selector = tx.input.slice(0, 10);
      const name = KNOWN_SELECTORS[selector] || '(unknown)';
      selectorCount[selector] = (selectorCount[selector] || 0) + 1;
      const recipient = '0x' + log.topics[2].slice(26);
      const amount = ethers.formatEther(ethers.toBigInt(log.data));
      allTxs.push({ hash: log.transactionHash, from: tx.from, recipient, amount, selector, name });
      if (samples.length < 5) {
        samples.push({
          hash: log.transactionHash, from: tx.from, recipient, amount, selector, name,
          block: parseInt(log.blockNumber, 16),
        });
      }
    } catch (e) {
      // skip
    }
  }

  console.log('── Résumé par selector ──');
  for (const [sel, count] of Object.entries(selectorCount).sort((a,b) => b[1]-a[1])) {
    const name = KNOWN_SELECTORS[sel] || '(unknown)';
    console.log(`  ${sel}  ×${count}  →  ${name}`);
  }

  console.log('\n── Samples ──');
  for (const s of samples) {
    console.log(`\n  tx:        ${s.hash}`);
    console.log(`  block:     ${s.block}`);
    console.log(`  from:      ${s.from}`);
    console.log(`  recipient: ${s.recipient}`);
    console.log(`  amount:    ${s.amount} $SNAKE`);
    console.log(`  selector:  ${s.selector}  →  ${s.name}`);
  }

  // Check specific : y a-t-il eu un mint vers 0x71A4... ?
  const WALLET = '0x71a4e15f491203632b1bcb7c55bcd98ece114372';
  const forWallet = allTxs.filter(t => t.recipient.toLowerCase() === WALLET);
  console.log(`\n── Mints vers 0x71A4... (ton wallet) : ${forWallet.length} ──`);
  for (const t of forWallet) {
    console.log(`  ${t.hash}  from=${t.from}  amount=${t.amount}  via ${t.name}`);
  }

  // Verdict
  console.log('\n=================================================================');
  console.log('  VERDICT');
  console.log('=================================================================');
  const selectors = Object.keys(selectorCount);
  if (selectors.length === 1 && selectors[0] === '0x76618f27') {
    console.log('  ✅ claimReward() MARCHE sur ce contract.');
    console.log('  → Le bug est spécifique à ton wallet 0x71A4 ou au contexte');
    console.log('    de la tx MetaMask (chainId, pending tx, nonce tx).');
  } else if (selectors.includes('0x76618f27')) {
    console.log('  ⚠️  Mints via claimReward() + autre fonction.');
    console.log('     Selectors :', selectors.map(s => KNOWN_SELECTORS[s] || s).join(' / '));
  } else {
    console.log('  ❌ claimReward() PAS UTILISÉ pour les mints en prod.');
    console.log('     Fonction réellement utilisée :',
      selectors.map(s => KNOWN_SELECTORS[s] || s).join(' / '));
    console.log('  → FIX : backend doit appeler CETTE fonction, pas signer');
    console.log('    pour une claimReward() qui revert toujours.');
  }
  console.log();
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
