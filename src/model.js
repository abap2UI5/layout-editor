// The design document and every operation on it. Pure functions over plain
// objects, no DOM: the browser UI and the node tests share this module.
//
// A design:
//   { version, className, description, attributes: [Attribute], root: Node }
// A node:
//   { id, type, props: { name: Value }, events: { name: EVENT }, aggs: { name: [Node] } }
// A value is { m, v } with m one of
//   s  static text, written into the view as it is
//   b  bound to an ABAP attribute (v = attribute name) - client->_bind( )
//   f  a field of the row a bound list repeats (v = field name) - {FIELD}
//   x  a raw UI5 binding expression, written as it is
// The root is the mvc:View; its one aggregation is `content`.
// An attribute:
//   { name, type: string|int|decimal|bool|date|time|table, value, fields: [{ name, type }], rows: [{}] }

import { CONTROLS, NAMESPACES, getControl, defaultAggFor, accepts, dropAggOf } from './catalog.js';

export const DESIGN_VERSION = 1;
export const SCALAR_TYPES = ['string', 'int', 'decimal', 'bool', 'date', 'time'];
export const ATTRIBUTE_TYPES = [...SCALAR_TYPES, 'table'];

let counter = 0;
export function newId() {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}

// A new node with the catalogue's starting content; `spec` ({ props, aggs })
// overrides it - props are merged, aggregations replace the starting ones
export function createNode(type, spec) {
  const c = getControl(type);
  const init = (c && c.init) || {};
  const node = { id: newId(), type, props: {}, events: {}, aggs: {} };
  const props = { ...(init.props || {}), ...((spec && spec.props) || {}) };
  for (const [k, v] of Object.entries(props)) node.props[k] = { m: 's', v };
  const aggs = (spec && spec.aggs) || init.aggs || {};
  for (const [agg, children] of Object.entries(aggs)) node.aggs[agg] = children.map((ch) => createNode(ch.type, ch));
  return node;
}

export function createDesign() {
  const root = { id: 'root', type: 'mvc:View', props: {}, events: {}, aggs: { content: [] } };
  const page = createNode('Page');
  page.props.title = { m: 's', v: 'My App' };
  page.aggs.content = [createNode('Text', { props: { text: 'Drag controls from the palette onto the page.' } })];
  root.aggs.content.push(page);
  return {
    version: DESIGN_VERSION,
    className: 'ZCL_MY_APP',
    description: 'My app',
    attributes: [],
    root,
  };
}

// A design that comes from a file: ids the canvas can find (n + base36,
// unique), else new ones - and the shape the editor relies on
// One step per version of the design format, from the version before it;
// a design of an older version is brought up step by step
const MIGRATIONS = {
  // 2: (d) => { ...; d.version = 2; },
};

export function normalizeDesign(d) {
  if (!d || typeof d !== 'object' || !d.root || typeof d.version !== 'number') throw new Error('not a designer file');
  if (d.version > DESIGN_VERSION) throw new Error(`a design of version ${d.version} - this editor reads up to ${DESIGN_VERSION}`);
  while (d.version < DESIGN_VERSION) {
    const step = MIGRATIONS[d.version + 1];
    if (!step) throw new Error(`no migration from design version ${d.version}`);
    step(d);
    d.version += 1;
  }
  d.className = String(d.className || 'ZCL_MY_APP');
  d.description = String(d.description || '');
  // the ABAP release of the class: 7.02, or nothing for 7.40 and later
  if (d.release === '702') d.release = '702'; else delete d.release;
  d.attributes = (Array.isArray(d.attributes) ? d.attributes : []).filter((a) => a && typeof a === 'object');
  // the shape the panels and the generator rely on: a name and a type, a
  // table with fields and rows (a table field with fields of its own)
  const fieldsOf = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f === 'object').map((f) => {
    f.name = String(f.name || '');
    if (!ATTRIBUTE_TYPES.includes(f.type)) f.type = 'string';
    if (f.type === 'table') f.fields = fieldsOf(f.fields);
    return f;
  });
  for (const a of d.attributes) {
    a.name = String(a.name || '');
    if (!ATTRIBUTE_TYPES.includes(a.type)) a.type = 'string';
    if (a.type === 'table') {
      a.fields = fieldsOf(a.fields);
      a.rows = Array.isArray(a.rows) ? a.rows.filter((r) => r && typeof r === 'object') : [];
    }
  }
  d.root.id = 'root';
  d.root.type = 'mvc:View';
  const seen = new Set(['root']);
  walk(d.root, (n) => {
    n.props = n.props || {};
    n.events = n.events || {};
    n.aggs = n.aggs || {};
    if (n.id === 'root') return true;
    if (typeof n.id !== 'string' || !/^n[0-9a-z]+$/.test(n.id) || seen.has(n.id)) n.id = newId();
    seen.add(n.id);
    return true;
  });
  return d;
}

// The prefix a library gets in this design's view: the catalogue's where
// it has one, else the one an import gave it, else the library's last
// name (sap.suite.ui.microchart -> microchart), made unique and remembered
export function prefixFor(design, lib) {
  for (const [p, uri] of Object.entries(NAMESPACES)) if (uri === lib) return p;
  design.namespaces = design.namespaces || {};
  for (const [p, uri] of Object.entries(design.namespaces)) if (uri === lib) return p;
  let p = lib.split('.').pop();
  while (p in NAMESPACES || p in design.namespaces) p += '_';
  design.namespaces[p] = lib;
  return p;
}

