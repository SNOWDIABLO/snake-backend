/* ===================================================================
   SnowDiablo Arcade — Profile entry
   =================================================================== */

import './theme.css';
import './profile-style.css';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { api } from './api.js';
import { isConnected, getAddress, onWalletChange, autoRestore } from './wallet.js';

initHeader('hdr');
initFooter('ftr');

const root = document.getElementById('profile-root');

function short(a) { return a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—'; }
function fmt(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2)+'M';
  if (v >= 1e3) return (v/1e3).toFixed(1)+'K';
  return v.toFixed(2);
}

function renderDisconnected() {
  root.innerHTML = `
    <div class="profile-empty">
      <div class="profile-empty-icon">👛</div>
      <h2>Connect your wallet</h2>
      <p>See your high scores, claim history, NFT trophies and active boosts.</p>
      <p class="hint">Use the <strong>Connect Wallet</strong> button in the header.</p>
    </div>
  `;
}

async function renderConnected(addr) {
  root.innerHTML = `<div class="profile-loading">Loading your profile…</div>`;
  try {
    const [player, streak, nftMult, boostMult, boostInv, quests, username] = await Promise.all([
      api.player(addr).catch(() => null),
      api.streak(addr).catch(() => null),
      api.nftMultiplier(addr).catch(() => null),
      api.boostMultiplier(addr).catch(() => null),
      api.boostInventory(addr).catch(() => null),
      api.quests(addr).catch(() => null),
      api.username(addr).catch(() => null)
    ]);

    root.innerHTML = `
      <div class="profile-head">
        <div class="profile-avatar">${(username?.username || addr).slice(0,2).toUpperCase()}</div>
        <div class="profile-info">
          <div class="profile-name">${username?.username || short(addr)}</div>
          <a class="profile-addr" href="https://polygonscan.com/address/${addr}" target="_blank" rel="noopener">${addr}</a>
        </div>
      </div>

      <div class="profile-stats">
        <div class="p-stat"><span class="k">HIGH SCORE</span><span class="v">${fmt(player?.high_score)}</span></div>
        <div class="p-stat"><span class="k">TOTAL CLAIMED</span><span class="v grad-text">${fmt(player?.total_claimed)} $SNAKE</span></div>
        <div class="p-stat"><span class="k">GAMES PLAYED</span><span class="v">${player?.games_played ?? 0}</span></div>
        <div class="p-stat"><span class="k">RANK</span><span class="v">#${player?.rank ?? '—'}</span></div>
        <div class="p-stat"><span class="k">STREAK</span><span class="v">${streak?.current ?? 0} 🔥</span></div>
        <div class="p-stat"><span class="k">TROPHY BOOST</span><span class="v">+${((nftMult?.multiplier ?? 0) / 100).toFixed(0)}%</span></div>
        <div class="p-stat"><span class="k">NFT BOOST</span><span class="v">+${((boostMult?.bps ?? 0) / 100).toFixed(0)}%</span></div>
      </div>

      ${boostInv?.length ? `
        <section class="profile-section">
          <h3>YOUR BOOST NFTS</h3>
          <div class="boost-grid">
            ${boostInv.map(b => `
              <div class="boost-card">
                <div class="boost-tier ${b.tier?.toLowerCase() || ''}">${b.tier || 'BASIC'}</div>
                <div class="boost-bps">+${((b.bps ?? 0) / 100).toFixed(0)}%</div>
                <div class="boost-id">#${b.tokenId}</div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      ${quests?.length ? `
        <section class="profile-section">
          <h3>DAILY QUESTS</h3>
          <div class="quest-list">
            ${quests.map(q => `
              <div class="quest ${q.completed ? 'done' : ''}">
                <span class="quest-title">${q.title}</span>
                <span class="quest-prog">${q.progress}/${q.target}</span>
                <span class="quest-reward">+${fmt(q.reward)} $SNAKE</span>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
    `;
  } catch (err) {
    root.innerHTML = `<div class="profile-empty"><h2>Error loading profile</h2><p>${err.message}</p></div>`;
  }
}

function update() {
  if (isConnected()) renderConnected(getAddress());
  else renderDisconnected();
}

onWalletChange(update);
update();
autoRestore().then(update).catch(update);
