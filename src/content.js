// Content script, injected into every frame at document_start.
// Runs autoconsent (the decliner) and our cleanup of what is left behind.

import AutoConsent from '@duckduckgo/autoconsent';
import { createCleanup } from './cleanup.js';

const cleanup = createCleanup((msg) => chrome.runtime.sendMessage(msg).catch(() => {}));

const consent = new AutoConsent((msg) => {
  cleanup.onAutoconsentMessage(msg);
  return chrome.runtime.sendMessage(msg).catch(() => {});
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type?.startsWith('saidno:')) cleanup.onBackgroundMessage(message);
  else consent.receiveMessageCallback(message);
});
