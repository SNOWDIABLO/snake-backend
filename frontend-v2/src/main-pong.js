/* ===================================================================
   SnowDiablo Arcade — Pong page entry
   Wires PongGame <-> backend (session/end/claim) <-> wallet.
   Passes game='pong' to /api/session/start for multi-games Phase 4 backend.
   =================================================================== */

import './theme.css';
import './pong-style.css';
import { initI18n, t, applyTranslations } from './i18n.js';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { PongGame } from './pong-game.js';
import { api, BACKEND_URL } from './api.js';
import {
  isConnected, getAddress, getSigner, onWalletChange, autoRestore, signMessage
} from './wallet.js';
import { CONTRACT_ADDRESS, SNAKE_ABI } from './contracts.js';
import { initTournament } from './tournament.js';
import { initClans } from './clans.js';
import { initBoost } from './boost.js';
import { initQuests } from './quests.js';
import { initPlayerStatus } from './player-status.js';

const GAME_ID = 'pong';

// DOM refs
const canvas   = document.getElementById('game');
const scoreEl  = document.getElementById('score');
const tokensEl = document.getElementById('tokens');
const bestEl   = document.getElementById('best');
const statusEl = document.getElementById('status');
const newGameBtn = document.getElementById('new-game');
const claimBtn   = document.getElementById('claim');
const backendEl  = document.getElementById('backend-status');

let sessionId    = null;
let tokensEarned = 0;
let game         = null;

// ===================================================================
//  Bootstrap
// ===================================================================
(async () => {
  await initI18n('common');
  applyTranslations(document.body);

  initHeader('hdr');
  initFooter('ftr');
  initPlayerStatus(document.getElementById('player-mount'), { game: GAME_ID });
  initQuests(document.getElementById('quests-mount'));
  initTournament(document.getElementById('tournament-mount'));
  initClans(document.getElementById('clans-mount'));
  initBoost(document.getElementById('boost-mount'));

  game = new PongGame(canvas, {
    onScore: (s) => { scoreEl.textContent = s; },
    onTokensPreview: (tk) => { tokensEl.textContent = tk.toFixed(2); tokensEarned = tk; },
    onGameOver: async ({ score, tokens }) => {
      tokensEarned = tokens;
      tokensEl.textContent = tokens.toFixed(2);

      let milestone = null;

      if (sessionId && isConnected()) {
        try {
          const r = await api.sessionEnd({
            sessionId, score, address: getAddress()
          });
          // Toujours syncer UI avec reward backend (inclut boost/streak/NFT + caps).
          if (typeof r?.reward === 'number') {
            tokensEarned = r.reward;
            tokensEl.textContent = tokensEarned.toFixed(2);
          }
          const parts = [];
          if (r?.streak?.milestone) parts.push(`STREAK ${r.streak.milestone}d x${r.streak.multiplier}`);
          if (r?.nft?.bonus_pct > 0) parts.push(`NFT +${r.nft.bonus_pct}%`);
          if (r?.boost?.bps > 0) parts.push(`BOOST +${(r.boost.bps/100).toFixed(0)}%`);
          if (parts.length) milestone = parts.join(' - ');
        } catch (e) {
          console.warn('session/end', e);
        }
      }

      if (tokensEarned > 0) {
        claimBtn.disabled = false;
        const label = t('controls.claim_label', { amount: tokensEarned.toFixed(2) });
        setStatus(milestone ? `${milestone} - ${label}` : label);
      } else {
        setStatus(milestone || t('controls.game_over'));
      }
    }
  });

  bestEl.textContent = game.highScore;
  claimBtn.textContent   = t('controls.claim');
  newGameBtn.textContent = t('controls.new_game');

  updateForWallet();
  autoRestore().finally(updateForWallet);
  pingBackend();
  setInterval(pingBackend, 60000);
})();

// ===================================================================
//  Start / Claim
// ===================================================================
async function startGame() {
  sessionId = null;
  claimBtn.disabled = true;
  if (isConnected()) {
    try {
      // Phase 4 : multi-games — on passe explicitement game='pong'
      const r = await api.sessionStart({ address: getAddress(), game: GAME_ID });
      sessionId = r?.sessionId || null;
    } catch (e) {
      console.warn('session/start', e);
    }
  }
  game.start();
  setStatus('');
}

