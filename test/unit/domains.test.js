import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, matchTracker } from '../../src/domains.js';

test('siteOf reduces hostnames to the registrable site', () => {
  assert.equal(siteOf('www.example.com'), 'example.com');
  assert.equal(siteOf('a.b.example.com'), 'example.com');
  assert.equal(siteOf('news.bbc.co.uk'), 'bbc.co.uk');
  assert.equal(siteOf('www.skroutz.com.gr'), 'skroutz.com.gr');
  assert.equal(siteOf('example.com.'), 'example.com');
  assert.equal(siteOf('127.0.0.1'), '127.0.0.1');
  assert.equal(siteOf('localhost'), 'localhost');
});

test('matchTracker matches a domain and its subdomains only', () => {
  assert.equal(matchTracker('www.google-analytics.com').owner, 'Google');
  assert.equal(matchTracker('stats.g.doubleclick.net').domain, 'doubleclick.net');
  assert.equal(matchTracker('connect.facebook.net').owner, 'Meta');
  assert.equal(matchTracker('notdoubleclick.net'), null);
  assert.equal(matchTracker('google.com'), null);
  assert.equal(matchTracker('example.com'), null);
});

test('matchTracker prefers the most specific entry', () => {
  assert.equal(matchTracker('bat.bing.com').owner, 'Microsoft');
  assert.equal(matchTracker('www.bing.com'), null);
});
