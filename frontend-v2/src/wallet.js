/* ===================================================================
   SnowDiablo Arcade — Wallet (ethers@6 + WalletConnect v2)
   Shared wallet state across all pages. Emits 'wallet:change' event.
   =================================================================== */

const POLYGON_CHAIN_ID    = 137;
const POLYGON_CHAIN_HEX   = '0x89';
const POLYGON_RPC         = 'https://polygon-bor-rpc.publicnode.com';
const POLYGON_EXPLORER    = 'https://polygonscan.com';
const WC_PROJECT_ID       = 'e899c82ac8b8d52c4d8bbfb3bc6ef81e';

// Storage keys
const LS_ADDRESS = 'sd_wallet_addr';
const LS_PROVIDER_TYPE = 'sd_wallet_provider'; // 'injected' | 'walletconnect'

// State
let _provider = null;     // raw EIP-1193 provider
let _ethers   = null;     // ethers BrowserProvider
let _signer   = null;
let _address  = null;
let _chainId  = null;

// Event bus
const _listeners = new Set();
export function onWalletChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
function _emit() {
  const payload = { address: _address, chainId: _chainId, connected: !!_address };
  _listeners.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
  window.dispatchEvent(new CustomEvent('wallet:change', { detail: payload }));
}

// Lazy load ethers UMD
async function loadEthers() {
  if (window.ethers) return window.ethers;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js';
    s.onload = () => resolve(window.ethers);
    s.onerror = () => reject(new Error('Failed to load ethers'));
    document.head.appendChild(s);
  });
}

// Lazy load WalletConnect v2
async function loadWalletConnect() {
  if (window.EthereumProvider) return window.EthereumProvider;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@walletconnect/ethereum-provider@2.17.0/dist/index.umd.js';
    s.onload = () => resolve(window.EthereumProvider);
    s.onerror = () => reject(new Error('Failed to load WalletConnect'));
    document.head.appendChild(s);
  });
}

async function _attachProvider(provider, type) {
  _provider = provider;
  const ethers = await loadEthers();
  _ethers  = new ethers.BrowserProvider(provider);
  _signer  = await _ethers.getSigner();
  _address = (await _signer.getAddress()).toLowerCase();

  const network = await _ethers.getNetwork();
  _chainId = Number(network.chainId);

  // Persist
  localStorage.setItem(LS_ADDRESS, _address);
  localStorage.setItem(LS_PROVIDER_TYPE, type);

  // Listen for changes
  provider.on?.('accountsChanged', (accs) => {
    if (!accs || !accs.length) { disconnect(); return; }
    _address = accs[0].toLowerCase();
    localStorage.setItem(LS_ADDRESS, _address);
    _emit();
  });
  provider.on?.('chainChanged', (cid) => {
    _chainId = typeof cid === 'string' ? parseInt(cid, 16) : Number(cid);
    _emit();
  });
  provider.on?.('disconnect', () => disconnect());

  // Force Polygon
  if (_chainId !== POLYGON_CHAIN_ID) await switchToPolygon();

  _emit();
  return _address;
}

export async function switchToPolygon() {
  if (!_provider) throw new Error('No provider');
  try {
    await _provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: POLYGON_CHAIN_HEX }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await _provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: POLYGON_CHAIN_HEX,
          chainName: 'Polygon',
          nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
          rpcUrls: [POLYGON_RPC],
          blockExplorerUrls: [POLYGON_EXPLORER]
        }]
      });
    } else {
      throw err;
    }
  }
}

export async function connectInjected() {
  if (!window.ethereum) throw new Error('No injected wallet found (install MetaMask)');
  const accs = await window.ethereum.request({ method: 'eth_requestAccounts' });
  if (!accs || !accs.length) throw new Error('No account');
  return _attachProvider(window.ethereum, 'injected');
}

export async function connectWalletConnect() {
  const EthereumProvider = await loadWalletConnect();
  const provider = await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    chains: [POLYGON_CHAIN_ID],
    showQrModal: true,
    metadata: {
      name: 'SnowDiablo Arcade',
      description: 'Play arcade games, earn $SNAKE on Polygon',
      url: 'https://snowdiablo.xyz',
      icons: ['https://snowdiablo.xyz/favicon.png']
    }
  });
  await provider.connect();
  return _attachProvider(provider, 'walletconnect');
}

export async function disconnect() {
  try { await _provider?.disconnect?.(); } catch {}
  _provider = _ethers = _signer = _address = _chainId = null;
  localStorage.removeItem(LS_ADDRESS);
  localStorage.removeItem(LS_PROVIDER_TYPE);
  _emit();
}

// Auto-restore on load (silent for injected; WC needs explicit reconnect via modal)
export async function autoRestore() {
  const saved = localStorage.getItem(LS_ADDRESS);
  const type  = localStorage.getItem(LS_PROVIDER_TYPE);
  if (!saved) return null;

  if (type === 'injected' && window.ethereum) {
    try {
      const accs = await window.ethereum.request({ method: 'eth_accounts' });
      if (accs && accs.length && accs[0].toLowerCase() === saved.toLowerCase()) {
        return _attachProvider(window.ethereum, 'injected');
      }
    } catch {}
  }
  // WC silent restore is flaky; we keep address hint for UI but not signed-in state
  return null;
}

// EIP-191 personal_sign helper for /api/proof
export async function signMessage(message) {
  if (!_signer) throw new Error('Not connected');
  return _signer.signMessage(message);
}

// Read-only accessors
export const getAddress  = () => _address;
export const getChainId  = () => _chainId;
export const isConnected = () => !!_address;
export const getSigner   = () => _signer;
export const getProvider = () => _ethers;
export const getRawProvider = () => _provider;

export const constants = {
  POLYGON_CHAIN_ID,
  POLYGON_RPC,
  POLYGON_EXPLORER
};
