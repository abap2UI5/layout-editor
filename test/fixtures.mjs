// Designs the tests run everything against: the starters, and a kitchen
// sink that puts every control of the palette into the view with every
// property set and every event named, next to a binding of every attribute
// type.
import { CONTROLS } from '../src/catalog.js';
import { createDesign, createNode, insertNode, bindListToTable } from '../src/model.js';
import { STARTERS } from '../src/starters.js';

const SAMPLE = {
  string: 'Text', boolean: 'true', int: '1', float: '1', cssSize: '10rem', icon: 'sap-icon://home', uri: 'logo.svg',
};

function sample(def) {
  if (def.sample) return def.sample;
  if (def.type === 'enum') return def.values[def.values.length > 1 ? 1 : 0];
  return SAMPLE[def.type];
}

// a parent each kind of control can live in
const HOME = {
  IconTabFilter: 'IconTabBar', IconTabSeparator: 'IconTabBar', 'core:Item': 'Select', RadioButton: 'RadioButtonGroup',
  SegmentedButtonItem: 'SegmentedButton', StandardListItem: 'List', CustomListItem: 'List', Column: 'Table', ColumnListItem: 'Table',
};

export function kitchenSink() {
  const d = createDesign();
  d.className = 'ZCL_DSG_KITCHEN_SINK';
  d.description = 'every control of the designer palette';
  d.attributes = [
    { name: 'text', type: 'string', value: 'Hello `world` {not a binding}' },
    { name: 'count', type: 'int', value: '42' },
    { name: 'amount', type: 'decimal', value: '1234.50' },
    { name: 'flag', type: 'bool', value: true },
    { name: 'day', type: 'date', value: '2026-10-14' },
    { name: 'clock', type: 'time', value: '12:30:00' },
    {
      name: 't_rows', type: 'table',
      fields: [{ name: 'NAME', type: 'string' }, { name: 'QTY', type: 'int' }, { name: 'PRICE', type: 'decimal' }, { name: 'DONE', type: 'bool' }, { name: 'DUE', type: 'date' }, { name: 'AT', type: 'time' }],
      rows: [
        { NAME: 'Alpha', QTY: '1', PRICE: '9.99', DONE: true, DUE: '2026-01-01', AT: '08:00:00' },
        { NAME: 'Beta', QTY: '2', PRICE: '19.99', DONE: false, DUE: '2026-02-01', AT: '09:30:00' },
        { NAME: 'Gamma', QTY: '', PRICE: '', DONE: false, DUE: '', AT: '' },
      ],
    },
  ];
  const page = d.root.aggs.content[0];
  page.aggs.content = [];
  const box = createNode('VBox');
  insertNode(d, box, page.id);
  const parents = {};
  let ev = 0;
  for (const [type, c] of Object.entries(CONTROLS)) {
    const node = createNode(type);
    for (const [p, def] of Object.entries(c.props || {})) node.props[p] = { m: 's', v: sample(def) };
    for (const e of c.events || []) node.events[e] = `EV_${++ev}`;
    const home = HOME[type];
    if (home) {
      parents[home] = parents[home] || (() => { const p = createNode(home); insertNode(d, p, box.id); return p; })();
      insertNode(d, node, parents[home].id);
    } else {
      insertNode(d, node, box.id);
    }
  }
  // every scalar type bound, and a table bound to a list
  const bound = createNode('form:SimpleForm', { aggs: { content: [] } });
  insertNode(d, bound, page.id);
  const add = (type, prop, attr) => {
    const n = createNode(type);
    n.props[prop] = { m: 'b', v: attr };
    insertNode(d, n, bound.id);
  };
  add('Input', 'value', 'text');
  add('StepInput', 'value', 'count');
  add('Input', 'value', 'amount');
  add('Switch', 'state', 'flag');
  add('DatePicker', 'value', 'day');
  add('TimePicker', 'value', 'clock');
  const table = createNode('Table');
  insertNode(d, table, page.id);
  bindListToTable(d, table.id, 'items', 't_rows');
  const list = createNode('List');
  insertNode(d, list, page.id);
  bindListToTable(d, list.id, 'items', 't_rows');
  const select = createNode('Select');
  insertNode(d, select, page.id);
  bindListToTable(d, select.id, 'items', 't_rows');
  // a raw expression and a literal that looks like a binding
  insertNode(d, createNode('Text', { props: {} }), page.id);
  const expr = page.aggs.content[page.aggs.content.length - 1];
  expr.props.text = { m: 'x', v: '{= ${/COUNT} > 1 ? "many" : "one" }' };
  insertNode(d, createNode('Text', { props: { text: 'braces {like this} and a back\\slash' } }), page.id);
  return d;
}

export function allDesigns() {
  return [...STARTERS.map((s) => [s.id, s.make()]), ['kitchen-sink', kitchenSink()]];
}

