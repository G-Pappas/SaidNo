// Cleanup: the part autoconsent doesn't do.
//  1. Hide cookie banners that no autoconsent rule recognised (heuristics).
//  2. After a banner is declined or hidden, undo what sites leave behind:
//     locked scrolling, dark backdrops, blurred content, disabled clicks.
// Only runs in the top frame, and only touches the page after a banner was handled,
// so it never "fixes" a site's own menus or dialogs on pages without a banner.

import { siteOf } from './domains.js';
import { getSettings, isPaused } from './settings.js';

const CONSENT_TEXT = /cookie|consent|gdpr|ccpa|datenschutz|privacidad|confidentialit|συγκατάθεσ|συναίνεσ|απορρήτ/i;
const CLICKABLE = 'button, a[href], [role="button"], input[type="button"], input[type="submit"]';
const MAX_ELEMENTS = 6000;

const isTop = window === window.top;

export function createCleanup(send) {
  const noop = { onAutoconsentMessage() {}, onBackgroundMessage() {} };
  if (!isTop) return noop;

  let enabled = null; // unknown until settings load
  let handled = false;
  const pending = [];
  const whenEnabled = (fn) => (enabled === null ? pending.push(fn) : enabled && fn());

  getSettings().then((settings) => {
    enabled = settings.cleanup && !isPaused(settings, siteOf(location.hostname));
    if (enabled) pending.forEach((fn) => fn());
    pending.length = 0;
  });

  function afterHandled() {
    if (handled) return;
    handled = true;
    // Sites often re-apply the lock a moment after the banner closes.
    for (const delay of [300, 1200, 3000]) setTimeout(repairPage, delay);
    // Autoconsent can report success while a banner stays up (e.g. no reject button).
    setTimeout(fallbackPass, 1500);
  }

  function fallbackPass() {
    const hidden = hideUnknownBanners();
    if (hidden > 0) {
      send({ type: 'saidno:hidden', count: hidden });
      afterHandled();
    }
  }

  onReady(() => {
    // Give autoconsent time first; only then fall back to heuristics.
    setTimeout(() => whenEnabled(fallbackPass), 2500);
    setTimeout(() => whenEnabled(fallbackPass), 7000);
  });

  return {
    onAutoconsentMessage(msg) {
      if (msg.type === 'autoconsentDone') whenEnabled(afterHandled);
    },
    onBackgroundMessage(msg) {
      // A consent popup inside an iframe was handled; the lock is on this page.
      if (msg.type === 'saidno:handled') whenEnabled(afterHandled);
    },
  };
}

function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

function isVisible(el, style) {
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function forceStyle(el, prop, value) {
  el.style.setProperty(prop, value, 'important');
}

/** Hide fixed/sticky overlays that look like cookie banners. Returns how many were hidden. */
export function hideUnknownBanners() {
  if (!document.body) return 0;
  const matches = [];
  const all = document.body.getElementsByTagName('*');
  for (let i = 0; i < all.length && i < MAX_ELEMENTS; i++) {
    const el = all[i];
    const style = getComputedStyle(el);
    const floating = style.position === 'fixed' || style.position === 'sticky' || (el.tagName === 'DIALOG' && el.open);
    if (!floating || !isVisible(el, style)) continue;
    const text = el.innerText || '';
    if (text.length < 30 || text.length > 4000 || !CONSENT_TEXT.test(text)) continue;
    if (!el.querySelector(CLICKABLE)) continue;
    if (el.querySelector('input[type="password"]')) continue; // never hide login forms
    matches.push(el);
  }
  // Keep only the outermost match of each nested group.
  const outermost = matches.filter((el) => !matches.some((other) => other !== el && other.contains(el)));
  for (const el of outermost) {
    forceStyle(el, 'display', 'none');
    el.setAttribute('data-saidno-hidden', '');
  }
  return outermost.length;
}

/** Undo scroll locks, backdrops, blur and click-blocking left behind by a banner. */
export function repairPage() {
  const html = document.documentElement;
  const body = document.body;
  if (!body) return;

  // Scroll locks via overflow.
  if (isLocked(getComputedStyle(html))) forceStyle(html, 'overflow-y', 'auto');
  if (isLocked(getComputedStyle(body))) forceStyle(body, 'overflow-y', 'visible');

  // Scroll lock via `body { position: fixed; top: -<scroll>px }`.
  const bodyStyle = getComputedStyle(body);
  if (bodyStyle.position === 'fixed') {
    const offset = -parseInt(bodyStyle.top, 10) || 0;
    forceStyle(body, 'position', 'static');
    window.scrollTo(0, offset);
  }

  for (const el of [html, body]) {
    if (getComputedStyle(el).pointerEvents === 'none') forceStyle(el, 'pointer-events', 'auto');
  }

  for (const el of body.children) {
    const style = getComputedStyle(el);
    if (style.filter.includes('blur')) forceStyle(el, 'filter', 'none');
    if (isBackdrop(el, style)) {
      forceStyle(el, 'display', 'none');
      el.setAttribute('data-saidno-hidden', '');
    }
  }
}

function isLocked(style) {
  return style.overflowY === 'hidden' || style.overflowY === 'clip';
}

/** A fixed, near-viewport-sized, contentless layer: the dark film behind a modal. */
function isBackdrop(el, style) {
  if (style.position !== 'fixed' || !isVisible(el, style)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < innerWidth * 0.9 || rect.height < innerHeight * 0.9) return false;
  if ((el.innerText || '').trim().length > 0) return false;
  if (el.querySelector('img, video, canvas, iframe, svg, input')) return false;
  return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.backdropFilter !== 'none';
}
