/* ===================================================================
   SnowDiablo Arcade — Player status widget
   Combined STREAK + TROPHY NFT display in a single compact panel.
   Uses: api.streak(addr) + api.nftMultiplier(addr) + api.nftEligibility(addr)
   =================================================================== */

import { api } from './api.js';
import { isConnected, getAddress, onWalletChange } from './wallet.js';
import { t } from './i18n.js';

let refreshTimer = null;

const TIER_CLASS = {
  Gold:   'tier-gold',
  Silver: 'tier-silver',
  Bronze: 'tier-bronze',
  Top10:  'tier-top10'
};

export function initPlayerStatus(mount) {
  if (!mount) return;

  mount.innerHTML = `
    <div class="panel player-panel">
      <h3>${t('player.heading')}</h3>
      <div class="ps-row" id="ps-streak">
        <div class="ps-k">${t('player.streak')}</div>
        <div class="ps-v"><span id="ps-streak-v">—</span></div>
        <div class="ps-sub" id="ps-streak-sub">${t('common.connect_wallet')}</div>
      </div>
      <div class="ps-row" id="ps-trophy">
        <div class="ps-k">${t('player.trophy')}</div>
        <div class="ps-v"><span id="ps-trophy-v">—</span></div>
        <div class="ps-sub" id="ps-trophy-sub">—</div>
      </div>
    </div>
  `;

  const streakV   = mount.querySelector('#ps-streak-v');
  const streakSub = mount.querySelector('#ps-streak-sub');
  const trophyV   = mount.querySelector('#ps-trophy-v');
  const trophySub = mount.querySelector('#ps-trophy-sub');
  const trophyRow = mount.querySelector('#ps-trophy');

  async function loadStreak() {
    if (!isConnected()) {
      streakV.textContent = '—';
      streakV.className = '';
      streakSub.textContent = t('common.connect_wallet');
      return;
    }
    try {
      const s = await api.streak(getAddress());
      const cur = s.current || 0;
      streakV.textContent = `${cur}d`;
      streakV.className = s.active ? (s.at_risk ? 'streak-risk' : 'streak-ok') : 'streak-off';

      if (!s.active) {
        streakSub.textContent = t('player.streak_start');
      } else if (s.at_risk) {
        streakSub.textContent = t('player.streak_risk');
      } else {
        const mult = s.multiplier ? `x${Number(s.multiplier).toFixed(2)}` : 'x1.00';
        const toNext = s.days_to_next
          ? ` - +${s.days_to_next}d → ${s.next_milestone}d`
          : ` - ${t('player.streak_max')}`;
        streakSub.textContent = `${mult}${toNext}`;
      }
    } catch (e) {
      streakV.textContent = '—';
      streakSub.textContent = t('common.error');
    }
  }

  async function loadTrophy() {
    if (!isConnected()) {
      trophyV.textContent = '—';
      trophyV.className = '';
      trophySub.textContent = t('common.connect_wallet');
      trophyRow.className = 'ps-row';
      return;
    }
    try {
      const tr = await api.nftMultiplier(getAddress());
      if (tr.tier && tr.bonus_pct > 0) {
        trophyV.textContent = `${tr.tier} +${tr.bonus_pct}%`;
        trophyV.className = TIER_CLASS[tr.tier] || '';
        const mult = tr.multiplier ? `x${Number(tr.multiplier).toFixed(2)}` : 'x1.00';
        trophySub.textContent = `${mult}${tr.rank ? ` - #${tr.rank}` : ''}`;
        trophyRow.className = `ps-row ${TIER_CLASS[tr.tier] || ''}`;
      } else {
        trophyV.textContent = t('player.trophy_none');
        trophyV.className = 'trophy-none';
        try {
          const e = await api.nftEligibility(getAddress());
          const pending = (e.drops || []).filter(d => d.status !== 'minted').length;
          trophySub.textContent = pending > 0
            ? t('player.trophy_pending', { n: pending })
            : t('player.trophy_hint');
        } catch {
          trophySub.textContent = t('player.trophy_hint');
        }
        trophyRow.className = 'ps-row';
      }
    } catch (e) {
      trophyV.textContent = '—';
      trophySub.textContent = t('common.error');
      trophyRow.className = 'ps-row';
    }
  }

  async function loadAll() {
    await Promise.all([loadStreak(), loadTrophy()]);
  }

  loadAll();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadAll, 60000);
  onWalletChange(loadAll);

  return {
    refresh: loadAll,
    destroy: () => { if (refreshTimer) clearInterval(refreshTimer); }
  };
}
