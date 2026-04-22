/* ===================================================================
   SnowDiablo Arcade — 2048 page entry
   Passes game='2048' to /api/session/start for multi-games backend.
   =================================================================== */

import './theme.css';
import './game2048-style.css';
import { initI18n, t, applyTranslations } from './i18n.js';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { Game2048 } from './game2048-game.js';
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

const GAME_ID = '2048';

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

  game = new Game2048(canvas, {
    onScore: (s) => { scoreEl.textContent = s; },
    onTokensPreview: (tk) => { tokensEl.textContent = tk.toFixed(2); tokensEarned = tk; },
    onGameOver: async ({ score, tokens }) => {
      tokensEarned = tokens;
      tokensEl.textContent = tokens.toFixed(2);
      bestEl.textContent = game.highScore;

      let milestone = null;

      if (sessionId && isConnected()) {
        try {
          // 2048 a un scoring natif tres genereux (somme tiles fusionnees).
          // On divise par 10 avant envoi backend pour s'aligner sur le preview (score/100 dans game2048-game.js)
          // et eviter de systematiquement capper a 500 -> 50 $SNAKE/session.
          const normalizedScore = Math.max(0, Math.floor(score / 10));
          const r = await api.sessionEnd({ sessionId, score: normalizedScore, address: getAddress() });
          if (typeof r?.reward === 'number' && r.reward > tokensEarned) {
            tokensEarned = r.reward;
            tokensEl.textContent = tokensEarned.toFixed(2);
          }
          const parts = [];
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

// Keyboard : arrows + WASD
document.addEventListener('keydown', (e) => {
  if (!game) return;
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); game.move('left'); break;
    case 'ArrowRight': case 'd': case 'D': e.preventDefault(); game.move('right'); break;
    case 'ArrowUp': case 'w': case 'W': e.preventDefault(); game.move('up'); break;
    case 'ArrowDown': case 's': case 'S': e.preventDefault(); game.move('down'); break;
    case ' ': e.preventDefault(); if (!game.running && !newGameBtn.disabled) startGame(); break;
  }
});

// Swipe controls
(function swipeControls() {
  let sx = 0, sy = 0, active = false;
  const TH = 30; // px threshold
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    active = true;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!active || !game) return;
    active = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < TH) return;
    if (ax > ay) game.move(dx > 0 ? 'right' : 'left');
    else         game.move(dy > 0 ? 'down'  : 'up');
  }, { passive: true });

  // Mouse drag desktop fallback
  let mdx = 0, mdy = 0, mdown = false;
  canvas.addEventListener('mousedown', (e) => { mdown = true; mdx = e.clientX; mdy = e.clientY; });
  canvas.addEventListener('mouseup',   (e) => {
    if (!mdown || !game) return;
    mdown = false;
    const dx = e.clientX - mdx;
    const dy = e.clientY - mdy;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < TH) return;
    if (ax > ay) game.move(dx > 0 ? 'right' : 'left');
    else         game.move(dy > 0 ? 'down'  : 'up');
  });
})();

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
