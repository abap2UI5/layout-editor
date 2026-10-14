// The proof that a generated class does what the designer shows, on
// abap2UI5 itself: every starter and the kitchen sink (test/fixtures.mjs)
// is generated, transpiled against the framework with
// @abap2ui5/node-runtime (which type-checks it - a method that does not
// exist on z2ui5_if_client fails here), started on the transpiled framework,
// and its first roundtrip compared with the designer:
//   - the view it sends is the designer's XML view, attribute for attribute
//   - the model it sends is the preview's model, value for value
// and every event of the view is raised once and has to come back with
// on_event's message toast.
//
//   npm run verify:abap
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { toXml } from '../src/xml.js';
import { previewModel, collectEvents } from '../src/model.js';
import { writeClasses, WORK } from './gen-classes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const designs = await writeClasses();

console.log(`transpiling ${designs.length} classes against abap2UI5…`);
execFileSync('npx', ['abap2ui5-transpile', '.verify/abap', '.verify/apps'], { cwd: ROOT, stdio: 'inherit' });

const { initialize, serve } = await import('@abap2ui5/node-runtime');
await initialize({ draftSweepMs: false });
await import(`${WORK}/apps/index.mjs`);
const server = await serve({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${server.address().port}`;

async function post(sFront) {
  const res = await fetch(`${base}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: { S_FRONT: { ORIGIN: base, PATHNAME: '/', SEARCH: '', ...sFront } } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

const viewOf = (body) => (body.S_FRONT?.S_ACTION?.T_SYSTEM ?? []).find((a) => a[0] === 'VIEW_SLOTS' && a[1] === 'display' && a[2] === 'MAIN')?.[3];
// abap2UI5 wires an event as .eB(['NAME']), the designer's preview as
// .onEvent('NAME') - the same event, so both become EVENT(NAME)
const events = (xml) => xml.replace(/"\.eB\(\['([A-Z0-9_]+)'\]\)"/g, '"EVENT($1)"').replace(/"\.onEvent\('([A-Z0-9_]+)'\)"/g, '"EVENT($1)"');
const flat = (xml) => xml.replace(/>\s+</g, '><');

let failed = 0;
for (const [id, d] of designs) {
  try {
    const first = await post({ SEARCH: `?app_start=${d.className.toLowerCase()}` });
    assert.equal(first.S_FRONT.APP, d.className, 'the app that answered');
    const xml = viewOf(first);
    assert.ok(xml, `no view in the response: ${JSON.stringify(first).slice(0, 400)}`);
    assert.equal(events(xml), events(flat(toXml(d))), 'the view');
    assert.deepEqual(first.MODEL ?? {}, previewModel(d), 'the model');
    let draft = first.S_FRONT.ID;
    for (const ev of collectEvents(d)) {
      const res = await post({ ID: draft, EVENT: ev });
      draft = res.S_FRONT.ID;
      const text = JSON.stringify(res.S_FRONT?.S_ACTION ?? {});
      assert.ok(text.includes(`${ev} - implement me in on_event`), `event ${ev} reached on_event: ${text.slice(0, 300)}`);
    }
    console.log(`ok   ${id} (${d.className}): view, model and ${collectEvents(d).length} event(s)`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${id} (${d.className}): ${err.message}`);
  }
}
server.close();
process.exit(failed ? 1 : 0);
