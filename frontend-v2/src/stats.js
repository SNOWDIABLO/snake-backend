/* ===================================================================
   SnowDiablo Arcade — Live stats fetcher
   Polls /api/stats every 30s and writes to DOM.
   Elements opted-in via data-stat="<key>" attribute.
   =================================================================== */

import { api } from './api.js';

const POLL_MS = 30000;
let _timer = null;

function fmt(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.floor(n));
}

function write(stats) {
  document.querySelectorAll('[data-stat]').forEach(el => {
    const key = el.dataset.stat;
    let val = stats?.[key];
    if (key === 'total_claimed' || key === 'high_score') {
      val = fmt(Number(val || 0));
    } else if (typeof val === 'number') {
      val = fmt(val);
    } else if (val == null) {
      val = '—';
    }
    el.textContent = val;
  });
}

async function tick() {
  try {
    const stats = await api.stats();
    write(stats);
  } catch (err) {
    console.warn('[stats] fetch failed', err.message);
  }
}

export function startLiveStats() {
  tick();
  if (_timer) clearInterval(_timer);
  _timer = setInterval(tick, POLL_MS);
}

export function stopLiveStats() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// Visibility-aware: pause when tab hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLiveStats();
  else startLiveStats();
});
