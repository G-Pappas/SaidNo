# SaidNo

**You said no. Did they listen?**

A browser extension that says **no** to cookie popups, fixes the pages that break when you do, and shows you which trackers the site contacted **after** you declined.

It is a community project: no company, no telemetry, no accounts, no servers. Everything runs on your device.

## What it does

1. **Declines cookie popups.** It uses DuckDuckGo's open-source [autoconsent](https://github.com/duckduckgo/autoconsent) engine, which knows how to answer "reject" on hundreds of consent platforms (OneTrust, Sourcepoint, Didomi, Google Funding Choices, …) and recognises unknown banners heuristically.
2. **Fixes what's left behind.** Some sites remove the banner but leave the page locked: scrolling disabled, a dark film over the page, blurred content, clicks blocked. SaidNo undoes these, and hides banners that offer no way to refuse at all. It only touches a page after a banner was handled, so a site's own menus and dialogs are left alone.
3. **Shows who tracks you anyway.** After a decline, it records requests to known trackers. The badge shows how many were contacted: amber for requests, red if a tracker also **set cookies** after you said no, which is the strongest sign your choice was ignored.

Under the GDPR, hiding a banner without answering also means *no consent*, so tracking after a hidden banner is reported too.

## Install (development build)

```sh
npm ci --ignore-scripts
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick the `dist/` folder. Works in Chromium, Chrome, Brave, Edge and other Chromium browsers.

## Tests

```sh
npm test
```

Runs unit tests, builds, then loads `dist/` into headless Chromium and visits hostile fixture pages in `test/fixtures/`:

- `banner.html`: rejecting removes the banner but leaves the page locked and dark, and the site keeps calling a tracker that sets a cookie.
- `no-reject.html`: a banner with no way to refuse.
- `own-menu.html`: no banner at all; the site's own scroll lock must **not** be touched.

Fake third-party hosts are mapped to a local server, so the tests never touch the network. Set `CHROMIUM=/path/to/binary` if `chromium` isn't on your PATH. (Branded Google Chrome no longer accepts `--load-extension`; use Chromium.)

## Security

See [SECURITY.md](SECURITY.md). The short version: no remote code, no network requests, minimal permissions, reproducible builds. An extension that reads every page you visit is itself the biggest risk, so those rules come before features.

## Roadmap

- Bundle the full Public Suffix List (currently a small built-in subset) for exact first/third-party decisions.
- Larger tracker list, imported at build time from an open dataset.
- "File a complaint" helper: turn a "tracked after decline" finding into a ready GDPR complaint or data-access request.
- Signed rule updates between releases, without allowing code updates.
- Firefox build.
- Undo per-site repairs from the popup when a fix goes wrong.

## Credits and license

- Consent handling: [@duckduckgo/autoconsent](https://github.com/duckduckgo/autoconsent) (MPL-2.0).
- SaidNo itself is licensed under the [Mozilla Public License 2.0](LICENSE).
