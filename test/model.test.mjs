// The design document (src/model.js): every edit, the validation and the
// preview model, on designs built here - and one regression test per bug
// found, so it stays found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesign, createNode, insertNode, removeNode, moveNode, shiftNode, duplicateNode, dropTarget, findNode,
  rowContext, aggAccepts, bindListToTable, unbindList, validate, previewModel, typeName, attributeFits, renameAttribute, attributeUsage, collectEvents, normalizeDesign,
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

test('an attribute named in an expression is used, and renamed with it', () => {
  const d = createDesign();
  d.attributes = [{ name: 'name', type: 'string', value: '' }, { name: 'names', type: 'string', value: '' }];
  const text = createNode('Text');
  text.props.text = { m: 'x', v: '{= ${/NAME} || ${/NAMES} }' };
  insertNode(d, text, page(d).id);
  assert.equal(attributeUsage(d, 'name'), 1);
  renameAttribute(d, 'name', 'title');
  assert.equal(text.props.text.v, '{= ${/TITLE} || ${/NAMES} }');
});

test('an attribute may not take the name of a method of the class', () => {
  const d = createDesign();
  d.attributes = [{ name: 'on_event', type: 'string', value: '' }];
  assert.ok(errors(d).some((e) => /on_event/.test(e)));
});

