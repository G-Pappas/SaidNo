// Service worker: drives autoconsent, records trackers per tab, updates the badge.
//
// Security rules for this file (see SECURITY.md):
// - Never execute code that came from a page. Main-world evals only run
//   functions from autoconsent's bundled allowlist (evalSnippets), by id.
// - No network requests. The extension CSP (connect-src 'self') enforces it.
// - webRequest is used to observe only; nothing here can modify traffic.

import { evalSnippets, filterCompactRules } from '@duckduckgo/autoconsent';
import compactRules from '@duckduckgo/autoconsent/rules/compact-rules.json';
import { siteOf, matchTracker } from './domains.js';
import { getSettings, isPaused } from './settings.js';

const AUTOCONSENT_CONFIG = {
  enabled: true,
  autoAction: 'optOut',
  disabledCmps: [],
  enablePrehide: true,
  enableCosmeticRules: true,
  enableGeneratedRules: true,
  enableHeuristicDetection: true,
  enablePopupMutationObserver: true,
  heuristicMode: 'tier1',
  detectRetries: 20,
  isMainWorld: false,
  prehideTimeout: 2000,
  visualTest: false,
  logs: {
    lifecycle: false,
    rulesteps: false,
    detectionsteps: false,
    evals: false,
    errors: true,
    messages: false,
    waits: false,
  },
};

// ---- Per-tab state -------------------------------------------------------
// Kept in memory and mirrored to chrome.storage.session (memory-only, cleared
// when the browser closes) so it survives the service worker being suspended.

/** @type {Map<number, Promise<object|null>>} */
const tabStates = new Map();
const saveTimers = new Map();

function newTabState(url) {
  return {
    url,
    site: siteOf(new URL(url).hostname),
    status: 'none', // none | declined | hidden | failed | paused
    cmp: null,
    handledAt: null, // when the banner was declined or hidden
    trackers: {}, // domain -> { owner, category, before, after, cookiesAfter }
  };
}

function loadTab(tabId) {
  if (!tabStates.has(tabId)) {
    const key = `tab:${tabId}`;
    tabStates.set(tabId, chrome.storage.session.get(key).then((r) => r[key] ?? null));
  }
  return tabStates.get(tabId);
}

/**
 * Run `fn` on the tab's state, serialised per tab so updates never interleave.
 * `fn` returns a new state object, or anything falsy to keep the current one.
 */
function withTab(tabId, fn) {
  const next = loadTab(tabId).then(async (state) => {
    const updated = (await fn(state)) || state;
    if (updated) scheduleSave(tabId, updated);
    return updated;
  });
  tabStates.set(tabId, next.catch(() => null));
  return next;
}

function scheduleSave(tabId, state) {
  clearTimeout(saveTimers.get(tabId));
  saveTimers.set(
    tabId,
    setTimeout(() => {
      chrome.storage.session.set({ [`tab:${tabId}`]: state });
      updateBadge(tabId, state);
    }, 250),
  );
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  clearTimeout(saveTimers.get(tabId));
  chrome.storage.session.remove(`tab:${tabId}`);
});

// ---- Badge ---------------------------------------------------------------

function trackersAfter(state) {
  return Object.values(state.trackers).filter((t) => t.after > 0);
}

function updateBadge(tabId, state) {
  const after = state.handledAt ? trackersAfter(state) : [];
  let text = '';
  let color = '#1a7f37';
  if (after.length > 0) {
    text = String(after.length);
    color = after.some((t) => t.cookiesAfter > 0) ? '#cf222e' : '#bf8700';
  } else if (state.status === 'declined' || state.status === 'hidden') {
    text = '✓';
  }
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

// ---- Network observation -------------------------------------------------

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    withTab(details.tabId, () => newTabState(details.url));
  },
  { urls: ['<all_urls>'], types: ['main_frame'] },
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || details.type === 'main_frame') return;
    let host;
    try {
      host = new URL(details.url).hostname;
    } catch {
      return;
    }
    const tracker = matchTracker(host);
    if (!tracker) return;
    const setsCookie = (details.responseHeaders ?? []).some((h) => h.name.toLowerCase() === 'set-cookie');
    withTab(details.tabId, async (state) => {
      if (!state || siteOf(host) === state.site) return;
      if (!(await getSettings()).detect) return;
      const entry = (state.trackers[tracker.domain] ??= {
        owner: tracker.owner,
        category: tracker.category,
        before: 0,
        after: 0,
        cookiesAfter: 0,
      });
      if (state.handledAt && details.timeStamp >= state.handledAt) {
        entry.after++;
        if (setsCookie) entry.cookiesAfter++;
      } else {
        entry.before++;
      }
    });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders'],
);

// ---- Messages from content scripts and the popup -------------------------

const reply = (tabId, frameId, message) => chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => {});

async function handleContentMessage(msg, sender) {
  const tabId = sender.tab.id;
  const frameId = sender.frameId;
  const topSite = siteOf(new URL(sender.tab.url || sender.url).hostname);

  switch (msg.type) {
    case 'init': {
      const settings = await getSettings();
      const paused = isPaused(settings, topSite);
      if (frameId === 0) {
        // Normally created on the main_frame request; this covers a worker that wasn't listening yet.
        withTab(tabId, (s) => {
          const state = s ?? newTabState(sender.tab.url || sender.url);
          return paused ? { ...state, status: 'paused' } : state;
        });
      }
      const rules = { autoconsent: [], compact: filterCompactRules(compactRules, { url: msg.url || sender.url, mainFrame: frameId === 0 }) };
      reply(tabId, frameId, { type: 'initResp', rules, config: { ...AUTOCONSENT_CONFIG, enabled: settings.decline && !paused } });
      break;
    }
    case 'eval': {
      // Only allowlisted, bundled functions. A page cannot inject its own code here.
      const snippet = Object.hasOwn(evalSnippets, msg.snippetId) ? evalSnippets[msg.snippetId] : null;
      let result = false;
      if (snippet) {
        try {
          const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func: snippet });
          result = res?.result ?? false;
        } catch {
          result = false;
        }
      }
      reply(tabId, frameId, { type: 'evalResp', id: msg.id, result });
      break;
    }
    case 'optOutResult':
      if (!msg.result) withTab(tabId, (s) => s && s.status === 'none' && { ...s, status: 'failed', cmp: msg.cmp });
      break;
    case 'autoconsentDone':
      withTab(tabId, (s) => s && { ...s, status: msg.isCosmetic ? 'hidden' : 'declined', cmp: msg.cmp, handledAt: s.handledAt ?? Date.now() });
      // Popups in iframes lock the top page; tell its cleanup to repair it.
      if (frameId !== 0) reply(tabId, 0, { type: 'saidno:handled' });
      break;
    case 'saidno:hidden': // our own heuristic cleanup hid a banner autoconsent didn't handle
      withTab(tabId, (s) => s && s.status !== 'declined' && { ...s, status: 'hidden', cmp: s.cmp ?? 'generic banner', handledAt: s.handledAt ?? Date.now() });
      break;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return;

  // Our own pages (the popup) are identified by origin; content scripts run on web origins.
  if (sender.origin === location.origin) {
    if (msg.type === 'saidno:getTab' && Number.isInteger(msg.tabId)) {
      loadTab(msg.tabId).then(sendResponse);
      return true;
    }
    return;
  }

  if (sender.tab) handleContentMessage(msg, sender);
});