// the XML name of a control in this design: `Button` for sap.m, else
// prefix:Name
export function typeFor(design, lib, name) {
  const p = prefixFor(design, lib);
  return p ? `${p}:${name}` : name;
}

export function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

// ------------------------------------------------------------- tree walking

export function walk(node, fn, parent = null, agg = null) {
  if (fn(node, parent, agg) === false) return false;
  for (const [a, children] of Object.entries(node.aggs || {})) {
    for (const ch of children) if (walk(ch, fn, node, a) === false) return false;
  }
  return true;
}

export function findNode(root, id) {
  let hit = null;
  walk(root, (n, parent, agg) => {
    if (n.id === id) {
      hit = { node: n, parent, agg, index: parent ? parent.aggs[agg].indexOf(n) : -1 };
      return false;
    }
    return true;
  });
  return hit;
}

export function isAncestor(root, ancestorId, id) {
  const a = findNode(root, ancestorId);
  if (!a) return false;
  let found = false;
  walk(a.node, (n) => {
    if (n.id === id) { found = true; return false; }
    return true;
  });
  return found;
}

// The aggregations of a node in the order the view writes them: the
// catalogue's order first, anything an import brought along after it
export function aggNames(node) {
  const c = getControl(node.type);
  const known = c && c.aggs ? Object.keys(c.aggs) : [];
  const extra = Object.keys(node.aggs || {}).filter((a) => !known.includes(a));
  if (node.type === 'mvc:View') return ['content'];
  return [...known, ...extra];
}

// Is aggregation `agg` written without its wrapper tag? Only UI5's default
// aggregation may be, and only when it is the one aggregation in use - a
// Table with columns AND items writes both tags, which reads better than a
// bare row template after a <columns> block
export function isDirectAgg(node, agg) {
  if (agg === '') return true;
  if (node.type === 'mvc:View') return true;
  const c = getControl(node.type);
  if (!c || c.defaultAgg !== agg) return false;
  return Object.entries(node.aggs || {}).every(([a, list]) => a === agg || !list.length);
}

export function canHaveChildren(node) {
  if (node.type === 'mvc:View') return true;
  const c = getControl(node.type);
  if (!c) return Object.keys(node.aggs || {}).length > 0;
  return !!(c.aggs && Object.keys(c.aggs).length);
}

export function aggAccepts(node, agg, childType) {
  if (node.type === 'mvc:View') return agg === 'content' && getControl(childType)?.category !== 'Parts';
  const c = getControl(node.type);
  if (!c) return true;
  const a = c.aggs && c.aggs[agg];
  if (!a) return false;
  if (a.single && (node.aggs[agg] || []).length >= 1) return false;
  return accepts(node.type, agg, childType);
}

// ------------------------------------------------------------- tree edits
// All edits mutate the design in place and return what the UI selects next.

export function insertNode(design, child, parentId, agg, index) {
  const p = findNode(design.root, parentId);
  if (!p) throw new Error(`no node ${parentId}`);
  const parent = p.node;
  const target = agg || (parent.type === 'mvc:View' ? 'content' : defaultAggFor(parent.type, child.type));
  if (!target || !aggAccepts(parent, target, child.type)) throw new Error(`${parent.type} takes no ${child.type}${agg ? ` in ${agg}` : ''}`);
  parent.aggs[target] = parent.aggs[target] || [];
  const list = parent.aggs[target];
  list.splice(index == null || index > list.length ? list.length : index, 0, child);
  return child.id;
}

// Where a control dropped ON a node goes: into it when it takes the
// control, otherwise next to it in its parent
export function dropTarget(design, onId, childType) {
  const hit = findNode(design.root, onId);
  if (!hit) return null;
  const n = hit.node;
  if (n.type === 'mvc:View') return aggAccepts(n, 'content', childType) ? { parentId: n.id, agg: 'content', index: null } : null;
  const c = getControl(n.type);
  if (c && c.aggs) {
    for (const agg of [dropAggOf(c), ...Object.keys(c.aggs)].filter(Boolean)) {
      if (aggAccepts(n, agg, childType)) return { parentId: n.id, agg, index: null };
    }
  }
  if (hit.parent && aggAccepts(hit.parent, hit.agg, childType)) {
    return { parentId: hit.parent.id, agg: hit.agg, index: hit.index + 1 };
  }
  // climb until somebody takes it
  let cur = hit.parent;
  while (cur) {
    const up = findNode(design.root, cur.id);
    const pc = getControl(cur.type);
    const agg = cur.type === 'mvc:View' ? (aggAccepts(cur, 'content', childType) ? 'content' : null) : pc && pc.aggs ? Object.keys(pc.aggs).find((a) => aggAccepts(cur, a, childType)) : null;
    if (agg) return { parentId: cur.id, agg, index: null };
    cur = up && up.parent;
  }
  return null;
}

export function removeNode(design, id) {
  const hit = findNode(design.root, id);
  if (!hit || !hit.parent) return null;
  const list = hit.parent.aggs[hit.agg];
  list.splice(hit.index, 1);
  if (!list.length) delete hit.parent.aggs[hit.agg];
  const next = list[hit.index] || list[hit.index - 1] || hit.parent;
  return next.id;
}

