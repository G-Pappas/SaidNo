// User settings, kept in chrome.storage.local (never synced, never sent anywhere).

export const DEFAULT_SETTINGS = {
  decline: true, // answer consent popups with "reject"
  cleanup: true, // hide leftover banners and unlock pages after a decline
  detect: true, // record trackers contacted after a decline
  pausedSites: [], // sites where SaidNo does nothing
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function updateSettings(change) {
  const settings = { ...(await getSettings()), ...change };
  await chrome.storage.local.set({ settings });
  return settings;
}

export function isPaused(settings, site) {
  return settings.pausedSites.includes(site);
}
