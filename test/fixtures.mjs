// Designs the tests run everything against: the starters, and a kitchen
// sink that puts every control of the palette into the view with every
// property set and every event named, next to a binding of every attribute
// type.
import { CONTROLS } from '../src/catalog.js';
import { createDesign, createNode, insertNode, bindListToTable, walk } from '../src/model.js';
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
  ObjectListItem: 'List', DisplayListItem: 'List', InputListItem: 'List', ObjectAttribute: 'ObjectHeader', Token: 'MultiInput',
  TileContent: 'GenericTile', NumericContent: 'TileContent', ImageContent: 'TileContent', NewsContent: 'TileContent', FeedContent: 'TileContent',
  FeedListItem: 'List', NotificationListItem: 'List', ActionListItem: 'List', GroupHeaderListItem: 'List',
  WizardStep: 'Wizard', TabContainerItem: 'TabContainer', MenuItem: 'Menu', Menu: 'MenuButton', StandardTreeItem: 'Tree',
  'l:BlockLayoutRow': 'l:BlockLayout', 'l:BlockLayoutCell': 'l:BlockLayoutRow', 'table:Column': 'table:Table',
  'f:DynamicPageTitle': 'f:DynamicPage', 'f:DynamicPageHeader': 'f:DynamicPage', 'cards:Header': 'f:Card', 'core:Title': 'form:SimpleForm',
  'uxap:ObjectPageDynamicHeaderTitle': 'uxap:ObjectPageLayout', 'uxap:ObjectPageSection': 'uxap:ObjectPageLayout', 'uxap:ObjectPageSubSection': 'uxap:ObjectPageSection',
};

// the category a control's outermost home is in: a part goes with the
// control it lives in
function homeCategory(type) {
  let t = type;
  while (HOME[t]) t = HOME[t];
  return CONTROLS[t].category;
}

// `half`: 1 for the layout and display controls, 2 for input and lists -
// one class with every control is more than the transpiled runtime of the
// verification takes in one statement; nothing: all of them
export function kitchenSink(half) {
  const d = createDesign();
  d.className = half ? `ZCL_DSG_KITCHEN_SINK_${half}` : 'ZCL_DSG_KITCHEN_SINK';
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
    // sample rows that set nothing are rows of the model all the same
    { name: 't_blank', type: 'table', fields: [{ name: 'NOTE', type: 'string' }], rows: [{ NOTE: '' }, {}] },
    // a table with a table field: the nodes of a tree, a list in a list
    {
      name: 't_tree', type: 'table',
      fields: [{ name: 'TEXT', type: 'string' }, { name: 'NODES', type: 'table', fields: [{ name: 'TEXT', type: 'string' }, { name: 'DONE', type: 'bool' }] }],
      rows: [{ TEXT: 'Root', NODES: [{ TEXT: 'Child 1', DONE: true }, { TEXT: 'Child 2', DONE: false }] }, { TEXT: 'Leaf', NODES: [] }],
    },
  ];
  const page = d.root.aggs.content[0];
  page.aggs.content = [];
  const box = createNode('VBox');
  insertNode(d, box, page.id);
  const parents = {};
  let ev = 0;
  for (const [type, c] of Object.entries(CONTROLS)) {
    if (half && (['Layout', 'Display'].includes(homeCategory(type)) ? 1 : 2) !== half) continue;
    const node = createNode(type);
    for (const [p, def] of Object.entries(c.props || {})) node.props[p] = { m: 's', v: sample(def) };
    for (const e of c.events || []) node.events[e] = `EV_${++ev}`;
    const home = HOME[type];
    if (home) {
      // one parent per kind, its slots empty so the part fits - a second
      // one when the slot of the first is taken (a tile content holds one)
      const place = (t, fresh) => {
        if (parents[t] && !fresh) return parents[t];
        const p = createNode(t, { aggs: {} });
        if (!HOME[t]) insertNode(d, p, box.id);
        else {
          try { insertNode(d, p, place(HOME[t]).id); } catch { insertNode(d, p, place(HOME[t], true).id); }
        }
        parents[t] = p;
        return p;
      };
      try {
        insertNode(d, node, place(home).id);
      } catch {
        insertNode(d, node, place(home, true).id);
      }
    } else {
      insertNode(d, node, box.id);
    }
  }
  // a tree is bound or nothing: the one the kitchen sink placed its tree
  // item in takes its nodes from t_tree, the item becomes the template
  walk(d.root, (n) => { if (n.type === 'Tree') bindListToTable(d, n.id, 'items', 't_tree'); return true; });
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
  const blank = createNode('List');
  insertNode(d, blank, page.id);
  bindListToTable(d, blank.id, 'items', 't_blank');
  // a list in a list: the inner one repeats the table field of the row
  const outer = createNode('List');
  insertNode(d, outer, page.id);
  bindListToTable(d, outer.id, 'items', 't_tree');
  const item = createNode('CustomListItem');
  outer.aggs.items = [item];
  insertNode(d, createNode('Text', { props: {} }), item.id);
  item.aggs.content[0].props.text = { m: 'f', v: 'TEXT' };
  const innerList = createNode('List');
  insertNode(d, innerList, item.id);
  bindListToTable(d, innerList.id, 'items', 'NODES', true, true);
  if (!half) {
    const tree = createNode('Tree');
    insertNode(d, tree, page.id);
    bindListToTable(d, tree.id, 'items', 't_tree');
  }
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
  return [...STARTERS.map((s) => [s.id, s.make()]), ['kitchen-sink-1', kitchenSink(1)], ['kitchen-sink-2', kitchenSink(2)]];
}

