/* ===================================================================
   SnowDiablo Arcade — HUB entry
   Page: /index.html
   =================================================================== */

import './theme.css';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { startLiveStats } from './stats.js';
import { initHub } from './hub.js';
import { initI18n } from './i18n.js';

(async () => {
  await initI18n('common');   // load locale strings before header/footer render
  initHeader('hdr');
  initFooter('ftr');
  startLiveStats();
  initHub();
})();
