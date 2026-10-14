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

import { CONTROLS, getControl, defaultAggFor, accepts, dropAggOf } from './catalog.js';

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
  d.attributes = Array.isArray(d.attributes) ? d.attributes : [];
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

// ------------------------------------------------------------- data binding

// The table attribute an aggregation's rows come from, for the node whose
// properties may then use `f` (field) values: the nearest bound aggregation
// above it
export function rowContext(design, id) {
  let hit = findNode(design.root, id);
  while (hit && hit.parent) {
    const binding = hit.parent.props && hit.parent.props[hit.agg];
    if (binding && binding.m === 'b') {
      const attr = design.attributes.find((a) => a.name === binding.v);
      if (attr && attr.type === 'table') return attr;
    }
    hit = findNode(design.root, hit.parent.id);
  }
  return null;
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
// is set - for a list someone has built by hand
export function bindListToTable(design, nodeId, agg, attrName, replace = true) {
  const hit = findNode(design.root, nodeId);
  const attr = design.attributes.find((a) => a.name === attrName);
  if (!hit || !attr || attr.type !== 'table') return;
  const node = hit.node;
  const fields = attr.fields.length ? attr.fields : [{ name: 'TEXT', type: 'string' }];
  const f = (i) => ({ m: 'f', v: (fields[i] || fields[0]).name });
  node.props[agg] = { m: 'b', v: attr.name };
  if (!replace) return;
  if (node.type === 'Table') {
    node.aggs.columns = fields.map((fld) => {
      const col = createNode('Column');
      col.aggs.header = [createNode('Text', { props: { text: label(fld.name) } })];
      return col;
    });
    const row = createNode('ColumnListItem');
    row.aggs.cells = fields.map((fld) => {
      const cell = createNode(fld.type === 'bool' ? 'CheckBox' : 'Text');
      delete cell.props.text;
      if (fld.type === 'bool') {
        cell.props.selected = { m: 'f', v: fld.name };
        cell.props.editable = { m: 's', v: 'false' };
      } else {
        cell.props.text = { m: 'f', v: fld.name };
      }
      return cell;
    });
    node.aggs.items = [row];
  } else if (node.type === 'List') {
    const item = createNode('StandardListItem');
    item.props.title = f(0);
    if (fields[1]) item.props.description = f(1);
    if (fields[2]) item.props.info = f(2);
    node.aggs.items = [item];
  } else if (node.type === 'Select' || node.type === 'ComboBox') {
    const item = createNode('core:Item');
    item.props.key = f(0);
    item.props.text = fields[1] ? f(1) : f(0);
    node.aggs.items = [item];
  } else if (node.type === 'SegmentedButton') {
    const item = createNode('SegmentedButtonItem');
    item.props.key = f(0);
    item.props.text = fields[1] ? f(1) : f(0);
    node.aggs.items = [item];
  }
}

// Is the content of a list's aggregation still what the catalogue starts
// it with - or what binding it to a table generated? Then binding it anew
// may replace it without asking
export function hasOwnTemplate(node, agg) {
  const items = node.aggs[agg] || [];
  if (!items.length) return false;
  const c = getControl(node.type);
  const init = (c && c.init && c.init.aggs && c.init.aggs[agg]) || [];
  const same = (n, spec) => n.type === spec.type
    && Object.entries(spec.props || {}).every(([k, v]) => n.props[k] && n.props[k].m === 's' && n.props[k].v === v)
    && Object.keys(n.props).every((k) => (spec.props || {})[k] !== undefined || n.props[k].m === 'f');
  if (items.length === init.length && items.every((n, i) => same(n, init[i]))) return false;
  // one template whose values are all fields: generated by a binding
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

// Where an attribute is used, so the data panel can refuse to delete a
// bound one silently
export function attributeUsage(design, name) {
  let count = 0;
  walk(design.root, (n) => {
    for (const v of Object.values(n.props || {})) if (v && v.m === 'b' && v.v === name) count += 1;
  });
  return count;
}

export function renameAttribute(design, from, to) {
  walk(design.root, (n) => {
    for (const v of Object.values(n.props || {})) if (v && v.m === 'b' && v.v === from) v.v = to;
  });
}

// ------------------------------------------------------------- validation

const ABAP_RESERVED = new Set(['client', 'view', 'me', 'result', 'super', 'data', 'type', 'table', 'value', 'line', 'index']);

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
      if (!a.fields.length) issues.push({ level: 'error', text: `Table ${a.name} has no fields` });
      const fn = new Set();
      for (const f of a.fields) {
        const fe = checkFieldName(f.name);
        if (fe) issues.push({ level: 'error', text: `Field ${a.name}-${f.name}: ${fe}` });
        if (fn.has(f.name)) issues.push({ level: 'error', text: `Field ${a.name}-${f.name} is defined twice` });
        fn.add(f.name);
      }
      if (typeName(a).length > 30) issues.push({ level: 'error', text: `Table ${a.name}: its row type ${typeName(a)} is longer than 30 characters` });
      const twin = design.attributes.find((b) => b !== a && b.type === 'table' && typeName(b) === typeName(a));
      if (twin && design.attributes.indexOf(twin) < design.attributes.indexOf(a)) {
        issues.push({ level: 'error', text: `Tables ${twin.name} and ${a.name} share the row type ${typeName(a)} - rename one` });
      }
    }
  }
  const attrByName = new Map(design.attributes.map((a) => [a.name, a]));
  for (const a of design.attributes) {
    if (!attributeUsage(design, a.name)) issues.push({ level: 'warning', text: `Attribute ${a.name} is public, but nothing binds it - bind it or remove it` });
    const values = a.type === 'table' ? (a.rows || []).flatMap((r) => a.fields.map((f) => [f.type, r[f.name], `${a.name}-${f.name}`])) : [[a.type, a.value, a.name]];
    for (const [type, v, where] of values) {
      const w = checkValue(type, v);
      if (w) issues.push({ level: 'warning', text: `${where}: ${w}` });
    }
  }
  walk(design.root, (n, parent, agg) => {
    for (const [p, v] of Object.entries(n.props || {})) {
      if (!v) continue;
      if (v.m === 'b' && !names.has(v.v)) issues.push({ level: 'error', text: `${n.type}.${p} is bound to ${v.v}, which is not an attribute`, node: n.id });
      else if (v.m === 'b') {
        const attr = attrByName.get(v.v);
        const isAgg = bindableAggs(n).includes(p);
        if (isAgg && attr.type !== 'table') issues.push({ level: 'error', text: `${n.type}.${p} repeats the rows of ${v.v}, which is not a table`, node: n.id });
        if (!isAgg && attr.type === 'table') issues.push({ level: 'error', text: `${n.type}.${p} is bound to the table ${v.v} - a property takes a single value`, node: n.id });
        const def = CONTROLS[n.type] && CONTROLS[n.type].props && CONTROLS[n.type].props[p];
        if (def && !isAgg && !attributeFits(def, attr.type)) issues.push({ level: 'warning', text: `${n.type}.${p} is ${def.type}, ${v.v} is ${attr.type}`, node: n.id });
      }
      if (v.m === 'f') {
        const ctx = rowContext(design, n.id);
        if (!ctx) issues.push({ level: 'error', text: `${n.type}.${p} uses field ${v.v} outside a bound list`, node: n.id });
        else if (!ctx.fields.some((f) => f.name === v.v)) issues.push({ level: 'error', text: `${n.type}.${p}: ${ctx.name} has no field ${v.v}`, node: n.id });
      }
    }
    for (const [e, name] of Object.entries(n.events || {})) {
      const err = name && checkEventName(name);
      if (err) issues.push({ level: 'error', text: `${n.type}.${e}: ${err}`, node: n.id });
    }
    for (const a of bindableAggs(n)) {
      const b = n.props[a];
      if (b && b.m === 'b' && (n.aggs[a] || []).length !== 1) {
        issues.push({ level: 'warning', text: `${n.type}: a bound ${a} aggregation needs exactly one template item`, node: n.id });
      }
    }
    const c = CONTROLS[n.type];
    if (c && c.input && !rowContext(design, n.id)) {
      const v = n.props[c.input];
      const wired = (v && (v.m === 'b' || v.m === 'x')) || Object.values(n.events || {}).some(Boolean);
      if (!wired) issues.push({ level: 'info', text: `${n.type}: what the user enters goes nowhere - bind ${c.input} to an attribute (or name an event)`, node: n.id });
    }
    if (parent && !CONTROLS[n.type] && n.type !== 'mvc:View') {
      issues.push({ level: 'info', text: `${n.type} is not in the palette - kept as imported`, node: n.id });
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
    if (!/^-?\d+(\.\d+)?$/.test(t)) return `"${t}" is not a number`;
    if ((t.split('.')[1] || '').length > 2) return `"${t}" has more than 2 decimals - the class rounds it`;
  }
  if (type === 'int' && !/^-?\d+$/.test(t)) return `"${t}" is not a whole number`;
  if (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(t)) return `"${t}" is not a date (yyyy-mm-dd)`;
  if (type === 'time' && !/^\d{2}:\d{2}:\d{2}$/.test(t)) return `"${t}" is not a time (hh:mm:ss)`;
  return null;
}

// Does an attribute of `attrType` fit a property of `def`? A boolean takes
// a flag, a number a number, text takes anything that prints
export function attributeFits(def, attrType) {
  if (attrType === 'table') return false;
  if (def.type === 'boolean') return attrType === 'bool';
  if (def.type === 'int') return attrType === 'int';
  if (def.type === 'float') return attrType === 'int' || attrType === 'decimal';
  return attrType !== 'bool';
}

export function typeName(attr) {
  const base = attr.name.startsWith('t_') ? attr.name.slice(2) : attr.name;
  return `ty_s_${base}`;
}

// The model the preview binds: what abap2UI5 would send, keys upper case
export function previewModel(design) {
  const out = {};
  for (const a of design.attributes) {
    const key = a.name.toUpperCase();
    if (a.type === 'table') {
      out[key] = (a.rows || []).map((r) => {
        const row = {};
        for (const f of a.fields) row[f.name] = jsValue(f.type, r[f.name]);
        return row;
      });
    } else {
      out[key] = jsValue(a.type, a.value);
    }
  }
  return out;
}

// what abap2UI5 sends for the value model_init seeds: the class rounds a
// decimal to 2 places and pads a time to seconds, so does the canvas
function jsValue(type, v) {
  if (type === 'bool') return v === true || v === 'true' || v === 'X';
  if (type === 'int') return v === '' || v == null ? 0 : parseInt(v, 10) || 0;
  if (type === 'decimal') return v === '' || v == null ? 0 : Math.round((Number(v) || 0) * 100) / 100;
  if (type === 'time' && /^\d{2}:\d{2}$/.test(String(v))) return `${v}:00`;
  return v == null ? '' : String(v);
}
