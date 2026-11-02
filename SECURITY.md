# Security model

SaidNo can read every page you visit. That makes the extension itself the most dangerous thing about it: if it is compromised, sold, or careless, it becomes the spyware it is meant to fight. These rules exist so that can't happen quietly. A change that breaks one of them needs an explicit discussion, not just a review.

## Rules

1. **No remote code.** Every line that runs ships in the reviewed release. The extension never downloads or `eval`s code. Rule *data* may be updated in the future, but only signed, and never code.
2. **Pages can't make it run their code.** Some consent platforms can only be answered from the page's own JavaScript context. For those, the background worker runs only functions from autoconsent's bundled allowlist (`evalSnippets`), looked up by id. A page can ask for an id, never send code.
3. **No network access.** The extension makes no requests of its own: no telemetry, no update pings, no "cloud" features. The extension CSP (`connect-src 'self'`) enforces this for the background worker and the popup, and an end-to-end test checks it.
4. **Observe, never modify, traffic.** `webRequest` is used read-only. The extension can't redirect, block, or rewrite requests.
5. **Minimal permissions.** `scripting` (allowlisted evals), `storage` (settings, per-tab results), `webRequest` (observing tracker requests), and host access (to run on pages). No `tabs`, `cookies`, `history`, `downloads`, `nativeMessaging`, or `management`.
6. **Data stays local and short-lived.** Per-tab results live in `chrome.storage.session`, which is memory-only and cleared when the browser closes. Settings live in `chrome.storage.local` and are never synced.
7. **Page data is rendered as text.** The popup uses `textContent` only, never `innerHTML`.
8. **Reproducible builds.** Dependencies are pinned exactly and locked in `package-lock.json`. `npm run build` prints a SHA-256 over `dist/`. Anyone can rebuild a release tag and compare it with the published package.
9. **No install scripts.** Install with `npm ci --ignore-scripts`. The build doesn't need them.

## Governance (to set up before a public release)

- At least two maintainers with release rights, hardware-key 2FA on all accounts, and signed release tags.
- Store listings owned by a shared organisation account, not a person.
- The project is not for sale. Ownership should sit with a non-profit host (e.g. Codeberg e.V. or a fiscal host), so it can't be bought and turned into adware the way popular extensions have been.

## Reporting a vulnerability

Please don't open a public issue. Email the maintainers (address to be added before release) with steps to reproduce. You'll get a reply within a week.
