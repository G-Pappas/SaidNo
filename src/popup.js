import { siteOf } from './domains.js';
import { getSettings, updateSettings, isPaused } from './settings.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // never innerHTML: page-derived data stays text
  return node;
}

// Autoconsent names its generic detectors HEURISTIC-*; real CMPs keep their name.
const cmpName = (cmp) => (/^heuristic/i.test(cmp) ? 'recognised automatically' : cmp);

function describeStatus(state, paused) {
  if (paused) return ['Paused on this site.', ''];
  if (!state) return ['Reload the page to let SaidNo check it.', ''];
  switch (state.status) {
    case 'declined':
      return [`Said no to the cookie popup (${cmpName(state.cmp)}).`, 'ok'];
    case 'hidden':
      return [`Hid the cookie banner (${cmpName(state.cmp)}). The site got no answer, which legally means no consent.`, 'ok'];
    case 'failed':
      return [`Found a cookie popup (${cmpName(state.cmp)}) but could not decline it.`, 'bad'];
    default:
      return ['No cookie popup handled on this page.', ''];
  }
}

function renderTrackers(state) {
  if (!state?.handledAt) return;
  const after = Object.entries(state.trackers)
    .filter(([, t]) => t.after > 0)
    .sort(([, a], [, b]) => b.cookiesAfter - a.cookiesAfter || b.after - a.after);

  $('tracking').hidden = false;
  if (after.length === 0) {
    $('tracking-title').textContent = 'No known trackers contacted since you said no.';
    $('tracker-list').hidden = true;
    return;
  }
  $('tracking-title').textContent = `Still tracking: ${after.length} known tracker${after.length === 1 ? '' : 's'} contacted after you said no`;
  const list = $('tracker-list');
  for (const [domain, t] of after) {
    const item = el('li');
    const left = el('div');
    left.append(el('div', 'domain', domain), el('div', 'meta', `${t.owner} · ${t.category} · ${t.after} request${t.after === 1 ? '' : 's'}`));
    item.append(left);
    if (t.cookiesAfter > 0) item.append(el('span', 'cookies', 'set cookies'));
    list.append(item);
  }
}

async function main() {
  // popup.html?tab=<id> shows a specific tab (for tests and debugging).
  const tabParam = Number(new URLSearchParams(location.search).get('tab'));
  const [tab] = tabParam ? [await chrome.tabs.get(tabParam)] : await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await getSettings();

  let site = null;
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') site = siteOf(url.hostname);
  } catch {}

  for (const box of document.querySelectorAll('[data-setting]')) {
    box.checked = settings[box.dataset.setting];
    box.addEventListener('change', () => updateSettings({ [box.dataset.setting]: box.checked }));
  }

  if (!site) {
    $('site').textContent = '';
    $('status').textContent = 'SaidNo only works on web pages.';
    $('pause').disabled = true;
    return;
  }

  $('site').textContent = site;
  const paused = isPaused(settings, site);
  $('pause').checked = paused;
  $('pause').addEventListener('change', async () => {
    const current = (await getSettings()).pausedSites.filter((s) => s !== site);
    await updateSettings({ pausedSites: $('pause').checked ? [...current, site] : current });
    chrome.tabs.reload(tab.id);
    window.close();
  });

  const state = await chrome.runtime.sendMessage({ type: 'saidno:getTab', tabId: tab.id });
  const [text, tone] = describeStatus(state, paused);
  $('status').textContent = text;
  if (tone) $('status').classList.add(tone);
  renderTrackers(state);
}

main();