async function getWalletProof(action = 'Claim') {
  const addr = getAddress();
  const r = await fetch(`${BACKEND_URL}/api/proof/challenge?address=${addr}&action=${action}`);
  const ch = await r.json();
  if (!r.ok) throw new Error(ch.error || 'challenge unavailable');
  const signature = await signMessage(ch.message);
  return { ts: ch.ts, nonce: ch.nonce, signature };
}

async function claim() {
  if (!isConnected())   { setStatus(t('common.connect_first')); return; }
  if (tokensEarned <= 0) { setStatus(t('controls.min_pts')); return; }
  if (!sessionId)        { setStatus(t('controls.start_first')); return; }

  claimBtn.disabled = true;
  setStatus(t('controls.sig_request'));

  try {
    let proof = null;
    try { proof = await getWalletProof('Claim'); } catch (_) {}

    const data = await api.claim({ address: getAddress(), sessionId, proof });
    setStatus(t('controls.tx_polygon'));

    const signer = getSigner();
    const contract = new window.ethers.Contract(CONTRACT_ADDRESS, SNAKE_ABI, signer);
    const tx = await contract.claimReward(data.amount, data.nonce, data.sig);
    setStatus(t('controls.tx_confirm'));
    await tx.wait();

    setStatus(t('controls.claimed', { amount: tokensEarned.toFixed(2) }));
    tokensEarned = 0;
    sessionId = null;
    tokensEl.textContent = '0.00';
  } catch (e) {
    console.error('claim', e);
    setStatus(t('common.error') + ': ' + (e.reason || e.message || 'claim failed'));
    claimBtn.disabled = false;
  }
}

function setStatus(msg) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('empty', !msg);
}

// ===================================================================
//  Input — keyboard
// ===================================================================
newGameBtn.addEventListener('click', startGame);
claimBtn.addEventListener('click', claim);

document.addEventListener('keydown', (e) => {
  if (!game) return;
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': e.preventDefault(); game.setKey('up', true); break;
    case 'ArrowDown': case 's': case 'S': e.preventDefault(); game.setKey('down', true); break;
    case ' ': e.preventDefault(); if (!game.running && !newGameBtn.disabled) startGame(); break;
  }
});
document.addEventListener('keyup', (e) => {
  if (!game) return;
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': game.setKey('up', false); break;
    case 'ArrowDown': case 's': case 'S': game.setKey('down', false); break;
  }
});

// ===================================================================
//  Touch/mouse drag to control paddle
// ===================================================================
(function touchControls() {
  const rectY = (clientY) => {
    const r = canvas.getBoundingClientRect();
    const scale = canvas.height / r.height;
    return (clientY - r.top) * scale;
  };

  canvas.addEventListener('touchstart', (e) => {
    if (!game) return;
    if (e.touches.length !== 1) return;
    game.setTouchY(rectY(e.touches[0].clientY));
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!game) return;
    if (e.touches.length !== 1) return;
    game.setTouchY(rectY(e.touches[0].clientY));
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchend', () => { if (game) game.clearTouch(); }, { passive: true });
  canvas.addEventListener('touchcancel', () => { if (game) game.clearTouch(); }, { passive: true });

  // Mouse drag support (desktop optional)
  let mouseDown = false;
  canvas.addEventListener('mousedown', (e) => { mouseDown = true; if (game) game.setTouchY(rectY(e.clientY)); });
  canvas.addEventListener('mousemove', (e) => { if (mouseDown && game) game.setTouchY(rectY(e.clientY)); });
  canvas.addEventListener('mouseup',   () => { mouseDown = false; if (game) game.clearTouch(); });
  canvas.addEventListener('mouseleave',() => { mouseDown = false; if (game) game.clearTouch(); });
})();

// ===================================================================
//  Wallet state
// ===================================================================
function updateForWallet() {
  if (isConnected()) {
    newGameBtn.disabled = false;
    if (game && !game.running) setStatus(t('controls.ready'));
  } else {
    newGameBtn.disabled = true;
    claimBtn.disabled = true;
    setStatus(t('controls.connect_play'));
  }
}
onWalletChange(updateForWallet);

// ===================================================================
//  Backend health indicator
// ===================================================================
async function pingBackend() {
  try {
    const h = await api.health();
    if (h?.status === 'ok') {
      backendEl.textContent = t('backend.online');
      backendEl.className = 'ok';
    } else {
      backendEl.textContent = t('backend.degraded');
      backendEl.className = 'warn';
    }
  } catch {
    backendEl.textContent = t('backend.offline');
    backendEl.className = 'err';
  }
}