export function moveNode(design, id, parentId, agg, index) {
  if (id === parentId || isAncestor(design.root, id, parentId)) return null;
  const hit = findNode(design.root, id);
  if (!hit || !hit.parent) return null;
  const p = findNode(design.root, parentId);
  if (!p) return null;
  const sameList = hit.parent.id === parentId && hit.agg === agg;
  if (!sameList && !aggAccepts(p.node, agg, hit.node.type)) return null;
  hit.parent.aggs[hit.agg].splice(hit.index, 1);
  let i = index;
  if (sameList && i != null && i > hit.index) i -= 1;
  if (!hit.parent.aggs[hit.agg].length && !sameList) delete hit.parent.aggs[hit.agg];
  p.node.aggs[agg] = p.node.aggs[agg] || [];
  const list = p.node.aggs[agg];
  list.splice(i == null || i > list.length ? list.length : i, 0, hit.node);
  return id;
}

// several nodes to one place, together and in the order of the view:
// before the node that is at `index` of the target list now (the end
// when null) - returns the id of the last, or null when the target takes
// one of them not, or would end up inside one of them
export function moveNodes(design, ids, parentId, agg, index) {
  const order = [];
  walk(design.root, (n) => { order.push(n.id); return true; });
  const list = [...new Set(ids)].filter((id) => !ids.some((o) => o !== id && isAncestor(design.root, o, id)))
    .map((id) => findNode(design.root, id)).filter((x) => x && x.parent)
    .sort((a, b) => order.indexOf(a.node.id) - order.indexOf(b.node.id));
  if (!list.length) return null;
  if (list.some((x) => x.node.id === parentId || isAncestor(design.root, x.node.id, parentId))) return null;
  const p = findNode(design.root, parentId);
  if (!p) return null;
  // a marker holds the place while the nodes leave their lists
  const marker = { id: '\u0000' };
  p.node.aggs[agg] = p.node.aggs[agg] || [];
  const target = p.node.aggs[agg];
  target.splice(index == null || index > target.length ? target.length : index, 0, marker);
  for (const x of list) {
    const h = findNode(design.root, x.node.id);
    h.parent.aggs[h.agg].splice(h.index, 1);
    if (!h.parent.aggs[h.agg].length && h.parent.aggs[h.agg] !== target) delete h.parent.aggs[h.agg];
  }
  const at = target.indexOf(marker);
  target.splice(at, 1);
  for (const [i, x] of list.entries()) {
    if (!aggAccepts(p.node, agg, x.node.type)) throw new Error(`${p.node.type} takes no ${x.node.type}${agg ? ` in ${agg}` : ''}`);
    target.splice(at + i, 0, x.node);
  }
  return list[list.length - 1].node.id;
}

export function shiftNode(design, id, delta) {
  const hit = findNode(design.root, id);
  if (!hit || !hit.parent) return null;
  const list = hit.parent.aggs[hit.agg];
  const j = hit.index + delta;
  if (j < 0 || j >= list.length) return id;
  [list[hit.index], list[j]] = [list[j], list[hit.index]];
  return id;
}

export function duplicateNode(design, id) {
  const hit = findNode(design.root, id);
  if (!hit || !hit.parent) return null;
  const copy = clone(hit.node);
  walk(copy, (n) => { n.id = newId(); });
  const list = hit.parent.aggs[hit.agg];
  const c = getControl(hit.parent.type);
  if (c && c.aggs && c.aggs[hit.agg] && c.aggs[hit.agg].single) return null;
  list.splice(hit.index + 1, 0, copy);
  return copy.id;
}

// the controls `ids`, side by side in one parent, into a new control of
// `type` in their place - returns its id; throws when they do not sit in
// one aggregation of one parent, or the parent or the wrapper refuses
export function wrapNodes(design, ids, type) {
  const hits = [...new Set(ids)].map((id) => findNode(design.root, id)).filter((x) => x && x.parent);
  if (!hits.length) throw new Error('Nothing to wrap');
  const { parent, agg } = hits[0];
  if (hits.some((x) => x.parent.id !== parent.id || x.agg !== agg)) throw new Error('Only controls side by side in one parent can be wrapped together');
  hits.sort((a, b) => a.index - b.index);
  const wrapper = createNode(type);
  wrapper.aggs = {};
  const into = defaultAggFor(type, hits[0].node.type);
  if (!into || hits.some((x) => !accepts(type, into, x.node.type))) throw new Error(`${type} takes no ${hits.find((x) => !into || !accepts(type, into, x.node.type)).node.type}`);
  const list = parent.aggs[agg];
  for (const x of [...hits].reverse()) list.splice(x.index, 1);
  if (!aggAccepts(parent, agg, type)) throw new Error(`${parent.type} takes no ${type}${agg ? ` in ${agg}` : ''}`);
  list.splice(hits[0].index, 0, wrapper);
  wrapper.aggs[into] = hits.map((x) => x.node);
  return wrapper.id;
}

// an entry of a list one place up (-1) or down (+1): attributes, fields
export function moveItem(list, index, delta) {
  const j = index + delta;
  if (!list || j < 0 || j >= list.length) return false;
  [list[index], list[j]] = [list[j], list[index]];
  return true;
}

