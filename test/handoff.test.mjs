// The hand-off links (src/handoff.js) decode the way their readers decode
// them: the playground's share fragment as src/shell/share.mjs in
// abap2UI5/playground reads it (one version character "2", base64url,
// deflate-raw, a JSON array of { name, source }), the VS Code link as the
// abap2UI5 extension's URI handler reads it (?code= base64url deflate-raw,
// ?name= the file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allDesigns } from './fixtures.mjs';
import { generateClass } from '../src/abap.js';
import { playgroundLink, playgroundFragment, vscodeLink, PLAYGROUND_URL } from '../src/handoff.js';

const fromBase64Url = (text) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
const inflate = async (bytes) => new TextDecoder().decode(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());

const source = generateClass(allDesigns()[0][1]);

test('the playground link carries the class as the playground reads a share link', async () => {
  const href = await playgroundLink('zcl_my_app.clas.abap', source);
  const url = new URL(href);
  assert.equal(`${url.origin}${url.pathname}`, PLAYGROUND_URL);
  assert.equal(url.search, '');
  const fragment = url.hash.slice(1);
  assert.equal(fragment[0], '2', 'version 2: a list of files');
  assert.match(fragment.slice(1), /^[A-Za-z0-9_-]+$/, 'base64url, no padding');
  assert.deepEqual(JSON.parse(await inflate(fromBase64Url(fragment.slice(1)))), [{ name: 'zcl_my_app.clas.abap', source }]);
});

test('the playground base URL is configurable, its query is dropped', async () => {
  const href = await playgroundLink('zcl_x.clas.abap', 'CLASS zcl_x DEFINITION.', 'http://127.0.0.1:5173/?src=x#old');
  assert.ok(href.startsWith('http://127.0.0.1:5173/#2'));
  assert.equal(await playgroundFragment([{ name: 'zcl_x.clas.abap', source: 'CLASS zcl_x DEFINITION.' }]), new URL(href).hash.slice(1));
});

test('the VS Code link carries the class for the extension\'s URI handler', async () => {
  const href = await vscodeLink('zcl_my_app.clas.abap', source);
  assert.ok(href.startsWith('vscode://abap2ui5.abap2ui5/open?'));
  const params = new URL(href).searchParams;
  assert.equal(params.get('name'), 'zcl_my_app.clas.abap');
  assert.equal(await inflate(fromBase64Url(params.get('code'))), source);
});
