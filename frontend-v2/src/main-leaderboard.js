/* ===================================================================
   SnowDiablo Arcade — Leaderboard entry
   =================================================================== */

import './theme.css';
import './leaderboard-style.css';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { api } from './api.js';

initHeader('hdr');
initFooter('ftr');

const tbody  = document.getElementById('lb-body');
const filter = document.getElementById('lb-filter');
const refreshBtn = document.getElementById('lb-refresh');
const updated = document.getElementById('lb-updated');

function short(a) { return a ? `${a.slice(0,6)}…${a.slice(-4)}` : '—'; }
function fmt(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return (v/1e6).toFixed(2)+'M';
  if (v >= 1e3) return (v/1e3).toFixed(1)+'K';
  return v.toFixed(2);
}

async function load(game = 'all') {
  tbody.innerHTML = `<tr><td colspan="5" class="lb-loading">Loading…</td></tr>`;
  try {
    const rows = await api.leaderboard(game === 'all' ? null : game);
    if (!rows || !rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="lb-loading">No scores yet. Be the first!</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.slice(0, 100).map((r, i) => `
      <tr class="${i < 3 ? 'podium-' + (i+1) : ''}">
        <td class="rank">${i + 1}</td>
        <td class="addr">
          <a href="https://polygonscan.com/address/${r.address}" target="_blank" rel="noopener">
            ${r.username || short(r.address)}
          </a>
        </td>
        <td class="score">${fmt(r.score ?? r.high_score ?? 0)}</td>
        <td class="claimed">${fmt(r.total_claimed ?? 0)} <span class="suffix">$SNAKE</span></td>
        <td class="games">${r.games_played ?? '—'}</td>
      </tr>
    `).join('');
    updated.textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="lb-error">Error: ${err.message}</td></tr>`;
  }
}

filter.addEventListener('change', () => load(filter.value));
refreshBtn.addEventListener('click', () => load(filter.value));
load();
