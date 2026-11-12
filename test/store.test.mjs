// ?ui5= from a link (isLinkableUi5( ) in src/ui/store.js) takes only this
// server, localhost and SAP's CDNs - judged by where the browser resolves
// the value, so a "path" that names another host is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.location ??= new URL('http://127.0.0.1:8080/index.html');
const { isLinkableUi5 } = await import('../src/ui/store.js');

test('a link may name a version, local, a path on this server or a trusted host', () => {
  for (const v of ['1.71.80', 'local', 'local:1.71.80', '/ui5/mine/resources', './ui5/', '../ui5',
    'https://ui5.sap.com/1.71.80/', 'https://sdk.openui5.org/1.120.0', 'http://localhost:9999/ui5/', 'http://127.0.0.1:9999/ui5/']) {
    assert.equal(isLinkableUi5(v), true, v);
  }
});

test('a link may not name another host, also not dressed as a path', () => {
  for (const v of ['https://evil.example/ui5', '//evil.example/ui5', '/\\evil.example/ui5', '\\\\evil.example/ui5',
    '\\/evil.example/ui5', ' //evil.example/ui5', '/\t/evil.example/ui5', 'javascript:alert(1)']) {
    assert.equal(isLinkableUi5(v), false, JSON.stringify(v));
  }
});
