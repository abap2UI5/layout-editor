// The catalogue against the metadata of UI5 1.71 - the oldest release
// abap2UI5 supports. test/ui5-1.71.json is read from a real 1.71.80
// runtime by tools/ui5-metadata.mjs; every property, enum value,
// aggregation, default aggregation and event the palette offers has to be
// there, or a generated view breaks on an old system.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTROLS, CATEGORIES } from '../src/catalog.js';

const ui5 = JSON.parse(readFileSync(new URL('./ui5-1.71.json', import.meta.url), 'utf8'));
const TYPE_OF = { string: ['string'], boolean: ['boolean'], int: ['int'], float: ['float', 'int'], cssSize: ['sap.ui.core.CSSSize'], icon: ['sap.ui.core.URI', 'string'], uri: ['sap.ui.core.URI'] };

for (const [key, c] of Object.entries(CONTROLS)) {
  test(`${key} exists in UI5 1.71 as the catalogue describes it`, () => {
    const md = ui5.controls[key];
    assert.ok(md, `${key} is not a control in ${ui5.version}`);
    assert.ok(CATEGORIES.includes(c.category), `${key}: unknown category ${c.category}`);
    for (const [p, def] of Object.entries(c.props || {})) {
      if (def.altAgg) {
        const agg = md.aggs[p];
        assert.ok(agg && !agg.multiple, `${key}.${p} is not a single aggregation in ${ui5.version}`);
        continue;
      }
      const real = md.props[p];
      assert.ok(real, `${key}.${p} is not a property in ${ui5.version}`);
      if (def.type === 'enum' && def.loose && real.type === 'string') continue; // typed as string, the values are UI5's
      if (def.loose) continue; // a UI5 type of its own, written as text
      if (def.type === 'enum') {
        assert.ok(real.values, `${key}.${p} is ${real.type}, not an enum`);
        for (const v of def.values) assert.ok(real.values.includes(v), `${key}.${p}: ${v} is not a value of ${real.type} in ${ui5.version}`);
      } else {
        assert.ok(TYPE_OF[def.type].includes(real.type), `${key}.${p} is ${real.type}, the catalogue says ${def.type}`);
      }
    }
    for (const e of c.events || []) assert.ok(md.events.includes(e), `${key}: no event ${e} in ${ui5.version}`);
    for (const [a, def] of Object.entries(c.aggs || {})) {
      const real = md.aggs[a];
      assert.ok(real, `${key}: no aggregation ${a} in ${ui5.version}`);
      assert.equal(!!def.single, !real.multiple, `${key}.${a}: single is ${!!def.single}, UI5 says multiple=${real.multiple}`);
    }
    // the view writes a control's default aggregation without its wrapper
    // tag, so the catalogue's default has to be UI5's
    if (c.defaultAgg) assert.equal(c.defaultAgg, md.defaultAgg, `${key}: default aggregation is ${md.defaultAgg} in ${ui5.version}, not ${c.defaultAgg}`);
    else if (md.defaultAgg && c.aggs) assert.ok(!c.aggs[md.defaultAgg], `${key}: ${md.defaultAgg} is UI5's default aggregation - declare it as defaultAgg`);
    if (c.dropAgg) assert.ok(c.aggs[c.dropAgg], `${key}: dropAgg ${c.dropAgg} is not one of its aggregations`);
    for (const p of Object.keys((c.init && c.init.props) || {})) assert.ok(c.props[p], `${key}: init sets ${p}, which the catalogue does not list`);
  });
}
