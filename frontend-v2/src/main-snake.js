/* ===================================================================
   SnowDiablo Arcade — Snake page entry
   Wires canvas game <-> backend (session/end/claim) <-> wallet.
   =================================================================== */

import './theme.css';
import './snake-style.css';
import { initI18n, t, applyTranslations } from './i18n.js';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { SnakeGame } from './snake-game.js';
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

// DOM refs
const canvas   = document.getElementById('game');
const scoreEl  = document.getElementById('score');
const tokensEl = document.getElementById('tokens');
const bestEl   = document.getElementById('best');
const statusEl = document.getElementById('status');
const newGameBtn = document.getElementById('new-game');
const claimBtn   = document.getElementById('claim');
const backendEl  = document.getElementById('backend-status');

let sessionId = null;
let tokensEarned = 0;

// ===================================================================
//  Bootstrap (async i18n first)
// ===================================================================

(async () => {
  await initI18n('common');
  applyTranslations(document.body);

  initHeader('hdr');
  initFooter('ftr');
  initPlayerStatus(document.getElementById('player-mount'));
  initQuests(document.getElementById('quests-mount'));
  initTournament(document.getElementById('tournament-mount'));
  initClans(document.getElementById('clans-mount'));
  initBoost(document.getElementById('boost-mount'));

  bestEl.textContent = game.highScore;

  // Initial claim button label
  claimBtn.textContent = t('controls.claim');
  newGameBtn.textContent = t('controls.new_game');

  updateForWallet();
  autoRestore().finally(updateForWallet);
  pingBackend();
  setInterval(pingBackend, 60000);
})();

// ===================================================================
//  Game
// ===================================================================

const game = new SnakeGame(canvas, {
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
        if (typeof r?.reward === 'number' && r.reward > tokensEarned) {
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

// ===================================================================
//  Start / Claim
// ===================================================================

async function startGame() {
  sessionId = null;
  claimBtn.disabled = true;
  if (isConnected()) {
    try {
      const r = await api.sessionStart({ address: getAddress() });
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
//  Input
// ===================================================================

newGameBtn.addEventListener('click', startGame);
claimBtn.addEventListener('click', claim);

document.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp': case 'w': case 'W': e.preventDefault(); game.setDir(0, -1); break;
    case 'ArrowDown': case 's': case 'S': e.preventDefault(); game.setDir(0, 1); break;
    case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); game.setDir(-1, 0); break;
    case 'ArrowRight': case 'd': case 'D': e.preventDefault(); game.setDir(1, 0); break;
    case ' ': e.preventDefault(); if (!game.running) startGame(); break;
  }
});

// Touch / swipe
(function touchControls() {
  let sx = 0, sy = 0, st = 0;
  const MIN = 18, MAX_T = 600;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (Date.now() - st > MAX_T) return;
    const to = e.changedTouches[0];
    const dx = to.clientX - sx, dy = to.clientY - sy;
    const absX = Math.abs(dx), absY = Math.abs(dy);

    if (absX < MIN && absY < MIN) {
      if (!game.running && isConnected()) startGame();
      return;
    }
    if (absX > absY) game.setDir(dx > 0 ? 1 : -1, 0);
    else game.setDir(0, dy > 0 ? 1 : -1);
    e.preventDefault();
  }, { passive: false });
})();

// On-screen arrow buttons
document.querySelectorAll('[data-arrow]').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = btn.dataset.arrow;
    if (a === 'up')    game.setDir(0, -1);
    if (a === 'down')  game.setDir(0, 1);
    if (a === 'left')  game.setDir(-1, 0);
    if (a === 'right') game.setDir(1, 0);
  });
});

// ===================================================================
//  Wallet state
// ===================================================================

function updateForWallet() {
  if (isConnected()) {
    newGameBtn.disabled = false;
    if (!game.running) setStatus(t('controls.ready'));
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
