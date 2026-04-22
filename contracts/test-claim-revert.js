/* ==================================================================
   test-claim-revert.js (version pour contracts/ subdir)
   ================================================================== */

// Parse .env depuis le parent (snake-backend/.env)
const fs = require('fs');
const path = require('path');
try {
  const envPath = path.join(__dirname, '..', '.env');
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
const WALLET  = '0x71A4e15f491203632B1bcb7C55BCD98ECE114372';
const SIGNER  = '0xFca2595d1EE2d2d417f6e404330Ca72934054fc9';
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
    process.exit(1);
  }
  console.log('    ✅ Match\n');

  const amount = ethers.parseEther('1');
  const nonce  = ethers.hexlify(ethers.randomBytes(32));

  console.log('[2] Claim parameters');
  console.log('    wallet   =', WALLET);
  console.log('    amount   =', amount.toString(), '(= 1 SNAKE)');
  console.log('    nonce    =', nonce);
  console.log('    contract =', TOKEN);

  const encoded = AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'address'],
    [WALLET, amount, nonce, TOKEN]
  );
  const hash = keccak256(encoded);
  const sig  = await wallet.signMessage(ethers.getBytes(hash));

  console.log('\n[3] Signature generated');
  console.log('    hash =', hash);
  console.log('    sig  =', sig);

  const recovered = ethers.verifyMessage(ethers.getBytes(hash), sig);
  console.log('\n[4] Local signature recovery');
  console.log('    recovered =', recovered);
  console.log('    expected  =', SIGNER);
  console.log('    match     =', recovered.toLowerCase() === SIGNER.toLowerCase() ? '✅' : '❌');

  const token = new ethers.Contract(TOKEN, ABI, provider);
  try {
    const isUsed = await token.used(nonce);
    console.log('\n[5] used(nonce) on-chain =', isUsed);
  } catch (e) {
    console.log('\n[5] used(bytes32) function absente ou revert');
  }

  console.log('\n[6] eth_call claimReward(...) from', WALLET);
  const iface = new ethers.Interface(ABI);
  const calldata = iface.encodeFunctionData('claimReward', [amount, nonce, sig]);
  console.log('    selector =', calldata.slice(0, 10));
  console.log('    calldata length =', (calldata.length - 2) / 2, 'bytes');

  let revertedFromWallet = false;
  try {
    const result = await provider.call({ from: WALLET, to: TOKEN, data: calldata });
    console.log('\n    ✅ Call SUCCEEDED ! result =', result);
    console.log('    → Le contract ACCEPTE la sig.');
    console.log('    → Le problème est donc COTE FRONTEND/MetaMask.');
  } catch (err) {
    revertedFromWallet = true;
    console.log('\n    ❌ Revert:', err.shortMessage || err.message);
    console.log('    Data:', err.data || '(empty)');
    if (err.info?.error) console.log('    Inner:', JSON.stringify(err.info.error));
  }

  if (revertedFromWallet) {
    console.log('\n[7] Retry WITHOUT from (msg.sender = 0x0)');
    try {
      await provider.call({ to: TOKEN, data: calldata });
      console.log('    ✅ Succeeded → bug de recovery/msg.sender');
    } catch (e2) {
      console.log('    ❌ Reverts:', e2.shortMessage || e2.message);
    }

    console.log('\n[8] Retry from SIGNER wallet (' + SIGNER + ')');
    try {
      await provider.call({ from: SIGNER, to: TOKEN, data: calldata });
      console.log('    ✅ Succeeded from SIGNER → contract hash inclut msg.sender');
      console.log('    → mais tu signes pour WALLET et tx est from SIGNER = mismatch');
    } catch (e2) {
      console.log('    ❌ Reverts:', e2.shortMessage || e2.message);
    }

    // Try signing with a different hash layout (without CONTRACT_ADDRESS)
    console.log('\n[9] Retry avec hash layout ALT 1: (wallet, amount, nonce) seul');
    const encoded2 = AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes32'],
      [WALLET, amount, nonce]
    );
    const hash2 = keccak256(encoded2);
    const sig2  = await wallet.signMessage(ethers.getBytes(hash2));
    const calldata2 = iface.encodeFunctionData('claimReward', [amount, nonce, sig2]);
    try {
      await provider.call({ from: WALLET, to: TOKEN, data: calldata2 });
      console.log('    ✅ Succeeded → contract signe sans CONTRACT_ADDRESS !');
      console.log('    → FIX: retirer CONTRACT_ADDRESS du abi.encode backend');
    } catch (e2) {
      console.log('    ❌ Reverts aussi');
    }

    console.log('\n[10] Retry avec hash layout ALT 2: (wallet, amount, nonce) + packed');
    const hash3 = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'uint256'],
      [WALLET, amount, nonce]
    );
    const sig3  = await wallet.signMessage(ethers.getBytes(hash3));
    const calldata3 = iface.encodeFunctionData('claimReward', [amount, nonce, sig3]);
    try {
      await provider.call({ from: WALLET, to: TOKEN, data: calldata3 });
      console.log('    ✅ Succeeded → contract utilise abi.encodePacked !');
      console.log('    → FIX: remettre solidityPackedKeccak256 côté backend');
    } catch (e2) {
      console.log('    ❌ Reverts aussi');
    }

    console.log('\n[11] Retry avec hash ALT 3: (amount, nonce) seul + packed');
    const hash4 = ethers.solidityPackedKeccak256(
      ['uint256', 'uint256'],
      [amount, nonce]
    );
    const sig4  = await wallet.signMessage(ethers.getBytes(hash4));
    const calldata4 = iface.encodeFunctionData('claimReward', [amount, nonce, sig4]);
    try {
      await provider.call({ from: WALLET, to: TOKEN, data: calldata4 });
      console.log('    ✅ Succeeded → contract hash seulement (amount, nonce) !');
    } catch (e2) {
      console.log('    ❌ Reverts aussi');
    }

    console.log('\n[12] Retry avec hash ALT 4: raw sig sans eth prefix');
    const sig5 = await wallet.signingKey.sign(hash).serialized;
    const calldata5 = iface.encodeFunctionData('claimReward', [amount, nonce, sig5]);
    try {
      await provider.call({ from: WALLET, to: TOKEN, data: calldata5 });
      console.log('    ✅ Succeeded → contract utilise raw ECDSA (pas toEthSignedMessageHash) !');
    } catch (e2) {
      console.log('    ❌ Reverts aussi');
    }

    console.log('\n[13] Retry avec hash ALT 5: chainId inclus');
    const encoded6 = AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256', 'bytes32', 'address', 'uint256'],
      [WALLET, amount, nonce, TOKEN, 137n]
    );
    const hash6 = keccak256(encoded6);
    const sig6  = await wallet.signMessage(ethers.getBytes(hash6));
    const calldata6 = iface.encodeFunctionData('claimReward', [amount, nonce, sig6]);
    try {
      await provider.call({ from: WALLET, to: TOKEN, data: calldata6 });
      console.log('    ✅ Succeeded → contract inclut chainId !');
    } catch (e2) {
      console.log('    ❌ Reverts aussi');
    }
  }

  console.log('\n============================================================\n');
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
