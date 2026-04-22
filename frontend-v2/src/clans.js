/* ===================================================================
   SnowDiablo Arcade — Clans panel
   List + create (1000 $SNAKE burn) + join + leave + leaderboard weekly
   Uses: api.clanList / clanMine / clanCreate / clanJoin / clanLeave
         api.clanLeaderboard / configFees
   =================================================================== */

import { api } from './api.js';
import { CONTRACT_ADDRESS } from './contracts.js';
import { isConnected, getAddress, getSigner, onWalletChange } from './wallet.js';
import { t } from './i18n.js';

const BURN_FALLBACK = '0x000000000000000000000000000000000000dEaD';
let state = { list: [], mine: null, lb: [], feesCfg: null };
let refreshTimer = null;

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function signClanAction(action) {
  const signer = getSigner();
  const addr = getAddress();
  if (!signer || !addr) throw new Error('wallet_missing');
  const now = Math.floor(Date.now() / 1000);
  const msg = `${action}|${addr.toLowerCase()}|${now}`;
  const signature = await signer.signMessage(msg);
  return { message: msg, signature, ts: now };
}

export function initClans(mount) {
  if (!mount) return;

  mount.innerHTML = `
    <div class="panel clans-panel" id="clans-box" style="display:none">
      <h3>${t('clans.heading')}</h3>
      <div id="clans-meta" class="c-meta"></div>
      <div id="clan-current" class="c-current" style="display:none"></div>
      <div id="clan-create-block" class="c-create" style="display:none">
        <input type="text" id="clan-create-name" placeholder="${t('clans.create_name_ph')}" maxlength="20"/>
        <input type="text" id="clan-create-tag"  placeholder="${t('clans.create_tag_ph')}" maxlength="6"/>
        <button class="btn btn-primary" id="clan-create-btn" type="button">${t('clans.create_btn')}</button>
      </div>
      <div id="clan-list-block" style="display:none">
        <div class="c-sub">${t('clans.weekly_lb')}</div>
        <div id="clan-list"></div>
      </div>
      <div id="clans-status" class="c-status"></div>
    </div>
  `;

  const box        = mount.querySelector('#clans-box');
  const metaEl     = mount.querySelector('#clans-meta');
  const currentEl  = mount.querySelector('#clan-current');
  const createEl   = mount.querySelector('#clan-create-block');
  const listBlock  = mount.querySelector('#clan-list-block');
  const listEl     = mount.querySelector('#clan-list');
  const statusEl   = mount.querySelector('#clans-status');
  const createBtn  = mount.querySelector('#clan-create-btn');
  const nameInput  = mount.querySelector('#clan-create-name');
  const tagInput   = mount.querySelector('#clan-create-tag');

  createBtn.addEventListener('click', doCreate);

  function setStatus(msg, isErr = false) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('err', !!isErr);
  }

  async function loadAll() {
    try {
      const [d, mine, lb] = await Promise.all([
        api.clanList(30).catch(() => ({ enabled: false })),
        isConnected() ? api.clanMine(getAddress()).catch(() => ({ clan: null })) : Promise.resolve({ clan: null }),
        api.clanLeaderboard().catch(() => ({ clans: [] }))
      ]);
      if (!d?.enabled) { box.style.display = 'none'; return; }
      box.style.display = '';
      state.list = d.clans || [];
      state.mine = mine?.clan || null;
      state.lb   = lb?.clans || [];
      render();
    } catch (e) {
      console.warn('[clans]', e.message);
    }
  }

  function render() {
    metaEl.textContent = t('clans.burn_note');

    if (state.mine) {
      currentEl.style.display = '';
      createEl.style.display  = 'none';
      const role = state.mine.role === 'owner' ? ' (owner)' : '';
      currentEl.innerHTML = `
        <div class="c-cur-name">
          <span class="tag">[${escapeHtml(state.mine.tag)}]</span>
          <strong>${escapeHtml(state.mine.name)}</strong>${role}
        </div>
        <button class="btn c-leave" type="button" id="clan-leave-btn">${t('clans.leave')}</button>
      `;
      currentEl.querySelector('#clan-leave-btn').addEventListener('click', doLeave);
    } else if (isConnected()) {
      currentEl.style.display = 'none';
      createEl.style.display  = '';
    } else {
      currentEl.style.display = 'none';
      createEl.style.display  = 'none';
    }

    listBlock.style.display = state.list.length ? '' : 'none';
    const me = isConnected() ? getAddress().toLowerCase() : '';
    const lbMap = new Map((state.lb || []).map(c => [c.id, c]));
    listEl.innerHTML = state.list.slice(0, 10).map((c, i) => {
      const medal = i === 0 ? '🥇' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `#${i+1}`));
      const wk    = lbMap.get(c.id);
      const wkPts = wk ? `${wk.weekly_points || 0} pts` : '-';
      const mine  = state.mine && state.mine.id === c.id;
      const joinBtn = (!mine && isConnected() && !state.mine)
        ? `<button class="btn btn-sm c-join" data-cid="${c.id}" type="button">${t('clans.join')}</button>`
        : '';
      return `<div class="c-item ${mine ? 'mine' : ''}">
        <span class="c-rank">${medal}</span>
        <span class="c-tag">[${escapeHtml(c.tag)}]</span>
        <span class="c-name">${escapeHtml(c.name)}</span>
        <span class="c-members">${t('clans.members', { n: c.member_count || 0 })}</span>
        <span class="c-wk">${wkPts}</span>
        ${joinBtn}
      </div>`;
    }).join('');

    listEl.querySelectorAll('.c-join').forEach(b => {
      b.addEventListener('click', () => doJoin(Number(b.dataset.cid)));
    });
  }

  async function doCreate() {
    if (!isConnected()) { setStatus(t('common.connect_first'), true); return; }
    const name = nameInput.value.trim();
    const tag  = tagInput.value.trim().toUpperCase();
    if (name.length < 3 || name.length > 20) {
      setStatus(t('clans.invalid_name'), true); return;
    }
    if (tag.length < 2 || tag.length > 6 || !/^[A-Z0-9]+$/.test(tag)) {
      setStatus(t('clans.invalid_tag'), true); return;
    }

    createBtn.disabled = true;
    setStatus(t('common.loading'));
    try {
      if (!state.feesCfg) state.feesCfg = await api.configFees().catch(() => ({}));
      const clanTarget = state.feesCfg?.clan_target || BURN_FALLBACK;

      setStatus(t('clans.creating'));
      const signer = getSigner();
      const erc20 = new window.ethers.Contract(CONTRACT_ADDRESS, [
        'function transfer(address to, uint256 amount) returns (bool)'
      ], signer);
      const burnTx = await erc20.transfer(clanTarget, window.ethers.parseUnits('1000', 18));

      setStatus(t('tournament.tx_verify'));
      await burnTx.wait(2);

      const proof = await signClanAction('CreateClan');

      const r = await api.clanCreate({
        wallet: getAddress(),
        name, tag,
        burn_tx: burnTx.hash,
        proof
      });
      if (r?.error) throw new Error(r.error);
      setStatus(t('clans.created'));
      nameInput.value = '';
      tagInput.value = '';
      await loadAll();
    } catch (e) {
      console.error('[clan/create]', e);
      setStatus(e.shortMessage || e.message || t('common.error'), true);
    } finally {
      createBtn.disabled = false;
    }
  }

  async function doJoin(clanId) {
    if (!isConnected()) { setStatus(t('common.connect_first'), true); return; }
    setStatus(t('clans.joining'));
    try {
      const proof = await signClanAction('JoinClan');
      const r = await api.clanJoin({ wallet: getAddress(), clan_id: clanId, proof });
      if (r?.error) throw new Error(r.error);
      setStatus(t('clans.joined'));
      await loadAll();
    } catch (e) {
      setStatus(e.shortMessage || e.message || t('common.error'), true);
    }
  }

  async function doLeave() {
    if (!isConnected() || !state.mine) return;
    if (!confirm(`${t('clans.leave')} ${state.mine.name}?`)) return;
    setStatus(t('clans.leaving'));
    try {
      const proof = await signClanAction('LeaveClan');
      const r = await api.clanLeave({ wallet: getAddress(), proof });
      if (r?.error) throw new Error(r.error);
      setStatus(t('clans.left'));
      state.mine = null;
      await loadAll();
    } catch (e) {
      setStatus(e.shortMessage || e.message || t('common.error'), true);
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
