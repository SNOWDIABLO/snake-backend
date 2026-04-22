/* ===================================================================
   SnowDiablo Arcade — Minesweeper page entry
   Passes game='minesweeper' to /api/session/start for multi-games backend.
   =================================================================== */

import './theme.css';
import './minesweeper-style.css';
import { initI18n, t, applyTranslations } from './i18n.js';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { MinesweeperGame } from './minesweeper-game.js';
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

const GAME_ID = 'minesweeper';

const canvas   = document.getElementById('game');
const scoreEl  = document.getElementById('score');
const tokensEl = document.getElementById('tokens');
const bestEl   = document.getElementById('best');
const statusEl = document.getElementById('status');
const newGameBtn = document.getElementById('new-game');
const claimBtn   = document.getElementById('claim');
const backendEl  = document.getElementById('backend-status');
const flagToggleBtn = document.getElementById('flag-toggle');

let sessionId    = null;
let tokensEarned = 0;
let game         = null;
let flagMode     = false;

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

  game = new MinesweeperGame(canvas, {
    onScore: (s) => { scoreEl.textContent = s; },
    onTokensPreview: (tk) => { tokensEl.textContent = tk.toFixed(2); tokensEarned = tk; },
    onGameOver: async ({ score, tokens, win }) => {
      tokensEarned = tokens;
      tokensEl.textContent = tokens.toFixed(2);
      bestEl.textContent = game.highScore;

      let milestone = win ? 'CLEARED BOARD +5' : null;

      if (sessionId && isConnected()) {
        try {
          const r = await api.sessionEnd({ sessionId, score, address: getAddress() });
          if (typeof r?.reward === 'number' && r.reward > tokensEarned) {
            tokensEarned = r.reward;
            tokensEl.textContent = tokensEarned.toFixed(2);
          }
          const parts = [];
          if (milestone) parts.push(milestone);
          if (r?.streak?.milestone) parts.push(`STREAK ${r.streak.milestone}d x${r.streak.multiplier}`);
          if (r?.nft?.bonus_pct > 0) parts.push(`NFT +${r.nft.bonus_pct}%`);
          if (r?.boost?.bps > 0) parts.push(`BOOST +${(r.boost.bps/100).toFixed(0)}%`);
          if (parts.length) milestone = parts.join(' - ');
        } catch (e) { console.warn('session/end', e); }
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

async function startGame() {
  sessionId = null;
  claimBtn.disabled = true;
  if (isConnected()) {
    try {
      const r = await api.sessionStart({ address: getAddress(), game: GAME_ID });
      sessionId = r?.sessionId || null;
    } catch (e) { console.warn('session/start', e); }
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
    setStatus(t('controls.tx_confirm') + ` (tx ${tx.hash.slice(0, 10)}...)`);
    await tx.wait();

    // Feedback explicite : montant + lien Polygonscan cliquable pour valider visuellement
    const claimedLabel = t('controls.claimed', { amount: tokensEarned.toFixed(2) });
    statusEl.innerHTML =
      `<strong>${claimedLabel}</strong> ` +
      `<a href="https://polygonscan.com/tx/${tx.hash}" target="_blank" rel="noopener" ` +
      `style="color:var(--neon-green);text-decoration:underline;">voir tx</a>`;
    statusEl.classList.remove('empty');
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

newGameBtn.addEventListener('click', startGame);
claimBtn.addEventListener('click', claim);

if (flagToggleBtn) {
  flagToggleBtn.addEventListener('click', () => {
    flagMode = !flagMode;
    flagToggleBtn.classList.toggle('btn-primary', flagMode);
    flagToggleBtn.textContent = flagMode ? t('minesweeper.flag_on') : t('minesweeper.flag_off');
  });
}

// ===== Input =====
function canvasToGridCoords(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return game.cellFromCanvasCoords((clientX - r.left) * sx, (clientY - r.top) * sy);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('mousedown', (e) => {
  if (!game) return;
  const cell = canvasToGridCoords(e.clientX, e.clientY);
  if (!cell) return;
  if (e.button === 2) {
    game.toggleFlag(cell.r, cell.c);
  } else if (e.button === 0) {
    if (flagMode) game.toggleFlag(cell.r, cell.c);
    else game.reveal(cell.r, cell.c);
  }
});

// Touch : short tap = reveal (or flag if flagMode), long press = flag
let touchStartT = 0;
let touchCell = null;
let longPressT = null;
canvas.addEventListener('touchstart', (e) => {
  if (!game || e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  touchCell = canvasToGridCoords(t.clientX, t.clientY);
  touchStartT = Date.now();
  if (!touchCell) return;
  longPressT = setTimeout(() => {
    if (touchCell) {
      game.toggleFlag(touchCell.r, touchCell.c);
      touchCell = null;
    }
  }, 450);
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  if (!game) return;
  if (longPressT) { clearTimeout(longPressT); longPressT = null; }
  if (!touchCell) return;
  const dur = Date.now() - touchStartT;
  if (dur < 400) {
    if (flagMode) game.toggleFlag(touchCell.r, touchCell.c);
    else game.reveal(touchCell.r, touchCell.c);
  }
  touchCell = null;
}, { passive: true });
canvas.addEventListener('touchcancel', () => {
  if (longPressT) { clearTimeout(longPressT); longPressT = null; }
  touchCell = null;
}, { passive: true });

// Keyboard : space = start
document.addEventListener('keydown', (e) => {
  if (!game) return;
  if (e.key === ' ') { e.preventDefault(); if (!game.running && !newGameBtn.disabled) startGame(); }
  if (e.key === 'f' || e.key === 'F') {
    flagMode = !flagMode;
    if (flagToggleBtn) {
      flagToggleBtn.classList.toggle('btn-primary', flagMode);
      flagToggleBtn.textContent = flagMode ? t('minesweeper.flag_on') : t('minesweeper.flag_off');
    }
  }
});

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