// Sample rows pasted as text - from a spreadsheet (tab separated) or CSV
// (`;` or `,`, "quoted" cells). `header`: the first line names the
// fields; a name the table has not becomes a new string field. Without a
// header the columns fill the scalar fields in their order, and what is
// left over is counted in `ignored`. Returns { rows, added, ignored }.
export function parseSampleRows(text, fields, header) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.length) return { rows: [], added: [], ignored: 0 };
  const sep = lines.some((l) => l.includes('\t')) ? '\t' : lines[0].includes(';') ? ';' : ',';
  const cells = (line) => {
    if (sep === '\t') return line.split('\t');
    const out = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"' && !cur.trim()) { quoted = true; cur = ''; } else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const scalar = fields.filter((f) => f.type !== 'table');
  const added = [];
  let columns;
  let body = lines;
  if (header) {
    body = lines.slice(1);
    columns = cells(lines[0]).map((raw) => {
      let name = raw.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
      if (!name) return null;
      if (!/^[A-Z]/.test(name)) name = `F_${name}`;
      name = name.slice(0, 30);
      const known = fields.find((f) => f.name === name) || added.find((f) => f.name === name);
      if (known) return known.type === 'table' ? null : known;
      const f = { name, type: 'string' };
      added.push(f);
      return f;
    });
  } else {
    columns = scalar;
  }
  let ignored = 0;
  const rows = body.filter((l) => l.trim()).map((l) => {
    const row = {};
    cells(l).forEach((v, i) => {
      const f = columns[i];
      if (!f) { if (v.trim()) ignored += 1; return; }
      const t = v.trim();
      row[f.name] = f.type === 'bool' ? /^(x|true|1|yes|ja)$/i.test(t) : t;
    });
    return row;
  });
  return { rows, added, ignored };
}

// ------------------------------------------------------------- data binding

// The table attribute an aggregation's rows come from, for the node whose
// properties may then use `f` (field) values: the nearest bound aggregation
// above it
export function rowContext(design, id) {
  let hit = findNode(design.root, id);
  while (hit && hit.parent) {
    // the aggregation itself, or the one its templates are for (a grid
    // table's columns hold the templates of its rows)
    const pc = getControl(hit.parent.type);
    const def = pc && pc.aggs && pc.aggs[hit.agg];
    const boundAgg = def && def.templateFor ? def.templateFor : hit.agg;
    const binding = hit.parent.props && hit.parent.props[boundAgg];
    if (binding && binding.m === 'b') {
      const attr = design.attributes.find((a) => a.name === binding.v);
      if (attr && attr.type === 'table') return attr;
    }
    // rows of a table field of the row above (a list inside a list)
    if (binding && binding.m === 'f') {
      const outer = rowContext(design, hit.parent.id);
      const field = outer && outer.fields.find((f) => f.name === binding.v);
      if (field && field.type === 'table') return field;
    }
    hit = findNode(design.root, hit.parent.id);
  }
  return null;
}

// the field a tree repeats its children from: the first table field of
// the rows - none for a flat tree
export function childrenField(table) {
  const f = (table.fields || []).find((x) => x.type === 'table');
  return f ? f.name : null;
}

export function bindableAggs(node) {
  const c = getControl(node.type);
  if (!c || !c.aggs) return [];
  return Object.entries(c.aggs).filter(([, a]) => a.bindable).map(([n]) => n);
}

