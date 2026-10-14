// Dumps the UI5 metadata of every control in src/catalog.js - properties
// with their types, enum values, aggregations, the default aggregation and
// the events - from a real UI5 runtime, into test/ui5-<version>.json.
// test/catalog.test.mjs holds the catalogue to that file, so a property,
// an enum value or a default aggregation that does not exist in the
// release fails a test instead of a view on a customer's system.
//
//   UI5_RESOURCES=<OpenUI5 resources dir> node tools/ui5-metadata.mjs 1.71.80
//
// A resources dir can be assembled from the @openui5/* npm packages of the
// release (sap.ui.core, sap.m, sap.ui.layout, sap.ui.unified): copy each
// package's src/ into one folder. Without UI5_RESOURCES the CDN build of the
// version is used.
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { CONTROLS, NAMESPACES, splitType } from '../src/catalog.js';
import { startServer } from './serve.mjs';

const version = process.argv[2] || '1.71.80';
const server = await startServer(0);
const port = server.address().port;
const src = process.env.UI5_RESOURCES
  ? `http://127.0.0.1:${port}/ui5/resources/sap-ui-core.js`
  : `https://sdk.openui5.org/${version}/resources/sap-ui-core.js`;

const browser = await chromium.launch();
const page = await browser.newPage();
// the source-only bootstrap of a local tree document.write()s its core, so
// it has to be in the page as it loads - a page of our own, answered here
await page.route('**/boot.html', (route) => route.fulfill({
  contentType: 'text/html',
  body: `<!doctype html><html><head><script id="sap-ui-bootstrap" src="${src}" data-sap-ui-async="true"></script></head><body></body></html>`,
}));
await page.goto(`http://127.0.0.1:${port}/boot.html`);
await page.waitForFunction(() => window.sap && sap.ui && sap.ui.require && sap.ui.getCore && sap.ui.getCore().isInitialized && sap.ui.getCore().isInitialized(), null, { timeout: 120000 });

const modules = Object.fromEntries(Object.keys(CONTROLS).map((t) => {
  const { ns, name } = splitType(t);
  return [t, `${NAMESPACES[ns].replace(/\./g, '/')}/${name}`];
}));

const dump = await page.evaluate((mods) => new Promise((ok, fail) => {
  const keys = Object.keys(mods);
  sap.ui.require(['sap/ui/base/DataType', ...keys.map((k) => mods[k])], (DataType, ...classes) => {
    const out = { version: sap.ui.version, controls: {} };
    classes.forEach((C, i) => {
      if (!C) { out.controls[keys[i]] = null; return; }
      const md = C.getMetadata();
      const props = {};
      for (const [n, p] of Object.entries(md.getAllProperties())) {
        const type = p.type;
        const t = DataType.getType(type);
        const values = t && t.getEnumValues && t.getEnumValues() ? Object.keys(t.getEnumValues()) : undefined;
        props[n] = values ? { type, values } : { type };
      }
      const aggs = {};
      for (const [n, a] of Object.entries(md.getAllAggregations())) aggs[n] = { multiple: a.multiple, type: a.type };
      out.controls[keys[i]] = {
        className: md.getName(),
        props,
        aggs,
        defaultAgg: md.getDefaultAggregationName ? md.getDefaultAggregationName() || null : null,
        events: Object.keys(md.getAllEvents()).sort(),
      };
    });
    ok(out);
  }, fail);
}), modules);

await browser.close();
server.close();
const file = new URL(`../test/ui5-${version.split('.').slice(0, 2).join('.')}.json`, import.meta.url);
await writeFile(file, JSON.stringify(dump, null, 1) + '\n');
console.log(`UI5 ${dump.version}: ${Object.keys(dump.controls).length} controls -> ${file.pathname}`);
