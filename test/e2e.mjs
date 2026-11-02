// End-to-end test: loads dist/ into a real headless Chromium and visits the fixture
// pages. Fake third-party hosts are mapped to a local server, so nothing leaves
// the machine.
//
//   npm run build && node test/e2e.mjs        (CHROMIUM=/path/to/chromium to override)

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const chromium = process.env.CHROMIUM || 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Local servers: fixtures over HTTP, a fake tracker over HTTPS -------------
// The tracker needs HTTPS because real tracker domains are HSTS-preloaded.

const profile = await mkdtemp(join(tmpdir(), 'saidno-e2e-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=declined-test',
  '-keyout', join(profile, 'key.pem'), '-out', join(profile, 'cert.pem')], { stdio: 'ignore' });

const handler = async (req, res) => {
  if (process.env.DEBUG) console.log('[server]', req.headers.host, req.url);
  if (req.headers.host.startsWith('www.google-analytics.com')) {
    res.writeHead(200, { 'content-type': 'image/gif', 'set-cookie': '_ga=GA1.1.123; Path=/' });
    return res.end();
  }
  try {
    const body = await readFile(join(root, 'test/fixtures', new URL(req.url, 'http://x').pathname));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
};
const server = createServer(handler);
const tlsServer = createHttpsServer({ key: await readFile(join(profile, 'key.pem')), cert: await readFile(join(profile, 'cert.pem')) }, handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
const port = server.address().port;
const tlsPort = tlsServer.address().port;

// ---- Chromium + a tiny CDP client ---------------------------------------------

const browser = spawn(chromium, [
  '--headless=new',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  '--no-first-run',
  '--no-default-browser-check',
  '--ignore-certificate-errors',
  `--disable-extensions-except=${join(root, 'dist')}`,
  `--load-extension=${join(root, 'dist')}`,
  '--host-resolver-rules=MAP site.test 127.0.0.1, MAP www.google-analytics.com 127.0.0.1',
  'about:blank',
], {
  // Arch's chromium launcher reads $XDG_CONFIG_HOME/chromium-flags.conf; point it at
  // the empty profile so the user's own flags (and extensions) stay out of the test.
  env: { ...process.env, XDG_CONFIG_HOME: profile },
});

async function devtoolsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const [portLine, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n');
      return `ws://127.0.0.1:${portLine}${path}`;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Chromium did not start');
}

const ws = new WebSocket(await devtoolsUrl());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

async function evaluate(sessionId, expression) {
  const { result, exceptionDetails } = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function extensionWorker() {
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await cdp('Target.getTargets');
    for (const sw of targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'))) {
      const { sessionId } = await cdp('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
      const name = await evaluate(sessionId, `globalThis.chrome?.runtime?.getManifest?.().name`).catch(() => null);
      if (name === 'SaidNo') return sessionId;
      await cdp('Target.detachFromTarget', { sessionId });
    }
    await sleep(100);
  }
  throw new Error('Extension service worker not found. Is dist/ built, and does this Chromium allow --load-extension?');
}

// ---- Tests --------------------------------------------------------------------

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`✔ ${name}`);
  } catch (err) {
    failed++;
    console.log(`✖ ${name}\n  ${err.message.split('\n').join('\n  ')}`);
  }
}

const PAGE_STATE = `(() => {
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
  return {
    shown: Object.fromEntries([...document.querySelectorAll('[id], [class]')].map((el) => [el.id || el.className, shown(el)])),
    // overflow:hidden blocks the user, not scrollTo(), so check the lock itself.
    // body's overflow applies to the viewport when html's is 'visible'.
    scrollLocked: (() => {
      const locked = (el) => /hidden|clip/.test(getComputedStyle(el).overflowY);
      const htmlVisible = getComputedStyle(document.documentElement).overflowY === 'visible';
      return locked(document.documentElement) || (htmlVisible && locked(document.body));
    })(),
  };
})()`;

async function visit(worker, path, waitMs) {
  const { targetId } = await cdp('Target.createTarget', { url: `http://site.test:${port}/${path}` });
  const page = (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await sleep(waitMs);
  const state = await evaluate(page, PAGE_STATE);
  const stored = await evaluate(worker, `chrome.storage.session.get(null)`);
  const tab = Object.values(stored).find((s) => s?.url?.includes(`/${path.split('?')[0]}`));
  if (process.env.DEBUG) console.log('[stored]', JSON.stringify(stored));
  await cdp('Target.closeTarget', { targetId });
  return { ...state, tab };
}

try {
  const worker = await extensionWorker();

  console.log('security');
  await check('extension worker cannot make network requests (CSP)', async () => {
    const result = await evaluate(worker, `fetch('https://www.google-analytics.com:${tlsPort}/').then(() => 'allowed', () => 'blocked')`);
    assert.equal(result, 'blocked');
  });

  console.log('banner.html: rejecting leaves the page broken, and the site tracks anyway');
  {
    const r = await visit(worker, `banner.html?tracker=${tlsPort}`, 11000); // fallback (<=7s) + tracker (9s)
    await check('cookie banner is gone', () => assert.ok(!r.shown.banner));
    await check('leftover backdrop is removed', () => assert.equal(r.shown.backdrop, false));
    await check('page scrolls again', () => assert.equal(r.scrollLocked, false));
    await check('tab is recorded as declined', () => assert.equal(r.tab?.status, 'declined', JSON.stringify(r.tab)));
    await check('tracker contacted after decline is detected, with its cookie', () => {
      const ga = r.tab?.trackers?.['google-analytics.com'];
      assert.ok(ga, JSON.stringify(r.tab));
      assert.equal(ga.after, 1);
      assert.equal(ga.cookiesAfter, 1);
    });
  }

  console.log('no-reject.html: banner with no reject option');
  {
    const r = await visit(worker, 'no-reject.html', 8000);
    await check('banner is hidden', () => assert.equal(r.shown.cc, false, JSON.stringify(r.shown)));
    await check('backdrop is removed', () => assert.equal(r.shown.film, false));
    await check('page scrolls again', () => assert.equal(r.scrollLocked, false));
    await check('tab is recorded as declined or hidden', () => assert.match(r.tab?.status ?? 'missing', /^(declined|hidden)$/, JSON.stringify(r.tab)));
  }

  console.log("own-menu.html: no cookie banner; the site's own scroll lock must be left alone");
  {
    const r = await visit(worker, 'own-menu.html', 8000);
    await check('menu is untouched', () => assert.equal(r.shown.menu, true));
    await check('scroll lock is untouched', () => assert.equal(r.scrollLocked, true));
    await check('tab is recorded as nothing handled', () => assert.equal(r.tab?.status, 'none', JSON.stringify(r.tab)));
  }
} finally {
  ws.close();
  browser.kill();
  server.close();
  tlsServer.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