// Bind a list to a table attribute and give it one template row built from
// the table's fields - what a designer would otherwise click together cell
// by cell
// With `replace` false the template that is there stays, only the binding
// is set - for a list someone has built by hand. `viaField`: `attrName`
// is a table field of the row the list sits in (a list inside a bound
// list repeats the rows of that field).
export function bindListToTable(design, nodeId, agg, attrName, replace = true, viaField = false) {
  const hit = findNode(design.root, nodeId);
  let attr;
  if (viaField) {
    const ctx = rowContext(design, nodeId);
    attr = ctx && ctx.fields.find((x) => x.name === attrName);
  } else {
    attr = design.attributes.find((a) => a.name === attrName);
  }
  if (!hit || !attr || attr.type !== 'table') return;
  const node = hit.node;
  // the scalar fields make the template; a table field is what a tree
  // descends into, never the text of a cell. A table of table fields only
  // gets a template with the catalogue's static texts, to bind by hand
  const fields = (attr.fields || []).filter((x) => x.type !== 'table');
  const f = (i) => (fields.length ? { m: 'f', v: (fields[i] || fields[0]).name } : undefined);
  // the columns of a table: one per scalar field, or one of static text
  const cols = fields.length ? fields : [{ name: 'ITEM', type: 'string', fixed: true }];
  node.props[agg] = viaField ? { m: 'f', v: attr.name } : { m: 'b', v: attr.name };
  if (node.type === 'Tree' && childrenField(attr)) node.props[agg].arr = childrenField(attr);
  if (!replace) return;
  if (node.type === 'Tree') {
    const item = createNode('StandardTreeItem');
    if (fields.length) item.props.title = f(0); else item.props.title = { m: 's', v: 'Node' };
    node.aggs.items = [item];
  } else if (node.type === 'Table') {
    node.aggs.columns = cols.map((fld) => {
      const col = createNode('Column');
      col.aggs.header = [createNode('Text', { props: { text: label(fld.name) } })];
      return col;
    });
    const row = createNode('ColumnListItem');
    row.aggs.cells = cols.map((fld) => {
      const cell = createNode(fld.type === 'bool' ? 'CheckBox' : 'Text');
      delete cell.props.text;
      if (fld.type === 'bool') {
        cell.props.selected = { m: 'f', v: fld.name };
        cell.props.editable = { m: 's', v: 'false' };
      } else {
        cell.props.text = fld.fixed ? { m: 's', v: 'Item' } : { m: 'f', v: fld.name };
      }
      return cell;
    });
    node.aggs.items = [row];
  } else if (node.type === 'List') {
    const item = createNode('StandardListItem');
    item.props.title = fields.length ? f(0) : { m: 's', v: 'Item' };
    if (fields[1]) item.props.description = f(1);
    if (fields[2]) item.props.info = f(2);
    node.aggs.items = [item];
  } else if (node.type === 'Select' || node.type === 'ComboBox') {
    const item = createNode('core:Item');
    if (fields.length) {
      item.props.key = f(0);
      item.props.text = fields[1] ? f(1) : f(0);
    }
    node.aggs.items = [item];
  } else if (node.type === 'SegmentedButton') {
    const item = createNode('SegmentedButtonItem');
    if (fields.length) {
      item.props.key = f(0);
      item.props.text = fields[1] ? f(1) : f(0);
    }
    node.aggs.items = [item];
  } else if (node.type === 'table:Table') {
    node.aggs.columns = cols.map((fld) => {
      const col = createNode('table:Column', { props: { label: label(fld.name) }, aggs: {} });
      const cell = createNode(fld.type === 'bool' ? 'CheckBox' : 'Text');
      delete cell.props.text;
      if (fld.type === 'bool') {
        cell.props.selected = { m: 'f', v: fld.name };
        cell.props.editable = { m: 's', v: 'false' };
      } else {
        cell.props.text = fld.fixed ? { m: 's', v: 'Item' } : { m: 'f', v: fld.name };
      }
      col.aggs.template = [cell];
      return col;
    });
  }
}

// Is the content of a list's aggregation still what the catalogue starts
// it with - or what binding it to a table generated? Then binding it anew
// may replace it without asking. A table's columns count too: binding
// replaces them with the rows' template (a grid table keeps its template
// in the columns alone). `design`: to recognise what the current binding
// generated
const REPLACED = { Table: ['columns', 'items'], 'table:Table': ['columns'] };

export function hasOwnTemplate(node, agg, design) {
  const aggs = REPLACED[node.type] || [agg];
  if (aggs.every((a) => !(node.aggs[a] || []).length)) return false;
  const shape = (n, a) => JSON.stringify(n.aggs[a] || [], (k, v) => (k === 'id' ? undefined : v));
  const sameAs = (other) => aggs.every((a) => shape(node, a) === shape(other, a));
  // the catalogue's start
  if (sameAs(createNode(node.type))) return false;
  // what binding to the table it is bound to generates
  const b = node.props[agg];
  if (design && b && (b.m === 'b' || b.m === 'f')) {
    const copy = clone(design);
    bindListToTable(copy, node.id, agg, b.v, true, b.m === 'f');
    const regenerated = findNode(copy.root, node.id);
    if (regenerated && sameAs(regenerated.node)) return false;
  }
  if (REPLACED[node.type]) return true;
  // one template whose values are all fields: generated by a binding
  const items = node.aggs[agg] || [];
  const generated = (n) => Object.values(n.props).every((v) => v.m === 'f' || (v.m === 's' && v.v === 'false'))
    && Object.values(n.aggs).flat().every(generated);
  return !(items.length === 1 && generated(items[0]));
}

export function unbindList(design, nodeId, agg) {
  const hit = findNode(design.root, nodeId);
  if (!hit) return;
  delete hit.node.props[agg];
}

function label(fieldName) {
  return fieldName.toLowerCase().split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Every event name the design raises, in tree order, each once
export function collectEvents(design) {
  const out = [];
  walk(design.root, (n) => {
    for (const ev of Object.values(n.events || {})) if (ev && !out.includes(ev)) out.push(ev);
  });
  return out;
}

// the path of an attribute in a UI5 expression: /NAME, as abap2UI5 sends
// it - {/NAME}, {= ${/NAME} }, {path:'/NAME'}
function pathPattern(name) {
  return new RegExp(`([{'"$:\\s])/${name.replace(/[^\w]/g, '')}(?![\\w/])`, 'gi');
}

// Where an attribute is used - bound, or named in an expression - so the
// data panel can refuse to delete a used one silently
export function attributeUsage(design, name) {
  let count = 0;
  const re = pathPattern(name);
  walk(design.root, (n) => {
    for (const v of Object.values(n.props || {})) {
      if (v && v.m === 'b' && v.v === name) count += 1;
      else if (v && v.m === 'x' && typeof v.v === 'string' && v.v.match(re)) count += 1;
    }
  });
  return count;
}

// a renamed attribute: its bindings follow, and so do the expressions
// that name its path
export function renameAttribute(design, from, to) {
  const re = pathPattern(from);
  walk(design.root, (n) => {
    for (const v of Object.values(n.props || {})) {
      if (v && v.m === 'b' && v.v === from) v.v = to;
      else if (v && v.m === 'x' && typeof v.v === 'string') v.v = v.v.replace(re, `$1/${to.toUpperCase()}`);
    }
  });
}

// ------------------------------------------------------------- validation

// the names the generated class uses itself - its methods included: an
// attribute on_event would clash with the method of that name
const ABAP_RESERVED = new Set(['client', 'view', 'me', 'result', 'super', 'data', 'type', 'table', 'value', 'line', 'index',
  'view_display', 'on_event', 'model_init', 'main', 'z2ui5_if_app']);

export function checkClassName(name) {
  if (!name) return 'Class name is empty';
  if (!/^(Z|Y|\/[A-Z0-9_]{1,10}\/)[A-Z0-9_]+$/.test(name)) return 'Class name must start with Z, Y or a namespace /XYZ/ and use A-Z, 0-9 and _';
  if (name.length > 30) return 'Class name is longer than 30 characters';
  return null;
}

export function checkAttributeName(name) {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) return 'Use a-z, 0-9 and _, starting with a letter';
  if (name.length > 30) return 'Longer than 30 characters';
  if (ABAP_RESERVED.has(name)) return `"${name}" is taken by the generated class`;
  return null;
}

