/* ===================================================================
   SnowDiablo Arcade — Boost NFT marketplace
   Self-contained widget. Mount into any container.
   Uses: api.boostCatalog / boostMultiplier / boostInventory / boostRefresh
   Mint paths:
     - POL  : contract.mintWithPol(tier) payable  (+2% buffer)
     - SNAKE: ERC20.approve → contract.mintWithSnakeBurn(tier)
   =================================================================== */

import { api } from './api.js';
import { isConnected, getAddress, getSigner, onWalletChange } from './wallet.js';
import { CONTRACT_ADDRESS, BOOST_NFT_ADDRESS, BOOST_ABI, SNAKE_ABI } from './contracts.js';
import { t } from './i18n.js';

let refreshTimer = null;

const TIER_THEME = {
  1: { key: 'basic', labelKey: 'boost.tier_basic', color: 'var(--neon-green)' },
  2: { key: 'pro',   labelKey: 'boost.tier_pro',   color: 'var(--neon-cyan)' },
  3: { key: 'elite', labelKey: 'boost.tier_elite', color: 'var(--neon-pink)' }
};

function fmtPolWei(weiStr) {
  if (!weiStr) return '—';
  try {
    const n = Number(window.ethers.formatEther(BigInt(weiStr)));
    return `${n.toFixed(2)} POL`;
  } catch { return '—'; }
}

