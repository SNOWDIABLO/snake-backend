/* ===================================================================
   SnowDiablo Arcade — Shared Footer
   Injected into <div id="ftr"></div>.
   =================================================================== */

const SNAKE_ADDR = '0x25e5Af25f5D8d87Df779f5eeA32dc7478663e9a1';

const FOOTER_CSS = `
.sd-footer {
  margin-top: var(--sp-12);
  padding: var(--sp-10) 0 var(--sp-8);
  border-top: 1px solid var(--line);
  background: var(--bg-1);
  color: var(--text-dim);
  font-size: 0.85rem;
  font-family: var(--ff-mono);
}
.sd-footer-inner {
  max-width: 1320px; margin: 0 auto; padding: 0 var(--sp-6);
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--sp-8);
}
.sd-footer-col h4 {
  font-size: 0.72rem; font-weight: 800; letter-spacing: 1.5px;
  color: var(--neon-green);
  margin-bottom: var(--sp-3);
  text-transform: uppercase;
}
.sd-footer-col h4::before { content: '// '; color: var(--text-faint); }
.sd-footer-col a {
  display: block; padding: 4px 0;
  color: var(--text-dim);
  transition: color 0.15s;
}
.sd-footer-col a:hover { color: var(--neon-green); }
.sd-footer-bottom {
  max-width: 1320px; margin: var(--sp-8) auto 0; padding: var(--sp-6) var(--sp-6) 0;
  border-top: 1px solid var(--line);
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-3);
  font-size: 0.72rem; color: var(--text-faint);
}
.sd-contract-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px;
  font-family: var(--ff-mono);
  font-size: 0.7rem;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: 3px;
  color: var(--text-dim);
}
.sd-contract-pill code { color: var(--neon-green); }
`;

function inject() {
  if (document.getElementById('sd-footer-css')) return;
  const s = document.createElement('style');
  s.id = 'sd-footer-css';
  s.textContent = FOOTER_CSS;
  document.head.appendChild(s);
}

export function initFooter(mountId = 'ftr') {
  inject();
  const mount = document.getElementById(mountId);
  if (!mount) return;

  const year = new Date().getFullYear();
  mount.innerHTML = `
    <footer class="sd-footer">
      <div class="sd-footer-inner">
        <div class="sd-footer-col">
          <h4>Arcade</h4>
          <a href="/">Hub</a>
          <a href="/snake/">Snake</a>
          <a href="/leaderboard/">Leaderboard</a>
          <a href="/profile/">Profile</a>
        </div>
        <div class="sd-footer-col">
          <h4>Economy</h4>
          <a href="/lp-fund/">LP Fund Tracker</a>
          <a href="https://polygonscan.com/address/${SNAKE_ADDR}" target="_blank" rel="noopener">$SNAKE Contract</a>
          <a href="https://polygonscan.com/address/${SNAKE_ADDR}#tokentxns" target="_blank" rel="noopener">Token Txns</a>
        </div>
        <div class="sd-footer-col">
          <h4>Social</h4>
          <a href="https://twitter.com/SnowDiablo" target="_blank" rel="noopener">Twitter / X</a>
          <a href="https://twitch.tv/snowdiablo" target="_blank" rel="noopener">Twitch</a>
          <a href="https://t.me/snowdiablotv" target="_blank" rel="noopener">Telegram</a>
          <a href="https://github.com/SnowDiablo" target="_blank" rel="noopener">GitHub</a>
        </div>
        <div class="sd-footer-col">
          <h4>About</h4>
          <p style="line-height:1.6;">
            SnowDiablo Arcade — skill-based Play-to-Earn on Polygon. Zero presale, zero team alloc. 100% mint via gameplay.
          </p>
        </div>
      </div>
      <div class="sd-footer-bottom">
        <span>© ${year} SnowDiablo — Built on Polygon</span>
        <span class="sd-contract-pill">$SNAKE <code>${SNAKE_ADDR.slice(0,6)}…${SNAKE_ADDR.slice(-4)}</code></span>
      </div>
    </footer>
  `;
}
