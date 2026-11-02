// Domain helpers. No network access: everything is matched against bundled data.

import trackers from './trackers.json' with { type: 'json' };

// Suffixes where the "site" is three labels deep (example.co.uk, not co.uk).
// This is a deliberately small subset of the Public Suffix List; bundling the
// full list is on the roadmap.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'co.za', 'co.jp', 'co.kr', 'co.in', 'co.il',
  'com.br', 'com.mx', 'com.ar', 'com.tr', 'com.cn', 'com.tw', 'com.hk', 'com.sg',
  'com.gr', 'org.gr', 'net.gr', 'edu.gr', 'gov.gr',
  'com.cy', 'ac.cy', 'gov.cy',
]);

/** Registrable domain ("site") of a hostname, e.g. www.bbc.co.uk -> bbc.co.uk. */
export function siteOf(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(host) || host.includes(':')) return host; // IP address
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return labels.slice(MULTI_PART_SUFFIXES.has(lastTwo) ? -3 : -2).join('.');
}

/** Known tracker entry for a hostname, matching it or any parent domain. */
export function matchTracker(hostname) {
  const labels = hostname.toLowerCase().split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const domain = labels.slice(i).join('.');
    const entry = trackers[domain];
    if (entry) return { domain, owner: entry[0], category: entry[1] };
  }
  return null;
}