test('a design from a file gets attributes of the shape the panels rely on', () => {
  const d = normalizeDesign({ version: 1, root: { aggs: { content: [] } }, attributes: [{ name: 't_x', type: 'table' }, null, { name: 'a', type: 'nonsense' }] });
  assert.deepEqual(d.attributes, [{ name: 't_x', type: 'table', fields: [], rows: [] }, { name: 'a', type: 'string' }]);
  assert.doesNotThrow(() => validate(d));
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

test('a static value UI5 cannot take is said: a number or an enum fails the view, a size is logged', () => {
  const d = createDesign();
  const form = createNode('form:SimpleForm');
  form.props.columnsM = { m: 's', v: 'abc' };
  form.props.width = { m: 's', v: '1.5' };
  insertNode(d, form, page(d).id);
  const issues = validate(d);
  assert.ok(issues.some((i) => i.level === 'error' && /columnsM: "abc" is not a whole number/.test(i.text)));
  assert.ok(issues.some((i) => i.level === 'warning' && /width: "1.5" is not a CSS size/.test(i.text)));
  form.props.columnsM.v = '2';
  form.props.width.v = 'calc(100% - 2rem)';
  assert.ok(!validate(d).some((i) => /columnsM|width/.test(i.text)));
});

test('the rows of a grid table come from its binding: nothing is dropped into them', () => {
  const d = createDesign();
  const grid = createNode('table:Table');
  insertNode(d, grid, page(d).id);
  assert.equal(aggAccepts(grid, 'rows', 'Button'), false);
  const t = dropTarget(d, grid.id, 'Button');
  assert.ok(!(t.parentId === grid.id && t.agg === 'rows'));
});

test('a new Wizard has the three steps UI5 wants at least', () => {
  assert.equal(createNode('Wizard').aggs.steps.length, 3);
});

test('a class name is dotted names, each part a name', async () => {
  const { parseClassName } = await import('../src/catalog.js');
  assert.equal(parseClassName('sap.m.'), null);
  assert.equal(parseClassName('sap..Button'), null);
  assert.equal(parseClassName('Button'), null);
  assert.deepEqual(parseClassName('sap.m.Button'), { lib: 'sap.m', name: 'Button', module: 'sap/m/Button' });
});

test('a control the UI5 runtime describes becomes a catalogue entry', async () => {
  const { runtimeDef, registerControl, getControl, parseClassName, RUNTIME } = await import('../src/catalog.js');
  const { prefixFor, typeFor } = await import('../src/model.js');
  assert.deepEqual(parseClassName('sap.suite.ui.microchart.RadialMicroChart'), { lib: 'sap.suite.ui.microchart', name: 'RadialMicroChart', module: 'sap/suite/ui/microchart/RadialMicroChart' });
  assert.deepEqual(parseClassName('sap/m/Wizard'), { lib: 'sap.m', name: 'Wizard', module: 'sap/m/Wizard' });
  assert.equal(parseClassName('Wizard'), null);
  const d = createDesign();
  assert.equal(typeFor(d, 'sap.m', 'Wizard'), 'Wizard');
  assert.equal(typeFor(d, 'sap.ui.layout', 'Grid'), 'l:Grid');
  assert.equal(typeFor(d, 'sap.suite.ui.microchart', 'RadialMicroChart'), 'microchart:RadialMicroChart');
  assert.equal(prefixFor(d, 'sap.suite.ui.microchart'), 'microchart', 'remembered, not renamed');
  assert.equal(prefixFor(d, 'my.own.form'), 'form_', 'form is taken by the catalogue');
  assert.deepEqual(d.namespaces, { microchart: 'sap.suite.ui.microchart', form_: 'my.own.form' });
  const def = runtimeDef({
    className: 'sap.suite.ui.microchart.RadialMicroChart',
    props: { percentage: { type: 'float' }, valueColor: { type: 'sap.m.ValueColor', values: ['Neutral', 'Good'] }, size: { type: 'sap.m.Size', values: ['XS', 'S'] }, width: { type: 'sap.ui.core.CSSSize' }, iconSrc: { type: 'sap.ui.core.URI' }, stuff: { type: 'object' }, odd: { type: 'int[]' } },
    aggs: { tooltip: { multiple: false }, customData: { multiple: true }, content: { multiple: true }, header: { multiple: false } },
    defaultAgg: 'content',
    events: ['press', 'modelContextChange'],
  });
  assert.deepEqual(def.props.percentage, { type: 'float' });
  assert.deepEqual(def.props.valueColor, { type: 'enum', values: ['Neutral', 'Good'] });
  assert.deepEqual(def.props.width, { type: 'cssSize' });
  assert.deepEqual(def.props.iconSrc, { type: 'icon' });
  assert.equal(def.props.stuff, undefined);
  assert.equal(def.props.odd.loose, true);
  assert.deepEqual(def.aggs, { content: {}, header: { single: true } });
  assert.equal(def.defaultAgg, 'content');
  assert.deepEqual(def.events, ['press']);
  registerControl('microchart:RadialMicroChart', def);
  assert.equal(getControl('microchart:RadialMicroChart'), def);
  const node = createNode('microchart:RadialMicroChart');
  insertNode(d, node, page(d).id);
  insertNode(d, createNode('Text'), node.id);
  assert.deepEqual(Object.keys(node.aggs), ['content']);
  assert.ok(toXml(d).includes('xmlns:microchart="sap.suite.ui.microchart"'));
  assert.ok(toXml(d).includes('<microchart:RadialMicroChart>'));
  assert.ok(generateClass(d).includes('n = `RadialMicroChart` ns = `microchart`'));
  assert.ok(validate(d).some((i) => i.level === 'info' && i.text.includes('not checked against UI5 1.71')));
  delete RUNTIME['microchart:RadialMicroChart'];
});

test('a table field of a table: nested types, nested rows, a list in a list, a tree', async () => {
  const { tableTypes, childrenField } = await import('../src/model.js');
  const { builderXml } = await import('./builder.mjs');
  const { viewChain } = await import('../src/abap.js');
  const d = createDesign();
  d.attributes = [{
    name: 't_tree', type: 'table',
    fields: [{ name: 'TEXT', type: 'string' }, { name: 'NODES', type: 'table', fields: [{ name: 'TEXT', type: 'string' }, { name: 'DONE', type: 'bool' }] }],
    rows: [{ TEXT: 'Root', NODES: [{ TEXT: 'Child', DONE: true }] }, { TEXT: 'Leaf' }],
  }];
  assert.deepEqual(tableTypes(d.attributes[0]).map((t) => t.name), ['ty_s_tree_nodes', 'ty_s_tree']);
  assert.equal(childrenField(d.attributes[0]), 'NODES');
  const src = generateClass(d);
  assert.match(src, /BEGIN OF ty_s_tree_nodes,\n\s+text TYPE string,\n\s+done TYPE abap_bool,/);
  assert.match(src, /nodes TYPE STANDARD TABLE OF ty_s_tree_nodes WITH EMPTY KEY,/);
  assert.match(src, /nodes = VALUE #\(\n\s+\( text = `Child` done = abap_true \) \) \)/);
  assert.deepEqual(previewModel(d), { T_TREE: [{ TEXT: 'Root', NODES: [{ TEXT: 'Child', DONE: true }] }, { TEXT: 'Leaf', NODES: [] }] });
  // the tree binds the rows and names the field its children come from
  const tree = createNode('Tree');
  insertNode(d, tree, page(d).id);
  assert.ok(errors(d).some((t) => t.includes('Tree: its items have to be bound')));
  bindListToTable(d, tree.id, 'items', 't_tree');
  assert.deepEqual(tree.props.items, { m: 'b', v: 't_tree', arr: 'NODES' });
  assert.deepEqual(tree.aggs.items[0].props.title, { m: 'f', v: 'TEXT' });
  assert.ok(toXml(d).includes(`items="{path:'/T_TREE',parameters:{arrayNames:['NODES']}}"`));
  assert.ok(generateClass(d).includes("v = |\\{path:'{ client->_bind( val = t_tree path = abap_true ) }',parameters:\\{arrayNames:['NODES']\\}\\}|"));
  // a list inside the row repeats the table field
  const list = createNode('List');
  insertNode(d, list, page(d).id);
  bindListToTable(d, list.id, 'items', 't_tree');
  const item = createNode('CustomListItem');
  list.aggs.items = [item];
  const inner = createNode('List');
  insertNode(d, inner, item.id);
  bindListToTable(d, inner.id, 'items', 'NODES', true, true);
  assert.deepEqual(inner.props.items, { m: 'f', v: 'NODES' });
  assert.equal(rowContext(d, inner.aggs.items[0].id).name, 'NODES');
  assert.deepEqual(inner.aggs.items[0].props.title, { m: 'f', v: 'TEXT' });
  assert.deepEqual(errors(d), []);
  assert.equal(builderXml(viewChain(d).join('\n')), toXml(d).replace(/>\s+</g, '><'));
  // a property bound to the table field, a list bound to a scalar field: errors
  inner.aggs.items[0].props.title = { m: 'f', v: 'DONE' };
  item.props.type = { m: 'f', v: 'NODES' };
  assert.ok(errors(d).some((t) => t.includes('table field NODES - a property')));
  inner.props.items = { m: 'f', v: 'TEXT' };
  assert.ok(errors(d).some((t) => t.includes('field TEXT, which is not a table')));
});

test('the canvas shows what abap2UI5 sends: midnight is no time, .5 and 1e3 are numbers, -0 is 0', async () => {
  const { generateClass } = await import('../src/abap.js');
  const d = createDesign();
  d.attributes = [
    { name: 'at', type: 'time', value: '00:00:00' }, { name: 'half', type: 'decimal', value: '.5' },
    { name: 'big', type: 'decimal', value: '1e3' }, { name: 'zero', type: 'int', value: '-0' },
  ];
  assert.deepEqual(previewModel(d), { AT: '', HALF: 0.5, BIG: 1000, ZERO: 0 });
  assert.ok(Object.is(previewModel(d).ZERO, 0));
  const src = generateClass(d);
  assert.match(src, /half = '0\.50'\./);
  assert.match(src, /big = '1000\.00'\./);
  assert.ok(!/\bat = /.test(src), 'midnight is the initial time');
  assert.ok(validate(d).some((i) => i.level === 'warning' && /at: midnight/.test(i.text)));
});

test('a table of table fields only binds to a template of static text, not to a table field', () => {
  const d = createDesign();
  d.attributes = [{ name: 't_groups', type: 'table', fields: [{ name: 'KIDS', type: 'table', fields: [{ name: 'TEXT', type: 'string' }] }], rows: [] }];
  for (const type of ['List', 'Table', 'table:Table', 'Select']) {
    const l = createNode(type);
    insertNode(d, l, page(d).id);
    bindListToTable(d, l.id, type === 'table:Table' ? 'rows' : 'items', 't_groups');
  }
  assert.deepEqual(errors(d), []);
});

test('columns built by hand are a template of their own: binding the table again asks first', async () => {
  const { hasOwnTemplate } = await import('../src/model.js');
  const d = createDesign();
  d.attributes = [table('t_a', ['X'], [])];
  for (const [type, agg] of [['table:Table', 'rows'], ['Table', 'items'], ['List', 'items']]) {
    const l = createNode(type);
    insertNode(d, l, page(d).id);
    assert.equal(hasOwnTemplate(l, agg, d), false, `${type}: the catalogue's start`);
    bindListToTable(d, l.id, agg, 't_a');
    assert.equal(hasOwnTemplate(l, agg, d), false, `${type}: what the binding generated`);
    if (type === 'List') l.aggs.items[0].props.icon = { m: 's', v: 'sap-icon://add' };
    else l.aggs.columns[0].props.width = { m: 's', v: '5rem' };
    assert.equal(hasOwnTemplate(l, agg, d), true, `${type}: edited by hand`);
  }
});

test('controls side by side wrap into a new container, in their order and in their place', async () => {
  const { wrapNodes } = await import('../src/model.js');
  const d = createDesign();
  const p = page(d);
  const a = createNode('Button');
  const b = createNode('Text');
  const c = createNode('Input');
  for (const n of [a, b, c]) insertNode(d, n, p.id);
  const before = p.aggs.content.length;
  const id = wrapNodes(d, [c.id, a.id], 'HBox');
  const box = findNode(d.root, id);
  assert.equal(box.node.type, 'HBox');
  assert.deepEqual(box.node.aggs.items.map((n) => n.id), [a.id, c.id], 'in the order of the view, not of the clicks');
  assert.equal(p.aggs.content.length, before - 1);
  assert.equal(p.aggs.content.indexOf(box.node), before - 3, 'where the first of them was');
  assert.equal(findNode(d.root, b.id).parent.id, p.id);
});

test('a wrap refuses what does not sit side by side, or what the wrapper does not take', async () => {
  const { wrapNodes } = await import('../src/model.js');
  const d = createDesign();
  const p = page(d);
  const box = createNode('VBox');
  insertNode(d, box, p.id);
  const inner = createNode('Button');
  insertNode(d, inner, box.id);
  const outer = createNode('Button');
  insertNode(d, outer, p.id);
  assert.throws(() => wrapNodes(d, [inner.id, outer.id], 'HBox'), /side by side/);
  const bar = createNode('IconTabBar');
  insertNode(d, bar, p.id);
  const tab = Object.values(bar.aggs).flat().find((n) => n.type === 'IconTabFilter');
  assert.throws(() => wrapNodes(d, [tab.id], 'VBox'), /takes no/, 'a tab is a part of its bar, no VBox takes it');
  assert.ok(findNode(d.root, tab.id), 'a refused wrap leaves the design as it was - commit( ) rolls back what it did');
});

test('moveItem swaps an entry with its neighbour, and refuses the ends', async () => {
  const { moveItem } = await import('../src/model.js');
  const list = ['a', 'b', 'c'];
  assert.equal(moveItem(list, 0, -1), false);
  assert.equal(moveItem(list, 2, 1), false);
  assert.equal(moveItem(list, 1, -1), true);
  assert.deepEqual(list, ['b', 'a', 'c']);
});

test('the order of the attributes is the order of their declarations', async () => {
  const { moveItem } = await import('../src/model.js');
  const d = createDesign();
  d.attributes = [{ name: 'first', type: 'string', value: '' }, { name: 'second', type: 'string', value: '' }];
  moveItem(d.attributes, 1, -1);
  const src = generateClass(d);
  assert.ok(src.indexOf('DATA second') < src.indexOf('DATA first'));
});

test('sample rows pasted from a spreadsheet or CSV', async () => {
  const { parseSampleRows } = await import('../src/model.js');
  const fields = [{ name: 'TITLE', type: 'string' }, { name: 'DONE', type: 'bool' }, { name: 'KIDS', type: 'table', fields: [] }];
  // a spreadsheet: tabs, a header that names a field the table has not
  let r = parseSampleRows('Title\tDone\tCity name\nFirst\tX\tBerlin\nSecond\t\tParis\n', fields, true);
  assert.deepEqual(r.added, [{ name: 'CITY_NAME', type: 'string' }]);
  assert.deepEqual(r.rows, [{ TITLE: 'First', DONE: true, CITY_NAME: 'Berlin' }, { TITLE: 'Second', DONE: false, CITY_NAME: 'Paris' }]);
  // CSV without a header: the scalar fields in their order, the rest counted
  r = parseSampleRows('"A, quoted";true;extra\r\nB;0\r\n', fields, false);
  assert.deepEqual(r.rows, [{ TITLE: 'A, quoted', DONE: true }, { TITLE: 'B', DONE: false }]);
  assert.equal(r.ignored, 1);
  assert.deepEqual(r.added, []);
  // a header that names a table field leaves that column out
  r = parseSampleRows('KIDS,TITLE\nx,y', fields, true);
  assert.deepEqual(r.rows, [{ TITLE: 'y' }]);
  assert.deepEqual(parseSampleRows('  \n', fields, true).rows, []);
});

test('a check that can be fixed says how - and the fix is data, not code', () => {
  const d = createDesign();
  d.attributes = [{ name: 'unused', type: 'string', value: '' }];
  const input = createNode('Input');
  input.props.value = { m: 'b', v: 'missing_name' };
  insertNode(d, input, page(d).id);
  const tree = createNode('Tree');
  insertNode(d, tree, page(d).id);
  const issues = validate(d);
  const fix = (re) => issues.find((i) => re.test(i.text))?.fix;
  assert.deepEqual(fix(/is bound to missing_name/), { kind: 'createAttribute', name: 'missing_name', type: 'string', label: 'Create missing_name' });
  assert.equal(issues.find((i) => /is bound to missing_name/.test(i.text)).prop, 'value');
  assert.equal(fix(/unused is public/).kind, 'removeAttribute');
  assert.equal(fix(/Tree: its items/).kind, 'nodesTable');
  assert.doesNotThrow(() => JSON.stringify(issues));
});

test('several nodes move together, in the order of the view, before the node at the index', async () => {
  const { moveNodes } = await import('../src/model.js');
  const d = createDesign();
  const p = page(d);
  p.aggs.content = [];
  const [a, b, c, e] = ['Button', 'Text', 'Input', 'Title'].map((t) => { const n = createNode(t); insertNode(d, n, p.id); return n; });
  const box = createNode('VBox');
  insertNode(d, box, p.id);
  // c and a, clicked in that order, into the VBox
  assert.equal(moveNodes(d, [c.id, a.id], box.id, 'items', null), c.id);
  assert.deepEqual(box.aggs.items.map((n) => n.id), [a.id, c.id]);
  assert.deepEqual(p.aggs.content.map((n) => n.id), [b.id, e.id, box.id]);
  // back, before e - an index of the list as it is before the move
  assert.equal(moveNodes(d, [a.id, c.id], p.id, 'content', 1), c.id);
  assert.deepEqual(p.aggs.content.map((n) => n.id), [b.id, a.id, c.id, e.id, box.id]);
  // never into one of the moved
  assert.equal(moveNodes(d, [box.id, b.id], box.id, 'items', null), null);
});

test('"Build a template" is offered only where it replaces nothing built by hand and has a table to build from', () => {
  const d = createDesign();
  d.attributes = [table('t_items', ['TITLE'], [])];
  const t = createNode('Table');
  insertNode(d, t, page(d).id);
  bindListToTable(d, t.id, 'items', 't_items');
  const fixOf = () => validate(d).find((i) => /exactly one template/.test(i.text))?.fix;
  t.aggs.items = [];
  assert.equal(fixOf(), undefined, 'the columns of the table are its own');
  delete t.aggs.columns;
  assert.equal(fixOf().label, 'Build a template');
  t.props.items.v = 'missing';
  assert.equal(fixOf(), undefined, 'no table to build from');
});
