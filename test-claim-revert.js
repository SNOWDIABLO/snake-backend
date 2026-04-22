/* ==================================================================
   test-claim-revert.js
   Reproduit exactement ce que fait le backend + contract pour
   identifier pourquoi le wallet 0x71A4 revert.

   Usage :
     cd C:\dev\snake-backend   (ou où tu as .env avec SIGNER_PK)
     node test-claim-revert.js
   ================================================================== */

// Parse .env manually (pas besoin de dotenv)
const fs = require('fs');
const path = require('path');
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (m) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[m[1]]) process.env[m[1]] = val;
      }
    });
    console.log('✅ .env chargé depuis', envPath);
  } else {
    console.warn('⚠️  .env introuvable à', envPath);
  }
} catch (e) {
  console.warn('⚠️  Erreur parsing .env:', e.message);
}

const { ethers, JsonRpcProvider, Wallet, AbiCoder, keccak256 } = require('ethers');

const TOKEN   = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1';
const WALLET  = '0x71A4e15f491203632B1bcb7C55BCD98ECE114372'; // wallet qui revert
const SIGNER  = '0xFca2595d1EE2d2d417f6e404330Ca72934054fc9'; // backend signer expected
const RPC     = process.env.RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
const PK      = process.env.SIGNER_PK;

if (!PK) {
  console.error('❌ SIGNER_PK manquant dans .env');
  process.exit(1);
}

const ABI = [
  'function claimReward(uint256 amount, uint256 nonce, bytes signature) external',
  'function signer() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function used(bytes32) view returns (bool)'
];

(async () => {
  console.log('\n============================================================');
  console.log('  Test claim on-chain pour', WALLET);
  console.log('============================================================\n');

  const provider = new JsonRpcProvider(RPC);
  const wallet   = new Wallet(PK, provider);

  console.log('[1] Signer PK loaded. Address =', wallet.address);
  console.log('    Expected signer on-chain =', SIGNER);
  if (wallet.address.toLowerCase() !== SIGNER.toLowerCase()) {
    console.error('\n❌ PROBLÈME: SIGNER_PK ne correspond PAS au signer on-chain !');
    console.error('   Ton .env a été corrompu ou le contract a setSigner() avec une autre key.');
    process.exit(1);
  }
  console.log('    ✅ Match\n');

  // ─── Prepare claim ─────────────────────────────────────────────
  const amount = ethers.parseEther('1');   // 1 SNAKE
  const nonce  = ethers.hexlify(ethers.randomBytes(32));

  console.log('[2] Claim parameters');
  console.log('    wallet =', WALLET);
  console.log('    amount =', amount.toString(), '(= 1 SNAKE)');
  console.log('    nonce  =', nonce);
  console.log('    contract =', TOKEN);

  // ─── Sign exactly like backend ─────────────────────────────────
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'address'],
    [WALLET, amount, nonce, TOKEN]
  );
  const hash = keccak256(encoded);
  const sig  = await wallet.signMessage(ethers.getBytes(hash));

  console.log('\n[3] Signature generated');
  console.log('    encoded hash =', hash);
  console.log('    sig          =', sig);

  // ─── Verify recovery locally ───────────────────────────────────
  const recovered = ethers.verifyMessage(ethers.getBytes(hash), sig);
  console.log('\n[4] Local signature recovery');
  console.log('    recovered =', recovered);
  console.log('    expected  =', SIGNER);
  console.log('    match     =', recovered.toLowerCase() === SIGNER.toLowerCase() ? '✅' : '❌');

  // ─── Check nonce not used on-chain ─────────────────────────────
  const token = new ethers.Contract(TOKEN, ABI, provider);
  try {
    const isUsed = await token.used(nonce);
    console.log('\n[5] used(nonce) on-chain =', isUsed);
  } catch (e) {
    console.log('\n[5] used(bytes32) function n\'existe pas sur le contract');
  }

  // ─── Simulate claimReward via eth_call from 0x71A4 ────────────
  console.log('\n[6] eth_call claimReward(amount, nonce, sig) from 0x71A4...');
  const iface = new ethers.Interface(ABI);
  const calldata = iface.encodeFunctionData('claimReward', [amount, nonce, sig]);
  console.log('    calldata =', calldata.slice(0, 100) + '...');
  console.log('    selector =', calldata.slice(0, 10));

  try {
    const result = await provider.call({
      from: WALLET,
      to:   TOKEN,
      data: calldata
    });
    console.log('\n    ✅ Call SUCCEEDED ! result =', result);
    console.log('    → Le contract ACCEPTE la sig. Le problème est donc COTE FRONTEND.');
    console.log('    → MetaMask probablement vérifie à un chainId ou from wrong.');
  } catch (err) {
    console.log('\n    ❌ Revert:', err.message);
    console.log('    Data (revert return):', err.data || '(empty)');

    if (err.info?.error) {
      console.log('    Inner error:', JSON.stringify(err.info.error, null, 2));
    }
    if (err.error) {
      console.log('    Error field:', JSON.stringify(err.error, null, 2));
    }

    // ─── Try calling WITHOUT the from= to see if it's a msg.sender issue ──
    console.log('\n[7] Retry WITHOUT from (=> msg.sender = 0x0)');
    try {
      await provider.call({ to: TOKEN, data: calldata });
      console.log('    ✅ Succeeded without from → sig recovery issue (msg.sender matters)');
    } catch (e2) {
      console.log('    ❌ Still reverts:', e2.message);
    }

    // ─── Try calling from the signer wallet itself ──
    console.log('\n[8] Retry from SIGNER wallet itself');
    try {
      await provider.call({ from: SIGNER, to: TOKEN, data: calldata });
      console.log('    ✅ Succeeded from signer → donc le sig est valide POUR LE SIGNER mais pas pour 0x71A4');
      console.log('    → CONFIRMÉ : le contract hash inclut msg.sender et ton sig a été faite pour', WALLET);
      console.log('      mais MetaMask envoie la tx depuis un autre compte ?!');
    } catch (e2) {
      console.log('    ❌ Reverts aussi from signer :', e2.message);
    }
  }

  console.log('\n============================================================\n');
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