export function checkFieldName(name) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return 'Use A-Z, 0-9 and _, starting with a letter';
  if (name.length > 30) return 'Longer than 30 characters';
  return null;
}

export function checkEventName(name) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return 'Use A-Z, 0-9 and _, starting with a letter';
  if (name.length > 60) return 'Longer than 60 characters';
  return null;
}

// Problems that would make the generated class fail to compile or the
// view fail to render - shown in the UI, asserted empty in the tests
export function validate(design) {
  const issues = [];
  const cn = checkClassName(design.className);
  if (cn) issues.push({ level: 'error', text: cn });
  const names = new Set();
  for (const a of design.attributes) {
    const e = checkAttributeName(a.name);
    if (e) issues.push({ level: 'error', text: `Attribute ${a.name}: ${e}` });
    if (names.has(a.name)) issues.push({ level: 'error', text: `Attribute ${a.name} is defined twice` });
    names.add(a.name);
    if (a.type === 'table') {
      const checkFields = (fields, where) => {
        if (!fields.length) issues.push({ level: 'error', text: `Table ${where} has no fields` });
        const fn = new Set();
        for (const f of fields) {
          const fe = checkFieldName(f.name);
          if (fe) issues.push({ level: 'error', text: `Field ${where}-${f.name}: ${fe}` });
          if (fn.has(f.name)) issues.push({ level: 'error', text: `Field ${where}-${f.name} is defined twice` });
          fn.add(f.name);
          if (f.type === 'table') checkFields(f.fields || [], `${where}-${f.name}`);
        }
      };
      checkFields(a.fields, a.name);
      for (const t of tableTypes(a)) {
        if (t.name.length > 30) issues.push({ level: 'error', text: `Table ${a.name}: its row type ${t.name} is longer than 30 characters` });
      }
    }
  }
  const allTypes = design.attributes.filter((a) => a.type === 'table').flatMap((a) => tableTypes(a).map((t) => [t.name, a.name]));
  const seenTypes = new Map();
  for (const [t, owner] of allTypes) {
    if (seenTypes.has(t) && seenTypes.get(t) !== owner) issues.push({ level: 'error', text: `Tables ${seenTypes.get(t)} and ${owner} share the row type ${t} - rename one` });
    seenTypes.set(t, seenTypes.get(t) || owner);
  }
  const attrByName = new Map(design.attributes.map((a) => [a.name, a]));
  for (const a of design.attributes) {
    if (!attributeUsage(design, a.name)) issues.push({ level: 'warning', text: `Attribute ${a.name} is public, but nothing binds it - bind it or remove it`, fix: { kind: 'removeAttribute', name: a.name, label: 'Remove' } });
    const rowValues = (fields, rows, where) => (rows || []).flatMap((r) => fields.flatMap((f) => (f.type === 'table'
      ? rowValues(f.fields || [], r[f.name], `${where}-${f.name}`)
      : [[f.type, r[f.name], `${where}-${f.name}`]])));
    const values = a.type === 'table' ? rowValues(a.fields, a.rows, a.name) : [[a.type, a.value, a.name]];
    for (const [type, v, where] of values) {
      const w = checkValue(type, v);
      if (w) issues.push({ level: 'warning', text: `${where}: ${w}` });
    }
  }
  walk(design.root, (n, parent, agg) => {
    const nodeDef = getControl(n.type);
    for (const [p, v] of Object.entries(n.props || {})) {
      if (!v) continue;
      if (v.m === 's') {
        const pd = nodeDef && nodeDef.props && nodeDef.props[p];
        const w = checkStatic(pd, v.v);
        // a number or an enum value UI5 cannot parse fails the view; a size
        // or a flag it logs and replaces by the default
        if (w) issues.push({ level: ['int', 'float', 'enum'].includes(pd.type) ? 'error' : 'warning', text: `${n.type}.${p}: ${w}`, node: n.id, prop: p, fix: { kind: 'resetProp', node: n.id, prop: p, label: 'Reset to default' } });
      }
      if (v.m === 'b' && !names.has(v.v)) {
        const isAgg = bindableAggs(n).includes(p);
        const pd = nodeDef && nodeDef.props && nodeDef.props[p];
        issues.push({
          level: 'error', text: `${n.type}.${p} is bound to ${v.v}, which is not an attribute`, node: n.id, prop: p,
          fix: v.v && !checkAttributeName(v.v) ? { kind: 'createAttribute', name: v.v, type: isAgg ? 'table' : attrTypeFor(pd), label: `Create ${v.v}` } : undefined,
        });
      }
      else if (v.m === 'b') {
        const attr = attrByName.get(v.v);
        const isAgg = bindableAggs(n).includes(p);
        if (isAgg && attr.type !== 'table') issues.push({ level: 'error', text: `${n.type}.${p} repeats the rows of ${v.v}, which is not a table`, node: n.id });
        if (!isAgg && attr.type === 'table') issues.push({ level: 'error', text: `${n.type}.${p} is bound to the table ${v.v} - a property takes a single value`, node: n.id });
        const nc = getControl(n.type);
        const def = nc && nc.props && nc.props[p];
        if (def && !isAgg && !attributeFits(def, attr.type)) issues.push({ level: 'warning', text: `${n.type}.${p} is ${def.type}, ${v.v} is ${attr.type}`, node: n.id });
      }
      if (v.m === 'f') {
        const ctx = rowContext(design, n.id);
        const field = ctx && ctx.fields.find((f) => f.name === v.v);
        const isAgg = bindableAggs(n).includes(p);
        if (!ctx) issues.push({ level: 'error', text: `${n.type}.${p} uses field ${v.v} outside a bound list`, node: n.id });
        else if (!field) issues.push({ level: 'error', text: `${n.type}.${p}: ${ctx.name} has no field ${v.v}`, node: n.id });
        else if (isAgg && field.type !== 'table') issues.push({ level: 'error', text: `${n.type}.${p} repeats the rows of field ${v.v}, which is not a table`, node: n.id });
        else if (!isAgg && field.type === 'table') issues.push({ level: 'error', text: `${n.type}.${p} is bound to the table field ${v.v} - a property takes a single value`, node: n.id });
      }
    }
    for (const [e, name] of Object.entries(n.events || {})) {
      const err = name && checkEventName(name);
      if (err) issues.push({ level: 'error', text: `${n.type}.${e}: ${err}`, node: n.id });
    }
    for (const a of bindableAggs(n)) {
      const b = n.props[a];
      const def = getControl(n.type).aggs[a];
      if (b && (b.m === 'b' || b.m === 'f') && !def.noTemplate && (n.aggs[a] || []).length !== 1) {
        const many = (n.aggs[a] || []).length > 1;
        issues.push({ level: 'warning', text: `${n.type}: a bound ${a} aggregation needs exactly one template item`, node: n.id, fix: { kind: 'template', node: n.id, agg: a, label: many ? 'Keep the first as template' : 'Build a template' } });
      }
      if (n.type === 'Tree' && !(b && (b.m === 'b' || b.m === 'f' || b.m === 'x'))) {
        issues.push({ level: 'error', text: 'Tree: its items have to be bound to a table - UI5 fails on static tree items', node: n.id, fix: { kind: 'nodesTable', node: n.id, agg: a, label: 'Create nodes table' } });
      }
      if (b && b.arr) {
        const ctx = b.m === 'b' ? attrByName.get(b.v) : null;
        if (ctx && !(ctx.fields || []).some((f) => f.name === b.arr && f.type === 'table')) issues.push({ level: 'error', text: `${n.type}.${a}: ${b.v} has no table field ${b.arr} to take the children from`, node: n.id });
      }
    }
    const c = getControl(n.type);
    if (c && c.input && !rowContext(design, n.id)) {
      const v = n.props[c.input];
      const wired = (v && (v.m === 'b' || v.m === 'x')) || Object.values(n.events || {}).some(Boolean);
      if (!wired) issues.push({ level: 'info', text: `${n.type}: what the user enters goes nowhere - bind ${c.input} to an attribute (or name an event)`, node: n.id, prop: c.input, fix: { kind: 'bindNew', node: n.id, prop: c.input, label: 'Bind to a new attribute' } });
    }
    if (parent && !CONTROLS[n.type] && n.type !== 'mvc:View') {
      issues.push({ level: 'info', text: `${n.type} is not in the palette - not checked against UI5 1.71`, node: n.id });
    }
    return true;
  });
  return issues;
}

