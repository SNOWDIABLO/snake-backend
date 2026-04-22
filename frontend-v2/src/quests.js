/* ===================================================================
   SnowDiablo Arcade — Daily Quests widget
   Self-contained. Mount into any container.
   Uses: api.quests(address) — resets at UTC midnight
   =================================================================== */

import { api } from './api.js';
import { isConnected, getAddress, onWalletChange } from './wallet.js';
import { t } from './i18n.js';

let refreshTimer = null;
let tickTimer = null;

function fmtResetIn(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Translate known quest IDs to localized name
function questName(q) {
  const id = (q.id || '').toLowerCase();
  if (id.includes('play3') || id.includes('games_3')) return t('quests.q_play3');
  if (id.includes('score') && id.includes('25'))       return t('quests.q_score25');
  if (id.includes('earn') && id.includes('5'))         return t('quests.q_earn5');
  return q.name || q.id || '';
}

function questRow(q) {
  const pct = Math.max(0, Math.min(100, q.percent || 0));
  const done = q.done ? 'done' : '';
  return `
    <div class="q-row ${done}">
      <div class="q-head">
        <span class="q-name">${escapeHtml(questName(q))}</span>
        <span class="q-prog">${q.progress}/${q.goal}</span>
      </div>
      <div class="q-bar"><div class="q-bar-fill" style="width:${pct}%"></div></div>
    </div>
  `;
}

export function initQuests(mount) {
  if (!mount) return;

  mount.innerHTML = `
    <div class="panel quests-panel">
      <h3>${t('quests.heading')}</h3>
      <div class="q-meta">
        <span id="q-done">—</span>
        <span id="q-reset">${t('quests.reset_in', { time: '—' })}</span>
      </div>
      <div class="q-list" id="q-list">
        <div class="q-empty">${t('quests.connect_track')}</div>
      </div>
    </div>
  `;

  const doneEl  = mount.querySelector('#q-done');
  const resetEl = mount.querySelector('#q-reset');
  const listEl  = mount.querySelector('#q-list');

  async function load() {
    try {
      let d;
      if (isConnected()) {
        d = await api.quests(getAddress());
      } else {
        d = await api.quests('0x0000000000000000000000000000000000000000').catch(() => null);
      }
      if (!d) {
        listEl.innerHTML = `<div class="q-empty">${t('quests.unavailable')}</div>`;
        return;
      }

      doneEl.textContent = t('quests.done_count', { done: d.completed, total: d.total });
      doneEl.className = d.all_done ? 'q-done-ok' : '';

      startResetTick(d.reset_in_seconds);

      if (!isConnected()) {
        listEl.innerHTML = d.quests.map(q => questRow({ ...q, progress: 0, percent: 0, done: false })).join('')
          + `<div class="q-empty">${t('quests.connect_track')}</div>`;
      } else {
        listEl.innerHTML = d.quests.map(questRow).join('');
      }
    } catch (e) {
      console.warn('[quests]', e.message);
      listEl.innerHTML = `<div class="q-empty">${t('quests.error')}</div>`;
    }
  }

  function startResetTick(sec) {
    if (tickTimer) clearInterval(tickTimer);
    let left = sec;
    const tick = () => {
      resetEl.textContent = t('quests.reset_in', { time: fmtResetIn(left) });
      if (left <= 0) {
        clearInterval(tickTimer);
        setTimeout(load, 2000);
      }
      left -= 1;
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  load();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(load, 60000);
  onWalletChange(load);

  return {
    refresh: load,
    destroy: () => {
      if (refreshTimer) clearInterval(refreshTimer);
      if (tickTimer) clearInterval(tickTimer);
    }
  };
}
