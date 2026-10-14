// The design document (src/model.js): every edit, the validation and the
// preview model, on designs built here - and one regression test per bug
// found, so it stays found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesign, createNode, insertNode, removeNode, moveNode, shiftNode, duplicateNode, dropTarget, findNode,
  rowContext, bindListToTable, unbindList, validate, previewModel, typeName, attributeFits, renameAttribute, attributeUsage, collectEvents, normalizeDesign,
} from '../src/model.js';
import { generateClass } from '../src/abap.js';
import { toXml } from '../src/xml.js';

const page = (d) => d.root.aggs.content[0];
const errors = (d) => validate(d).filter((i) => i.level === 'error').map((i) => i.text);
const table = (name, fields, rows) => ({ name, type: 'table', fields: fields.map((f) => ({ name: f, type: 'string' })), rows });

test('B1: sample rows that set nothing are still rows of the class', () => {
  const d = createDesign();
  d.attributes = [table('t_x', ['A'], [{ A: '' }, {}])];
  assert.equal(previewModel(d).T_X.length, 2);
  const src = generateClass(d);
  assert.match(src, /METHOD model_init/);
  assert.match(src, /t_x = VALUE #\(\s+\( \)\s+\( \) \)\./);
});

test('B2: an empty binding is written by neither the view nor the class', () => {
  const d = createDesign();
  const text = page(d).aggs.content[0];
  for (const m of ['b', 'f', 'x']) {
    text.props.text = { m, v: '' };
    assert.ok(!toXml(d).includes('text='), `${m}: no text attribute in the view`);
    assert.ok(!generateClass(d).includes('`text`'), `${m}: no text attribute in the class`);
  }
});

test('B3: two tables with the same row type are an error', () => {
  const d = createDesign();
  d.attributes = [table('t_rows', ['A'], []), table('rows', ['B'], [])];
  assert.equal(typeName(d.attributes[0]), typeName(d.attributes[1]));
  assert.ok(errors(d).some((t) => t.includes('share the row type')));
  d.attributes[1].name = 'lines';
  assert.deepEqual(errors(d), []);
});

test('B4: a binding has to fit - rows take a table, a property a scalar, a boolean a flag', () => {
  const d = createDesign();
  d.attributes = [table('t', ['A'], [{ A: '1' }]), { name: 'flag', type: 'bool', value: true }, { name: 'name', type: 'string', value: '' }];
  const list = createNode('List');
  insertNode(d, list, page(d).id);
  bindListToTable(d, list.id, 'items', 't');
  assert.deepEqual(errors(d), []);
  d.attributes[0].type = 'string';
  assert.ok(errors(d).some((t) => t.includes('which is not a table')));
  d.attributes[0].type = 'table';
  const input = createNode('Input');
  input.props.value = { m: 'b', v: 't' };
  insertNode(d, input, page(d).id);
  assert.ok(errors(d).some((t) => t.includes('takes a single value')));
  input.props.value = { m: 'b', v: 'name' };
  input.props.enabled = { m: 'b', v: 'name' };
  assert.ok(validate(d).some((i) => i.level === 'warning' && i.text.includes('enabled is boolean')));
  assert.equal(attributeFits({ type: 'boolean' }, 'bool'), true);
  assert.equal(attributeFits({ type: 'boolean' }, 'string'), false);
  assert.equal(attributeFits({ type: 'float' }, 'decimal'), true);
  assert.equal(attributeFits({ type: 'string' }, 'table'), false);
  assert.equal(attributeFits({ type: 'string' }, 'date'), true);
});

test('B9: an aggregation that takes one child takes one', () => {
  const d = createDesign();
  const t = createNode('Table');
  insertNode(d, t, page(d).id);
  const col = t.aggs.columns[0];
  assert.throws(() => insertNode(d, createNode('Text'), col.id, 'header'), /takes no/);
  assert.equal(col.aggs.header.length, 1);
  const footer = createNode('OverflowToolbar');
  insertNode(d, footer, page(d).id, 'footer');
  assert.equal(duplicateNode(d, footer.id), null, 'no second footer');
  assert.equal(page(d).aggs.footer.length, 1);
  assert.equal(moveNode(d, createNode('Toolbar').id, page(d).id, 'footer', null), null);
});

test('insert, remove, move, shift and duplicate keep the tree sound', () => {
  const d = createDesign();
  page(d).aggs.content = [];
  const a = createNode('Text', { props: { text: 'a' } });
  const b = createNode('Text', { props: { text: 'b' } });
  const box = createNode('VBox');
  insertNode(d, a, page(d).id);
  insertNode(d, b, page(d).id);
  insertNode(d, box, page(d).id, 'content', 0);
  assert.deepEqual(page(d).aggs.content.map((n) => n.id), [box.id, a.id, b.id]);
  assert.equal(shiftNode(d, box.id, 1), box.id);
  assert.deepEqual(page(d).aggs.content.map((n) => n.id), [a.id, box.id, b.id]);
  assert.equal(moveNode(d, b.id, box.id, 'items', null), b.id);
  assert.deepEqual(box.aggs.items.map((n) => n.id), [b.id]);
  assert.equal(moveNode(d, box.id, b.id, 'items', null), null, 'not into its own child');
  assert.equal(moveNode(d, a.id, page(d).id, 'content', 2), a.id, 'to the end of its own list');
  assert.deepEqual(page(d).aggs.content.map((n) => n.id), [box.id, a.id]);
  const copy = duplicateNode(d, box.id);
  assert.notEqual(copy, box.id);
  assert.notEqual(findNode(d.root, copy).node.aggs.items[0].id, b.id, 'the copy has new ids');
  assert.equal(removeNode(d, b.id), box.id, 'the parent is selected when the last child goes');
  assert.equal(box.aggs.items, undefined, 'an emptied aggregation is dropped');
  assert.equal(removeNode(d, 'root'), null);
});

test('a drop lands in the control when it takes it, else next to it, else higher up', () => {
  const d = createDesign();
  const text = page(d).aggs.content[0];
  assert.deepEqual(dropTarget(d, page(d).id, 'Button'), { parentId: page(d).id, agg: 'content', index: null });
  assert.deepEqual(dropTarget(d, text.id, 'Button'), { parentId: page(d).id, agg: 'content', index: 1 });
  assert.equal(dropTarget(d, text.id, 'Column'), null, 'a part does not go into a page');
  const tbl = createNode('Table');
  insertNode(d, tbl, page(d).id);
  assert.equal(dropTarget(d, tbl.aggs.columns[0].id, 'Column').agg, 'columns');
  assert.equal(dropTarget(d, tbl.id, 'OverflowToolbar').agg, 'headerToolbar');
  assert.deepEqual(dropTarget(d, 'root', 'Page'), { parentId: 'root', agg: 'content', index: null });
});

test('the row context of a template is the table its list repeats', () => {
  const d = createDesign();
  d.attributes = [table('t', ['A', 'B'], [{ A: '1', B: '2' }])];
  const tbl = createNode('Table');
  insertNode(d, tbl, page(d).id);
  bindListToTable(d, tbl.id, 'items', 't');
  assert.equal(tbl.aggs.columns.length, 2);
  const cell = tbl.aggs.items[0].aggs.cells[0];
  assert.equal(rowContext(d, cell.id).name, 't');
  assert.equal(rowContext(d, tbl.id), null);
  assert.deepEqual(errors(d), []);
  unbindList(d, tbl.id, 'items');
  assert.ok(errors(d).some((t) => t.includes('outside a bound list')));
});

test('attributes: usage, rename and the preview model', () => {
  const d = createDesign();
  d.attributes = [{ name: 'name', type: 'string', value: 'x' }, { name: 'n', type: 'int', value: '' }, { name: 'ok', type: 'bool', value: 'X' }];
  const input = createNode('Input');
  input.props.value = { m: 'b', v: 'name' };
  input.events.change = 'CHANGED';
  insertNode(d, input, page(d).id);
  assert.equal(attributeUsage(d, 'name'), 1);
  renameAttribute(d, 'name', 'title');
  assert.equal(input.props.value.v, 'title');
  assert.deepEqual(previewModel(d), { NAME: 'x', N: 0, OK: true });
  assert.deepEqual(collectEvents(d), ['CHANGED']);
});

test('the validation names what breaks the class', () => {
  const d = createDesign();
  d.className = 'MY_APP';
  d.attributes = [{ name: 'Bad Name', type: 'string', value: '' }, { name: 'client', type: 'string', value: '' }, table('t', [], [])];
  const text = page(d).aggs.content[0];
  text.props.text = { m: 'b', v: 'nothing' };
  text.events.press = 'lower';
  const e = errors(d);
  assert.ok(e.some((t) => t.startsWith('Class name')));
  assert.ok(e.some((t) => t.includes('Bad Name')));
  assert.ok(e.some((t) => t.includes('taken by the generated class')));
  assert.ok(e.some((t) => t.includes('has no fields')));
  assert.ok(e.some((t) => t.includes('not an attribute')));
  assert.ok(e.some((t) => t.includes('Text.press')));
});

test('B8: a decimal with 3 decimals and a time without seconds are flagged, the canvas shows what the class sends', () => {
  const d = createDesign();
  d.attributes = [{ name: 'amount', type: 'decimal', value: '1.234' }, { name: 'at', type: 'time', value: '12:30' }, { name: 'day', type: 'date', value: '1.1.2026' }, { name: 'n', type: 'int', value: '1e3' }];
  const w = validate(d).filter((i) => i.level === 'warning').map((i) => i.text);
  assert.ok(w.some((t) => t.includes('amount') && t.includes('rounds')));
  assert.ok(w.some((t) => t.includes('at:') && t.includes('hh:mm:ss')));
  assert.ok(w.some((t) => t.includes('day:')));
  assert.ok(w.some((t) => t.includes('n:')));
  assert.deepEqual(previewModel(d), { AMOUNT: 1.23, AT: '12:30:00', DAY: '1.1.2026', N: 1 });
});

test('B10: a design from a file gets ids the canvas can find', () => {
  const d = createDesign();
  const text = page(d).aggs.content[0];
  text.id = 'weird id';
  page(d).aggs.content.push({ id: text.id === 'weird id' ? page(d).id : 'x', type: 'Button' });
  normalizeDesign(d);
  assert.match(text.id, /^n[0-9a-z]+$/);
  const ids = [];
  const walkIds = (n) => { ids.push(n.id); Object.values(n.aggs).flat().forEach(walkIds); };
  walkIds(d.root);
  assert.equal(new Set(ids).size, ids.length, 'all ids unique');
  assert.deepEqual(page(d).aggs.content[1].props, {});
  assert.throws(() => normalizeDesign({ version: 99, root: {} }), /version 99/);
  assert.throws(() => normalizeDesign('x'), /not a designer file/);
});

test('a design of an older version is migrated, a newer one refused', () => {
  const d = createDesign();
  d.version = 99;
  assert.throws(() => normalizeDesign(d), /version 99/);
  d.version = 0;
  assert.throws(() => normalizeDesign(d), /no migration/);
});
