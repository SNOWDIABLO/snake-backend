/* ===================================================================
   SnowDiablo Arcade — HUB entry
   Page: /index.html
   =================================================================== */

import './theme.css';
import { initHeader } from './header.js';
import { initFooter } from './footer.js';
import { startLiveStats } from './stats.js';

initHeader('hdr');
initFooter('ftr');
startLiveStats();
