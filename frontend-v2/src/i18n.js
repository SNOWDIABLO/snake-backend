/* ===================================================================
   SnowDiablo Arcade — i18n
   Lightweight loader for /public/locales/<lang>.json
   Fallback: english. Lang persisted in localStorage.
   =================================================================== */

const LS_LANG = 'sd_lang';
const DEFAULT_LANG = 'en';
const SUPPORTED = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru', 'ar', 'tr', 'id'];

let _strings = {};
let _lang = DEFAULT_LANG;

function detect() {
  const saved = localStorage.getItem(LS_LANG);
  if (saved && SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED.includes(nav) ? nav : DEFAULT_LANG;
}

export async function initI18n(ns = 'common') {
  _lang = detect();
  try {
    const res = await fetch(`/locales/${_lang}/${ns}.json`);
    if (res.ok) _strings = await res.json();
    else if (_lang !== DEFAULT_LANG) {
      const fb = await fetch(`/locales/${DEFAULT_LANG}/${ns}.json`);
      if (fb.ok) _strings = await fb.json();
    }
  } catch (err) {
    console.warn('[i18n] load failed', err);
    _strings = {};
  }
  applyTranslations(document.body);
  return _lang;
}

export function t(key, vars = {}) {
  const raw = _strings[key] || key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function getLang() { return _lang; }

export async function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  localStorage.setItem(LS_LANG, lang);
  window.location.reload();
}

export const SUPPORTED_LANGS = SUPPORTED;

// Auto-translate elements with data-i18n / data-i18n-attr
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated !== key) el.textContent = translated;
  });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    // format: data-i18n-attr="placeholder:key,title:key"
    const pairs = el.getAttribute('data-i18n-attr').split(',');
    pairs.forEach(p => {
      const [attr, key] = p.split(':').map(s => s.trim());
      if (attr && key) {
        const val = t(key);
        if (val !== key) el.setAttribute(attr, val);
      }
    });
  });
}
