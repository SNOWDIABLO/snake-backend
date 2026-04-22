/* ===================================================================
   SnowDiablo Arcade — Shared Header
   Injected into <div id="hdr"></div> on every page.
   Handles: nav tabs, wallet connect button, active page highlight,
            i18n language switcher.
   =================================================================== */

import {
  connectInjected,
  connectWalletConnect,
  disconnect,
  autoRestore,
  onWalletChange,
  isConnected,
  getAddress
} from './wallet.js';
import { t, getLang, setLang, SUPPORTED_LANGS } from './i18n.js';

const NAV = [
  { href: '/',              labelKey: 'nav.hub',         key: 'hub' },
  { href: '/snake/',        labelKey: 'nav.snake',       key: 'snake',       badge: 'LIVE' },
  { href: '/leaderboard/',  labelKey: 'nav.leaderboard', key: 'leaderboard' },
  { href: '/profile/',      labelKey: 'nav.profile',     key: 'profile' },
  { href: '/lp-fund/',      labelKey: 'nav.lpfund',      key: 'lpfund' }
];

const LANG_NAMES = {
  en: 'English', fr: 'Français', es: 'Español', de: 'Deutsch', it: 'Italiano',
  pt: 'Português', ja: '日本語', ko: '한국어', zh: '中文', ru: 'Русский',
  ar: 'العربية', tr: 'Türkçe', id: 'Indonesia'
};

function shortAddr(a) {
  if (!a) return '';
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function currentKey() {
  const p = window.location.pathname.replace(/\/+$/, '');
  if (!p || p === '') return 'hub';
  if (p.startsWith('/snake'))       return 'snake';
  if (p.startsWith('/pong'))        return 'pong';
  if (p.startsWith('/flappy'))      return 'flappy';
  if (p.startsWith('/space-invaders')) return 'invaders';
  if (p.startsWith('/breakout'))    return 'breakout';
  if (p.startsWith('/minesweeper')) return 'minesweeper';
  if (p.startsWith('/2048'))        return '2048';
  if (p.startsWith('/leaderboard')) return 'leaderboard';
  if (p.startsWith('/profile'))     return 'profile';
  if (p.startsWith('/lp-fund'))     return 'lpfund';
  return 'hub';
}

const HEADER_CSS = `
.sd-header {
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  background: rgba(5, 5, 10, 0.75);
  border-bottom: 1px solid var(--border);
}
.sd-header-inner {
  max-width: 1280px; margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sp-4) var(--sp-6);
  gap: var(--sp-6);
}
.sd-logo {
  font-weight: 900; font-size: 1.15rem; letter-spacing: 2px;
  background: var(--gradient-main);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  white-space: nowrap;
  display: flex; align-items: center; gap: var(--sp-2);
}
.sd-logo::before { content: '◆'; color: var(--neon-green); -webkit-text-fill-color: var(--neon-green); }
.sd-nav {
  display: flex; gap: var(--sp-2); flex-wrap: wrap; align-items: center;
}
.sd-nav a {
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 0.85rem; font-weight: 600;
  color: var(--text-dim);
  border: 1px solid transparent;
  transition: all 0.15s var(--ease-out);
  display: inline-flex; align-items: center; gap: 6px;
}
.sd-nav a:hover { color: var(--text); border-color: var(--border); }
.sd-nav a.active {
  color: var(--neon-green);
  border-color: rgba(0, 255, 136, 0.4);
  background: rgba(0, 255, 136, 0.08);
}
.sd-nav .mini-badge {
  font-size: 0.55rem; padding: 1px 6px; border-radius: 10px;
  background: rgba(0,255,136,0.15); color: var(--neon-green);
  border: 1px solid rgba(0,255,136,0.4);
  letter-spacing: 1px; font-weight: 800;
}
.sd-right { display: flex; align-items: center; gap: var(--sp-3); }
.sd-lang-wrap { position: relative; }
.sd-lang-btn {
  padding: var(--sp-2) var(--sp-3);
  font-size: 0.8rem; font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 1px;
  cursor: pointer;
}
.sd-lang-btn:hover { color: var(--neon-green); border-color: var(--neon-green); }
.sd-lang-menu {
  position: absolute; right: 0; top: calc(100% + 6px);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--sp-2);
  min-width: 160px;
  max-height: 320px; overflow-y: auto;
  box-shadow: var(--shadow-card);
  display: none; z-index: 110;
}
.sd-lang-menu.open { display: block; }
.sd-lang-menu button {
  display: block; width: 100%; text-align: left;
  padding: 6px 10px;
  font-size: 0.85rem;
  color: var(--text-dim);
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.sd-lang-menu button:hover { background: var(--bg-2); color: var(--neon-green); }
.sd-lang-menu button.active { color: var(--neon-green); font-weight: 700; }
.sd-wallet-btn {
  display: inline-flex; align-items: center; gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  font-size: 0.85rem; font-weight: 700; letter-spacing: 0.5px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text);
  transition: all 0.2s var(--ease-out);
  white-space: nowrap;
}
.sd-wallet-btn:hover {
  border-color: var(--neon-green);
  color: var(--neon-green);
  box-shadow: 0 0 16px rgba(0, 255, 136, 0.2);
}
.sd-wallet-btn.connected {
  border-color: rgba(0, 255, 136, 0.5);
  color: var(--neon-green);
}
.sd-wallet-btn.connected::before { content: '●'; animation: pulse 1.5s ease-in-out infinite; }

/* Modal */
.sd-modal-backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: var(--sp-4);
  animation: sd-fade 0.2s var(--ease-out);
}
@keyframes sd-fade { from { opacity: 0; } to { opacity: 1; } }
.sd-modal {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--sp-8);
  max-width: 400px; width: 100%;
  box-shadow: var(--shadow-card), 0 0 48px rgba(0, 255, 136, 0.08);
}
.sd-modal h3 { font-size: 1.1rem; margin-bottom: var(--sp-4); color: var(--neon-green); letter-spacing: 1px; }
.sd-modal .choices { display: flex; flex-direction: column; gap: var(--sp-3); }
.sd-modal .choice {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  transition: all 0.15s;
  font-size: 0.9rem; font-weight: 600;
}
.sd-modal .choice:hover { border-color: var(--neon-green); color: var(--neon-green); transform: translateX(2px); }
.sd-modal .cancel { margin-top: var(--sp-4); color: var(--text-faint); font-size: 0.8rem; display: block; margin-left: auto; }

@media (max-width: 820px) {
  .sd-header-inner { flex-wrap: wrap; gap: var(--sp-3); }
  .sd-nav { order: 3; width: 100%; overflow-x: auto; }
  .sd-nav a { font-size: 0.75rem; padding: 4px 10px; }
}
`;

function injectCSS() {
  if (document.getElementById('sd-header-css')) return;
  const style = document.createElement('style');
  style.id = 'sd-header-css';
  style.textContent = HEADER_CSS;
  document.head.appendChild(style);
}

function render(mountId = 'hdr') {
  const mount = document.getElementById(mountId);
  if (!mount) {
    console.warn(`[header] #${mountId} not found`);
    return;
  }

  const active = currentKey();
  const navHtml = NAV.map(n => `
    <a href="${n.href}" class="${n.key === active ? 'active' : ''}">
      ${t(n.labelKey)}
      ${n.badge ? `<span class="mini-badge">${n.badge}</span>` : ''}
    </a>
  `).join('');

  const cur = getLang();
  const langMenuHtml = SUPPORTED_LANGS.map(l =>
    `<button data-lang="${l}" class="${l === cur ? 'active' : ''}">${LANG_NAMES[l] || l}</button>`
  ).join('');

  mount.innerHTML = `
    <header class="sd-header">
      <div class="sd-header-inner">
        <a href="/" class="sd-logo">SNOWDIABLO ARCADE</a>
        <nav class="sd-nav">${navHtml}</nav>
        <div class="sd-right">
          <div class="sd-lang-wrap">
            <button id="sd-lang-btn" class="sd-lang-btn" type="button" aria-label="${t('lang.label')}">${cur.toUpperCase()}</button>
            <div id="sd-lang-menu" class="sd-lang-menu">${langMenuHtml}</div>
          </div>
          <button id="sd-wallet" class="sd-wallet-btn" type="button">${t('wallet.connect')}</button>
        </div>
      </div>
    </header>
  `;

  // Wallet button
  const btn = document.getElementById('sd-wallet');
  btn.addEventListener('click', onWalletClick);

  // Language switcher
  const langBtn = document.getElementById('sd-lang-btn');
  const langMenu = document.getElementById('sd-lang-menu');
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langMenu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!langMenu.contains(e.target) && e.target !== langBtn) {
      langMenu.classList.remove('open');
    }
  });
  langMenu.querySelectorAll('button[data-lang]').forEach(b => {
    b.addEventListener('click', () => {
      setLang(b.dataset.lang);
    });
  });

  updateWalletBtn();
  onWalletChange(updateWalletBtn);
}

