/* ===================================================================
   SnowDiablo Arcade — Tournament panel (24h)
   Self-contained UI widget. Mount into any container.
   Uses: api.tournamentCurrent / tournamentLeaderboard / tournamentEnter
   =================================================================== */

import { api } from './api.js';
import { isConnected, getAddress, getSigner, onWalletChange } from './wallet.js';
import { t } from './i18n.js';

let state = null;
let tickTimer = null;
let refreshTimer = null;

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function shortAddr(a) {
  if (!a) return '—';
  return `${a.slice(0,6)}…${a.slice(-4)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function initTournament(mount) {
  if (!mount) return;

  mount.innerHTML = `
    <div class="panel tournament-panel" id="tournament-box" style="display:none">
      <h3>${t('tournament.heading')}</h3>
      <div class="t-stats">
        <div class="t-stat">
          <div class="l">${t('tournament.time')}</div>
          <div class="v" id="t-countdown">—</div>
        </div>
        <div class="t-stat">
          <div class="l">${t('tournament.pool')}</div>
          <div class="v" id="t-pool">—</div>
        </div>
        <div class="t-stat">
          <div class="l">${t('tournament.entries')}</div>
          <div class="v" id="t-entries">—</div>
        </div>
      </div>
      <button class="btn btn-primary t-enter" id="t-enter-btn" type="button" disabled>${t('tournament.enter', { fee: '1' })}</button>
      <div class="t-mine" id="t-mine"></div>
      <div class="t-lb-wrap">
        <div class="t-lb-title">${t('tournament.top5')}</div>
        <div id="t-lb"></div>
      </div>
      <div class="t-note">${t('tournament.split')}</div>
    </div>
  `;

  const box       = mount.querySelector('#tournament-box');
  const countEl   = mount.querySelector('#t-countdown');
  const poolEl    = mount.querySelector('#t-pool');
  const entriesEl = mount.querySelector('#t-entries');
  const btn       = mount.querySelector('#t-enter-btn');
  const mineEl    = mount.querySelector('#t-mine');
  const lbEl      = mount.querySelector('#t-lb');

  btn.addEventListener('click', () => enterTournament(btn));

  async function load() {
    try {
      const d = await api.tournamentCurrent();
      if (!d.enabled || !d.active) { box.style.display = 'none'; return; }
      state = d;
      box.style.display = '';
      poolEl.textContent    = `${Number(d.prize_pool_pol).toFixed(2)} POL`;
      entriesEl.textContent = String(d.entries_count);
      btn.textContent       = t('tournament.enter', { fee: Number(d.entry_fee_pol).toFixed(2) });
      btn.disabled          = !isConnected() || d.time_left_sec <= 0;

      startCountdown(d.time_left_sec);
      await loadLeaderboard();
    } catch (e) {
      console.warn('[tournament]', e.message);
      box.style.display = 'none';
    }
  }

  function startCountdown(sec) {
    if (tickTimer) clearInterval(tickTimer);
    let left = sec;
    const tick = () => {
      countEl.textContent = fmtDur(left);
      if (left <= 0) {
        clearInterval(tickTimer);
        btn.disabled = true;
        btn.textContent = t('tournament.ended');
        setTimeout(load, 5000);
      }
      left -= 1;
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  async function loadLeaderboard() {
    try {
      const d = await api.tournamentLeaderboard();
      if (!d?.entries?.length) {
        lbEl.innerHTML = `<div class="t-empty">${t('tournament.empty')}</div>`;
        mineEl.textContent = '';
        return;
      }
      const me = isConnected() ? getAddress().toLowerCase() : '';
      lbEl.innerHTML = d.entries.slice(0, 5).map(e => {
        const mine = (e.wallet || '').toLowerCase() === me ? 'me' : '';
        const medal = e.rank === 1 ? '🥇' : (e.rank === 2 ? '🥈' : (e.rank === 3 ? '🥉' : `#${e.rank}`));
        const clan  = e.clan_tag ? `<span class="t-clan">[${escapeHtml(e.clan_tag)}]</span>` : '';
        return `<div class="t-lb-item ${mine}">
          <span class="r">${medal}</span>
          <span class="n">${clan}${e.wallet_short || shortAddr(e.wallet)}</span>
          <span class="s">${e.best_score ?? 0}</span>
        </div>`;
      }).join('');

      const mine = d.entries.find(x => (x.wallet || '').toLowerCase() === me);
      if (mine) {
        mineEl.textContent = t('tournament.my_rank', { rank: mine.rank, score: mine.best_score });
        btn.disabled = true;
        btn.textContent = t('tournament.joined');
      } else {
        mineEl.textContent = '';
      }
    } catch (_) { /* silent */ }
  }

  async function enterTournament(button) {
    if (!isConnected() || !state) {
      button.textContent = t('common.connect_first');
      return;
    }
    const payoutTo = state.payout_wallet;
    if (!payoutTo) {
      button.textContent = t('tournament.payout_missing');
      return;
    }
    const signer = getSigner();
    if (!signer) {
      button.textContent = t('common.connect_first');
      return;
    }

    button.disabled = true;
    button.textContent = t('tournament.tx_sending');

    try {
      const tx = await signer.sendTransaction({
        to: payoutTo,
        value: BigInt(state.entry_fee_wei)
      });
      button.textContent = t('tournament.tx_verify');
      await tx.wait(2);

      const r = await api.tournamentEnter({
        wallet: getAddress(),
        tx_hash: tx.hash
      });
      if (r?.error) throw new Error(r.error);

      button.textContent = t('tournament.tx_success');
      setTimeout(load, 1500);
    } catch (e) {
      console.error('[tournament/enter]', e);
      button.textContent = '❌ ' + (e.shortMessage || e.message || 'error');
      setTimeout(() => {
        button.disabled = false;
        button.textContent = t('tournament.enter', { fee: Number(state.entry_fee_pol).toFixed(2) });
      }, 3500);
    }
  }

  load();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(load, 30000);
  onWalletChange(load);

  return {
    refresh: load,
    destroy: () => {
      if (tickTimer) clearInterval(tickTimer);
      if (refreshTimer) clearInterval(refreshTimer);
    }
  };
}
