/* ===================================================================
   SnowDiablo Arcade — HUB live wiring (2026 Terminal redesign)
   - Season leaderboard panel  → /api/leaderboard
   - LP Fund pool              → public Polygon RPC (eth_getBalance)
   - ?demo=1 fills representative data for local preview (CORS blocks
     the real API from localhost — expected).
   =================================================================== */

import { api } from './api.js';

const DEMO       = typeof location !== 'undefined' && location.search.includes('demo');
const LP_WALLET  = '0xc1D4Fe31F4C0526848E4B427FDfBA519f36C166E';
const LP_TARGET  = 5000; // POL
const POLY_RPC   = 'https://polygon-bor-rpc.publicnode.com';

function shortAddr(a) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '——'; }
function fmtAmt(n)    { return (Math.round(Number(n) * 100) / 100).toLocaleString('en-US'); }

/* ---- Season leaderboard panel (hero side) ---- */
function renderFeed(rows) {
  const el = document.getElementById('hub-feed');
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="t-feed-empty">no entries yet — be the first to run.</div>';
    return;
  }
  el.innerHTML = rows.slice(0, 6).map((r, i) => {
    const who = r.username || shortAddr(r.address || r.wallet);
    const raw = r.total_claimed != null ? r.total_claimed : (r.earned != null ? r.earned : r.score);
    const amt = raw != null ? `${fmtAmt(raw)} $SNAKE` : '';
    return `<div class="t-feed-row"><span class="rk">${String(i + 1).padStart(2, '0')}</span>` +
           `<span class="who">${who}</span><span class="amt">${amt}</span></div>`;
  }).join('');
}

async function loadLeaderboard() {
  if (DEMO) { renderFeed(DEMO_LB); return; }
  try {
    const data = await api.leaderboard();
    const rows = Array.isArray(data) ? data : (data?.leaderboard || data?.players || data?.top || []);
    renderFeed(rows);
  } catch (e) {
    const el = document.getElementById('hub-feed');
    if (el) el.innerHTML = '<div class="t-feed-empty">leaderboard offline — retry shortly.</div>';
  }
}

/* ---- LP Fund tracker (real POL balance via public RPC) ---- */
async function loadLP() {
  const fill = document.getElementById('hub-lpfill');
  const val  = document.getElementById('hub-lpval');
  if (!fill || !val) return;

  let pol = null;
  if (DEMO) {
    pol = 3120;
  } else {
    try {
      const res = await fetch(POLY_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [LP_WALLET, 'latest'], id: 1 })
      });
      const j = await res.json();
      if (j && j.result) pol = Number(BigInt(j.result)) / 1e18;
    } catch (e) { pol = null; }
  }

  if (pol == null) { val.textContent = '—'; return; }
  val.textContent = pol.toLocaleString('en-US', { maximumFractionDigits: 0 });
  fill.style.width = Math.min(pol / LP_TARGET * 100, 100) + '%';
}

/* ---- Demo data (local preview only) ---- */
const DEMO_STATS = { total_claimed: 184920.42, games: 48317, players: 1264, high_score: 9840 };
const DEMO_LB = [
  { username: 'CryptoFang', total_claimed: 4218.5 },
  { username: '0xVenom',    total_claimed: 3902.1 },
  { username: 'PixelSerp',  total_claimed: 3540.0 },
  { username: 'NeonByte',   total_claimed: 2988.4 },
  { username: 'GoldRusher', total_claimed: 2654.2 },
  { username: 'ColdViper',  total_claimed: 2310.0 }
];

function writeDemoStats() {
  document.querySelectorAll('[data-stat]').forEach(el => {
    const k = el.dataset.stat;
    const v = DEMO_STATS[k];
    if (v == null) { el.textContent = '—'; return; }
    el.textContent = (k === 'total_claimed')
      ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
      : Number(v).toLocaleString('en-US');
  });
}

export function initHub() {
  if (DEMO) writeDemoStats();   // real stats are filled by stats.js (/api/stats)
  loadLeaderboard();
  loadLP();
}