// A sample value the class cannot carry as it is: more than two decimals
// (the type is p LENGTH 16 DECIMALS 2), a time without seconds, a date or
// time in another shape than the data panel writes
export function checkValue(type, v) {
  if (v === '' || v == null) return null;
  const t = String(v).trim();
  if (type === 'decimal') {
    if (!Number.isFinite(Number(t))) return `"${t}" is not a number`;
    if (/^-?\d*\.\d{3,}$/.test(t) || (/e/i.test(t) && Number(t) !== Math.round(Number(t) * 100) / 100)) return `"${t}" has more than 2 decimals - the class rounds it`;
  }
  if (type === 'int' && !/^-?\d+$/.test(t)) return `"${t}" is not a whole number`;
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return `"${t}" is not a date (yyyy-mm-dd)`;
  if (type === 'time' && !/^\d{2}:\d{2}:\d{2}$/.test(t)) return `"${t}" is not a time (hh:mm:ss)`;
  if (type === 'time' && t === '00:00:00') return 'midnight is ABAP\'s initial time - the app gets no time, as if it were empty';
  return null;
}

// sap.ui.core.CSSSize as UI5 1.71 checks it (sap/ui/core/library.js)
const CSS_UNIT = '([rR][eE][mM]|[eE][mM]|[eE][xX]|[pP][xX]|[cC][mM]|[mM][mM]|[iI][nN]|[pP][tT]|[pP][cC]|[vV][wW]|[vV][hH]|[vV][mM][iI][nN]|[vV][mM][aA][xX]|%)';
const CSS_NUM = '([0-9]+|[0-9]*\\.[0-9]+)';
const CSS_SIZE = new RegExp(`^(auto|inherit|[-+]?(0*|${CSS_NUM}${CSS_UNIT})|calc\\(\\s*(\\(\\s*)*[-+]?(${CSS_NUM}${CSS_UNIT}?)(\\s*(\\)\\s*)*(\\s[-+]\\s|[*\\/])\\s*(\\(\\s*)*([-+]?(${CSS_NUM}${CSS_UNIT}?)))*\\s*(\\)\\s*)*\\))$`);