function updateWalletBtn() {
  const btn = document.getElementById('sd-wallet');
  if (!btn) return;
  if (isConnected()) {
    btn.classList.add('connected');
    btn.textContent = '';
    btn.insertAdjacentText('beforeend', ' ' + shortAddr(getAddress()));
  } else {
    btn.classList.remove('connected');
    btn.textContent = t('wallet.connect');
  }
}

function onWalletClick() {
  if (isConnected()) {
    openDisconnectModal();
  } else {
    openConnectModal();
  }
}

function openConnectModal() {
  const modal = document.createElement('div');
  modal.className = 'sd-modal-backdrop';
  modal.innerHTML = `
    <div class="sd-modal" role="dialog" aria-label="${t('wallet.title')}">
      <h3>${t('wallet.title')}</h3>
      <div class="choices">
        <button class="choice" data-type="injected">
          <span>${t('wallet.metamask')}</span>
          <span>→</span>
        </button>
        <button class="choice" data-type="walletconnect">
          <span>${t('wallet.walletconnect')}</span>
          <span>→</span>
        </button>
      </div>
      <button class="cancel" type="button">${t('wallet.cancel')}</button>
    </div>
  `;
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  modal.querySelector('.cancel').addEventListener('click', () => modal.remove());
  modal.querySelectorAll('.choice').forEach(c => {
    c.addEventListener('click', async () => {
      const type = c.dataset.type;
      modal.remove();
      try {
        if (type === 'injected')      await connectInjected();
        if (type === 'walletconnect') await connectWalletConnect();
      } catch (err) {
        alert(t('wallet.failed') + ': ' + (err.message || err));
      }
    });
  });
  document.body.appendChild(modal);
}

function openDisconnectModal() {
  const ok = confirm(t('wallet.disconnect_confirm'));
  if (ok) disconnect();
}

export function initHeader(mountId = 'hdr') {
  injectCSS();
  render(mountId);
  autoRestore().catch(() => {});
}