function fmtSnakeWei(weiStr) {
  if (!weiStr) return '—';
  try {
    const n = Number(window.ethers.formatUnits(BigInt(weiStr), 18));
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} $SNAKE`;
  } catch { return '—'; }
}

function tierCard(tier) {
  const theme = TIER_THEME[tier.id] || { key: 'basic', labelKey: 'boost.tier_basic' };
  const label = t(theme.labelKey);
  const soldOut = tier.minted >= tier.supply_cap;
  const bonusPct = (tier.multiplier_bps / 100).toFixed(0);
  const supplyPct = tier.supply_cap ? Math.floor((tier.minted / tier.supply_cap) * 100) : 0;

  return `
    <div class="boost-tier boost-tier-${theme.key}" data-tier="${tier.id}">
      <div class="bt-head">
        <span class="bt-label">${label}</span>
        <span class="bt-bonus">+${bonusPct}%</span>
      </div>
      <div class="bt-supply">
        <div class="bt-sb"><div class="bt-sbf" style="width:${supplyPct}%"></div></div>
        <span class="bt-sbt">${tier.minted} / ${tier.supply_cap}</span>
      </div>
      <div class="bt-prices">
        <div class="bt-p"><span class="bt-pk">POL</span><span class="bt-pv">${fmtPolWei(tier.pol_price_wei)}</span></div>
        <div class="bt-p"><span class="bt-pk">Burn</span><span class="bt-pv">${fmtSnakeWei(tier.snake_burn_wei)}</span></div>
      </div>
      <div class="bt-actions">
        <button type="button" class="btn bt-mint-pol"  data-tier="${tier.id}" ${soldOut ? 'disabled' : ''}>
          ${soldOut ? t('boost.sold_out') : t('boost.mint_pol')}
        </button>
        <button type="button" class="btn bt-mint-snake" data-tier="${tier.id}" ${soldOut ? 'disabled' : ''}>
          ${soldOut ? '—' : t('boost.mint_snake')}
        </button>
      </div>
    </div>
  `;
}

export function initBoost(mount) {
  if (!mount) return;

  mount.innerHTML = `
    <div class="panel boost-panel" id="boost-box" style="display:none">
      <h3>${t('boost.heading')}</h3>
      <div class="boost-meta">
        <span id="boost-status" class="boost-status">—</span>
      </div>
      <div class="boost-tiers" id="boost-tiers"></div>
      <div class="boost-inv">
        <div class="boost-inv-title">${t('boost.inventory')}</div>
        <div id="boost-inv-list" class="boost-inv-list"><div class="bi-empty">${t('boost.no_nft')}</div></div>
      </div>
      <div id="boost-feedback" class="boost-feedback"></div>
    </div>
  `;

  const box      = mount.querySelector('#boost-box');
  const tiersEl  = mount.querySelector('#boost-tiers');
  const statusEl = mount.querySelector('#boost-status');
  const invEl    = mount.querySelector('#boost-inv-list');
  const fbEl     = mount.querySelector('#boost-feedback');

  function flash(msg, kind = '') {
    fbEl.textContent = msg || '';
    fbEl.className = `boost-feedback${kind ? ' ' + kind : ''}`;
    if (msg) setTimeout(() => { if (fbEl.textContent === msg) fbEl.textContent = ''; }, 4000);
  }

  async function loadAll() {
    try {
      const cat = await api.boostCatalog();
      if (!cat?.available || !cat.tiers?.length) {
        box.style.display = 'none';
        return;
      }
      box.style.display = '';
      tiersEl.innerHTML = cat.tiers.map(tierCard).join('');
      bindTierButtons();
    } catch (e) {
      console.warn('[boost/catalog]', e.message);
      box.style.display = 'none';
      return;
    }

    if (isConnected()) {
      const addr = getAddress();
      try {
        const m = await api.boostMultiplier(addr);
        if (m?.bps > 0) {
          statusEl.textContent = t('boost.active', {
            pct: (m.bps / 100).toFixed(0),
            mult: m.multiplier.toFixed(2)
          });
          statusEl.className = 'boost-status ok';
        } else {
          statusEl.textContent = t('boost.active_none');
          statusEl.className = 'boost-status';
        }
      } catch (_) { /* silent */ }

      try {
        const inv = await api.boostInventory(addr);
        if (inv?.tokens?.length) {
          invEl.innerHTML = inv.tokens.map(tok => {
            const theme = TIER_THEME[tok.tier] || { key: 'basic', labelKey: 'boost.tier_basic' };
            return `<div class="bi-item bi-${theme.key}">
              <span class="bi-tier">${t(theme.labelKey)}</span>
              <span class="bi-id">#${tok.token_id}</span>
            </div>`;
          }).join('');
        } else {
          invEl.innerHTML = `<div class="bi-empty">${t('boost.no_nft')}</div>`;
        }
      } catch (_) { /* silent */ }
    } else {
      statusEl.textContent = t('boost.connect');
      statusEl.className = 'boost-status';
      invEl.innerHTML = `<div class="bi-empty">${t('common.connect_wallet')}</div>`;
    }
  }

  function bindTierButtons() {
    tiersEl.querySelectorAll('.bt-mint-pol').forEach(b => {
      b.addEventListener('click', () => mintWithPol(Number(b.dataset.tier), b));
    });
    tiersEl.querySelectorAll('.bt-mint-snake').forEach(b => {
      b.addEventListener('click', () => mintWithSnake(Number(b.dataset.tier), b));
    });
  }

  async function mintWithPol(tierId, btn) {
    if (!isConnected()) { flash(t('common.connect_first'), 'err'); return; }
    const signer = getSigner();
    if (!signer) { flash(t('common.connect_first'), 'err'); return; }

    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('boost.checking');

    try {
      const contract = new window.ethers.Contract(BOOST_NFT_ADDRESS, BOOST_ABI, signer);
      const price = await contract.getPolPrice(tierId);
      const value = (price * 102n) / 100n;

      btn.textContent = t('boost.minting');
      flash(t('boost.minting'));
      const tx = await contract.mintWithPol(tierId, { value });
      btn.textContent = t('boost.confirming');
      await tx.wait(2);

      try { await api.boostRefresh(getAddress()); } catch (_) {}
      await loadAll();
      flash(t('boost.minted', { tier: tierId }), 'ok');
    } catch (e) {
      console.error('[boost/mint POL]', e);
      flash(e.shortMessage || e.reason || e.message || t('common.error'), 'err');
      btn.textContent = origLabel;
      btn.disabled = false;
    }
  }

  async function mintWithSnake(tierId, btn) {
    if (!isConnected()) { flash(t('common.connect_first'), 'err'); return; }
    const signer = getSigner();
    if (!signer) { flash(t('common.connect_first'), 'err'); return; }
    const addr = getAddress();

    const origLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('boost.checking');

    try {
      const cat = await api.boostCatalog();
      const tier = cat.tiers.find(tt => tt.id === tierId);
      if (!tier || !tier.snake_burn_wei) throw new Error('tier unavailable');
      const amount = BigInt(tier.snake_burn_wei);

      const erc20 = new window.ethers.Contract(CONTRACT_ADDRESS, SNAKE_ABI, signer);
      const bal = await erc20.balanceOf(addr);
      if (bal < amount) {
        const need = window.ethers.formatUnits(amount, 18);
        const have = window.ethers.formatUnits(bal, 18);
        throw new Error(t('boost.need_snake', { need, bal: have }));
      }

      const allowance = await erc20.allowance(addr, BOOST_NFT_ADDRESS);
      if (allowance < amount) {
        btn.textContent = t('boost.approving');
        flash(t('boost.approving'));
        const apTx = await erc20.approve(BOOST_NFT_ADDRESS, amount);
        await apTx.wait(1);
      }

      btn.textContent = t('boost.burning');
      flash(t('boost.burning'));
      const contract = new window.ethers.Contract(BOOST_NFT_ADDRESS, BOOST_ABI, signer);
      const tx = await contract.mintWithSnakeBurn(tierId);
      btn.textContent = t('boost.confirming');
      await tx.wait(2);

      try { await api.boostRefresh(addr); } catch (_) {}
      await loadAll();
      flash(t('boost.minted', { tier: tierId }), 'ok');
    } catch (e) {
      console.error('[boost/mint SNAKE]', e);
      flash(e.shortMessage || e.reason || e.message || t('common.error'), 'err');
      btn.textContent = origLabel;
      btn.disabled = false;
    }
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