// A static value UI5 does not take for the type of its property - it logs
// it, and the control falls back to its default: null when it fits
export function checkStatic(def, v) {
  if (!def || v === '' || v == null) return null;
  const t = String(v);
  if (def.type === 'int' && !/^[-+]?\d+$/.test(t)) return `"${t}" is not a whole number`;
  if (def.type === 'float' && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return `"${t}" is not a number`;
  if (def.type === 'boolean' && t !== 'true' && t !== 'false') return `"${t}" is not true or false`;
  if (def.type === 'cssSize' && !CSS_SIZE.test(t)) return `"${t}" is not a CSS size - e.g. 10rem, 50%, 200px or auto`;
  if (def.type === 'enum' && def.values && !def.values.includes(t)) return `"${t}" is not one of ${def.values.join(', ')}`;
  return null;
}

// Does an attribute of `attrType` fit a property of `def`? A boolean takes
// a flag, a number a number, text takes anything that prints
// the attribute type a property binds best: a flag, a number, a text
export function attrTypeFor(def) {
  if (def && def.type === 'boolean') return 'bool';
  if (def && def.type === 'int') return 'int';
  if (def && def.type === 'float') return 'decimal';
  return 'string';
}

export function attributeFits(def, attrType) {
  if (attrType === 'table') return false;
  if (def.type === 'boolean') return attrType === 'bool';
  if (def.type === 'int') return attrType === 'int';
  if (def.type === 'float') return attrType === 'int' || attrType === 'decimal';
  return attrType !== 'bool';
}

// the row type of a table attribute (t_rows -> ty_s_rows), and of a table
// field inside it (field NODES of t_rows -> ty_s_rows_nodes)
export function typeName(attr, path = []) {
  const base = attr.name.startsWith('t_') ? attr.name.slice(2) : attr.name;
  return [`ty_s_${base}`, ...path.map((f) => f.toLowerCase())].join('_');
}

// Every table type a table attribute needs, innermost first: [{ name,
// fields, path }] - a field of type table has fields of its own
export function tableTypes(attr) {
  const out = [];
  const walkFields = (fields, path) => {
    for (const f of fields) if (f.type === 'table') walkFields(f.fields || [], [...path, f.name]);
    out.push({ name: typeName(attr, path), fields, path });
  };
  walkFields(attr.fields || [], []);
  return out;
}

// The model the preview binds: what abap2UI5 would send, keys upper case
export function previewModel(design) {
  const out = {};
  for (const a of design.attributes) {
    const key = a.name.toUpperCase();
    if (a.type === 'table') {
      out[key] = jsRows(a.fields, a.rows);
    } else {
      out[key] = jsValue(a.type, a.value);
    }
  }
  return out;
}

function jsRows(fields, rows) {
  return (rows || []).map((r) => {
    const row = {};
    for (const f of fields) row[f.name] = f.type === 'table' ? jsRows(f.fields || [], r[f.name]) : jsValue(f.type, r[f.name]);
    return row;
  });
}

// what abap2UI5 sends for the value model_init seeds: the class rounds a
// decimal to 2 places and pads a time to seconds, so does the canvas
function jsValue(type, v) {
  if (type === 'bool') return v === true || v === 'true' || v === 'X';
  // + 0: a -0 is a 0, as abap2UI5 sends it
  if (type === 'int') return v === '' || v == null ? 0 : (parseInt(v, 10) || 0) + 0;
  if (type === 'decimal') return v === '' || v == null ? 0 : Math.round((Number(String(v).trim()) || 0) * 100) / 100 + 0;
  // midnight is ABAP's initial time, which abap2UI5 sends as no time
  if (type === 'time') {
    const t = /^\d{2}:\d{2}$/.test(String(v)) ? `${v}:00` : v == null ? '' : String(v);
    return t === '00:00:00' ? '' : t;
  }
  if (type === 'date' && v === '0000-00-00') return '';
  // the control characters XML forbids: abap2UI5 drops them, the class
  // does not write them
  return v == null ? '' : String(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}
