// UI5 XML view -> design (src/xml.js): what comes in as a binding, what is
// dropped and reported, where a child without a wrapper tag lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromXml, importReport, parseXml, toXml } from '../src/xml.js';
import { createDesign, validate } from '../src/model.js';

const VIEW = (body) => `<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core">${body}</mvc:View>`;
const base = () => {
  const d = createDesign();
  d.attributes = [
    { name: 'name', type: 'string', value: '' },
    { name: 't_rows', type: 'table', fields: [{ name: 'TITLE', type: 'string' }], rows: [] },
  ];
  return d;
};
const first = (d) => d.root.aggs.content[0];

test('B6: {/NAME} becomes a binding of the attribute, {FIELD} a field of the bound rows', () => {
  const d = fromXml(VIEW(`<Page><Input value="{/NAME}"/><List items="{/T_ROWS}"><items><StandardListItem title="{TITLE}" description="{OTHER}"/></items></List><Text text="{= \${/NAME} }"/></Page>`), base());
  const [input, list, text] = first(d).aggs.content;
  assert.deepEqual(input.props.value, { m: 'b', v: 'name' });
  assert.deepEqual(list.props.items, { m: 'b', v: 't_rows' });
  assert.deepEqual(list.aggs.items[0].props.title, { m: 'f', v: 'TITLE' });
  assert.equal(list.aggs.items[0].props.description.m, 'x', 'a field the table does not have stays an expression');
  assert.equal(text.props.text.m, 'x');
  assert.deepEqual(validate(d).filter((i) => i.level === 'error'), []);
  const r = importReport();
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.expressions, 2);
});

test('a binding that names no attribute is reported, a table where a scalar is expected too', () => {
  const d = fromXml(VIEW(`<Page><Input value="{/CITY}"/><Input value="{/T_ROWS}"/><List items="{/NAME}"/><List items="{/T_OTHER}"/></Page>`), base());
  const inputs = first(d).aggs.content;
  assert.equal(inputs[0].props.value.m, 'x');
  assert.equal(inputs[1].props.value.m, 'x', 'a table is not a value');
  assert.equal(inputs[2].props.items.m, 'x', 'a string has no rows');
  assert.deepEqual(importReport().unresolved, [{ path: 'CITY', agg: false }, { path: 'T_ROWS', agg: false }, { path: 'NAME', agg: true }, { path: 'T_OTHER', agg: true }]);
});

test('handlers, ids and core:require are dropped and counted, unknown controls listed', () => {
  const d = fromXml(VIEW(`<Page id="p" core:require="{x:'y'}"><Button id="b" press=".onGo" text="Go"/><Input change="onChange" class="sapUiSmallMargin"/><Shell><content><Text text="in"/></content></Shell></Page>`), base());
  const [button, input, shell] = first(d).aggs.content;
  assert.deepEqual(Object.keys(button.props), ['text']);
  assert.deepEqual(input.props.class, { m: 's', v: 'sapUiSmallMargin' }, 'an unknown property is kept');
  assert.equal(shell.aggs.content[0].type, 'Text');
  const r = importReport();
  assert.deepEqual(r.handlers, ['Button.press', 'Input.change']);
  assert.equal(r.ids, 2);
  assert.deepEqual(r.unknown, ['Shell']);
  assert.ok(toXml(d).includes('class="sapUiSmallMargin"'));
});

test('B12: a child without a wrapper lands where a drop would', () => {
  const d = fromXml(VIEW(`<Page><IconTabBar><IconTabFilter text="A"/></IconTabBar><Bar><Title text="t"/></Bar></Page>`), base());
  const [tabs, bar] = first(d).aggs.content;
  assert.deepEqual(Object.keys(tabs.aggs), ['items']);
  assert.deepEqual(Object.keys(bar.aggs), ['contentMiddle']);
  assert.ok(toXml(d).includes('<items>'), 'written with its wrapper, as 1.71 needs it');
});

test('text content becomes the text property', () => {
  const d = fromXml(VIEW(`<Page><Text>Hello &amp; welcome</Text><Label text="set">ignored</Label></Page>`), base());
  const [text, label] = first(d).aggs.content;
  assert.deepEqual(text.props.text, { m: 's', v: 'Hello & welcome' });
  assert.equal(label.props.text.v, 'set');
  assert.equal(parseXml('<a> x <b/> y </a>').text, 'x y');
});

test('malformed views fail with a reason', () => {
  assert.throws(() => fromXml('<Page xmlns="sap.m"/>', base()), /not an mvc:View/);
  assert.throws(() => fromXml(VIEW('<Page><Text></Page>'), base()), /does not close/);
  assert.throws(() => fromXml(VIEW('<x:Thing/>'), base()), /not declared/);
});
