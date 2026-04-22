/* ===================================================================
   SnowDiablo Arcade — LP Fund tracker entry
   Reads POL + $SNAKE balances of the public LP Fund wallet via RPC.
   =================================================================== */

import './theme.css';
import './lpfund-style.css';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';

initHeader('hdr');
initFooter('ftr');

const LP_WALLET   = '0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E';
const SNAKE_ADDR  = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1';
const RPC         = 'https://polygon-bor-rpc.publicnode.com';

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function hexToBigInt(h) {
  if (!h || h === '0x') return 0n;
  return BigInt(h);
}
function fmtUnits(wei, decimals = 18) {
  const v = hexToBigInt(wei);
  const divisor = 10n ** BigInt(decimals);
  const whole = v / divisor;
  const frac  = (v % divisor).toString().padStart(decimals, '0').slice(0, 4);
  return `${whole.toLocaleString('en-US')}.${frac}`;
}

// ERC20 balanceOf(address) — function selector 0x70a08231
function encodeBalanceOf(addr) {
  return '0x70a08231' + addr.toLowerCase().replace('0x', '').padStart(64, '0');
}

async function load() {
  const polEl   = document.getElementById('lp-pol');
  const snakeEl = document.getElementById('lp-snake');
  const txnEl   = document.getElementById('lp-txn');
  const upd     = document.getElementById('lp-updated');

  try {
    const [polHex, snakeHex] = await Promise.all([
      rpc('eth_getBalance', [LP_WALLET, 'latest']),
      rpc('eth_call', [{ to: SNAKE_ADDR, data: encodeBalanceOf(LP_WALLET) }, 'latest'])
    ]);

    polEl.textContent   = fmtUnits(polHex);
    snakeEl.textContent = fmtUnits(snakeHex);
    upd.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    polEl.textContent = 'error';
    snakeEl.textContent = 'error';
    console.error(err);
  }
}

load();
setInterval(load, 60000);
