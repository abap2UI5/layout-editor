// Edits that start from the UI: inserting a control or a building block
// at the selection or at a drop, moving by drop, and the clipboard.
import {
  createNode, clone, walk, findNode, newId, aggAccepts, insertNode, dropTarget, removeNode, moveNode, bindableAggs, bindListToTable,
  isAncestor, attrTypeFor, checkAttributeName,
} from '../model.js';
import { splitType } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { state, commit, ancestors, selectedIds, selectMany } from './store.js';
import { toast, displayType } from './dom.js';
import { describeControl } from './preview.js';
import { renderInsert } from './insert.js';

export function addControl(type, onId = state.selected) {
  let id = null;
  commit((d) => {
    const t = dropTarget(d, onId || 'root', type);
    if (!t) {
      toast(`${displayType(type)} does not fit here`);
      return undefined;
    }
    id = insertNode(d, createNode(type), t.parentId, t.agg, t.index);
    return id;
  });
  if (id) offerRows(id);
}

// A control that repeats rows (a list, a table, a tree) just inserted:
// one click binds it to a new table attribute of the class - a tree to
// one with a table field for its children
export function offerRows(id) {
  const hit = findNode(state.design.root, id);
  if (!hit) return;
  const node = hit.node;
  const agg = bindableAggs(node)[0];
  if (!agg || node.props[agg]) return;
  const tree = node.type === 'Tree';
  toast(`${displayType(node.type)}: ${tree ? 'its nodes come from a table with a table field' : 'its rows can come from a table attribute of the class'}`, {
    label: tree ? 'Create nodes table' : 'Create table attribute',
    run: () => commit((d) => {
      // deleted (or undone) since the offer: no table for nobody
      if (!findNode(d.root, node.id)) return undefined;
      const name = newTableAttribute(d, tree);
      bindListToTable(d, node.id, agg, name);
      return node.id;
    }),
  });
}

// a new table attribute with sample rows: t_items, with TITLE and INFO -
// or, for a tree, t_nodes with TEXT and the table field NODES
export function newTableAttribute(d, tree = false) {
  const base = tree ? 't_nodes' : 't_items';
  let i = 1;
  let name = base;
  while (d.attributes.some((a) => a.name === name)) name = `${base}${++i}`;
  d.attributes.push(tree
    ? {
      name, type: 'table',
      fields: [{ name: 'TEXT', type: 'string' }, { name: 'NODES', type: 'table', fields: [{ name: 'TEXT', type: 'string' }] }],
      rows: [{ TEXT: 'First', NODES: [{ TEXT: 'First child' }, { TEXT: 'Second child' }] }, { TEXT: 'Second', NODES: [] }],
    }
    : {
      name, type: 'table',
      fields: [{ name: 'TITLE', type: 'string' }, { name: 'INFO', type: 'string' }],
      rows: [{ TITLE: 'First', INFO: 'A' }, { TITLE: 'Second', INFO: 'B' }, { TITLE: 'Third', INFO: 'C' }],
    });
  return name;
}

export function insertPattern(id, onId, place) {
  const pattern = PATTERNS.find((p) => p.id === id);
  if (!pattern) return;
  commit((d) => {
    const nodes = pattern.nodes.map((spec) => createNode(spec.type, spec));
    let t = place;
    if (!t && pattern.agg) {
      // a pattern meant for one aggregation (a page footer) goes there when
      // the target, or one of its ancestors, has it free
      const chain = [findNode(d.root, onId)?.node, ...ancestors(onId).reverse()].filter(Boolean);
      const host = chain.find((n) => aggAccepts(n, pattern.agg, nodes[0].type));
      if (host) t = { parentId: host.id, agg: pattern.agg, index: null };
    }
    t = t || dropTarget(d, onId || 'root', nodes[0].type);
    if (!t) {
      toast(`${pattern.title} does not fit here`);
      return undefined;
    }
    let index = t.index;
    let first = null;
    for (const n of nodes) {
      insertNode(d, n, t.parentId, t.agg, index);
      if (index != null) index += 1;
      first = first || n.id;
    }
    return first;
  });
}

// Any UI5 control by its class name: the canvas describes it, then it is
// inserted like one of the palette's
export async function addControlByName(className, onId = state.selected) {
  try {
    const type = await describeControl(className);
    addControl(type, onId);
    renderInsert();
  } catch (err) {
    toast(err.message);
  }
}

// the place next to a node: before it or after it in its parent's list
function placeBeside(onId, zone) {
  const hit = findNode(state.design.root, onId);
  if (!hit || !hit.parent || (zone !== 'before' && zone !== 'after')) return null;
  return { parentId: hit.parent.id, agg: hit.agg, index: hit.index + (zone === 'after' ? 1 : 0) };
}

// a drop: "dsg:new:<type>", "dsg:pattern:<id>", "dsg:move:<id>" or
// "dsg:paste" onto a node, or into an aggregation / at a position (`place`);
// `zone` is where on the node the canvas saw the pointer (before / inside /
// after)
export function handleDrop(data, onId, place, zone) {
  const m = /^dsg:(new|move|pattern|paste):(.*)$/.exec(data || '');
  if (!m) return;
  const [, kind, what] = m;
  place = place || placeBeside(onId, zone);
  if (kind === 'paste') { pasteNodes(onId, place); return; }
  if (kind === 'pattern') {
    insertPattern(what, onId, place);
  } else if (kind === 'new') {
    if (!place) { addControl(what, onId); return; }
    let id = null;
    commit((d) => {
      const p = findNode(d.root, place.parentId);
      if (!p || !aggAccepts(p.node, place.agg, what)) {
        toast(`${displayType(what)} does not fit here`);
        return undefined;
      }
      id = insertNode(d, createNode(what), place.parentId, place.agg, place.index);
      return id;
    });
    if (id) offerRows(id);
  } else {
    commit((d) => {
      const hit = findNode(d.root, what);
      if (!hit) return undefined;
      const t = place || dropTarget(d, onId, hit.node.type);
      if (!t) return undefined;
      const r = moveNode(d, what, t.parentId, t.agg, t.index);
      if (!r) toast('It cannot go there');
      return r || undefined;
    });
  }
}


// a new attribute for property `p` of a node, named after both, typed
// after the property, with its value as the start - the property is bound
// to it; returns the name
export function newAttributeFor(d, nodeId, p, def) {
  const n = findNode(d.root, nodeId).node;
  const base = `${splitType(n.type).name}_${p}`.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 26);
  let name = base;
  let i = 1;
  while (d.attributes.some((a) => a.name === name) || checkAttributeName(name)) name = `${base}${++i}`;
  const cur = n.props[p];
  const type = attrTypeFor(def);
  d.attributes.push({ name, type, value: cur && cur.m === 's' ? (type === 'bool' ? cur.v === 'true' : cur.v) : type === 'bool' ? false : '' });
  n.props[p] = { m: 'b', v: name };
  return name;
}


// the selection as text: design nodes in JSON, with a marker so a paste
// knows them - the system clipboard carries them between designs and tabs,
// the editor's own copy covers a browser that refuses to read the clipboard
const CLIP_MARK = 'abap2ui5-designer:node';

export function copySelection(cut) {
  const root = state.design.root;
  const ids = selectedIds().filter((id) => !selectedIds().some((o) => o !== id && isAncestor(root, o, id)));
  const hits = ids.map((id) => findNode(root, id)).filter((x) => x && x.parent);
  if (!hits.length) return;
  // in the order of the view, whatever the order of the clicks
  const order = [];
  walk(root, (n) => { order.push(n.id); return true; });
  hits.sort((a, b) => order.indexOf(a.node.id) - order.indexOf(b.node.id));
  const nodes = hits.map((x) => x.node);
  const text = JSON.stringify(nodes.length === 1 ? { [CLIP_MARK]: 1, node: nodes[0] } : { [CLIP_MARK]: 1, nodes });
  state.clipboard = text;
  try { navigator.clipboard.writeText(text).catch(() => {}); } catch { /* no clipboard */ }
  if (cut) {
    commit((d) => {
      let next;
      for (const n of nodes) next = removeNode(d, n.id) || next;
      return next && findNode(d.root, next) ? next : 'root';
    });
  }
  const what = nodes.length === 1 ? displayType(nodes[0].type) : `${nodes.length} controls`;
  toast(`${what} ${cut ? 'cut' : 'copied'}`);
}

export async function pasteSelection() {
  let text = state.clipboard;
  try {
    const sys = await navigator.clipboard.readText();
    if (sys && sys.includes(CLIP_MARK)) text = sys;
  } catch { /* permission or no clipboard - the editor's own copy */ }
  if (!text) { toast('Nothing to paste'); return; }
  pasteNodes(state.selected, null, text);
}

function pasteNodes(onId, place, text = state.clipboard) {
  let nodes;
  try {
    const parsed = JSON.parse(text);
    nodes = parsed && parsed[CLIP_MARK] ? parsed.nodes || (parsed.node ? [parsed.node] : null) : null;
  } catch { nodes = null; }
  if (!nodes || !nodes.length) { toast('Nothing to paste'); return; }
  const fresh = nodes.map((node) => {
    const f = clone(node);
    walk(f, (n) => { n.id = newId(); return true; });
    return f;
  });
  const ids = [];
  commit((d) => {
    const t = place || dropTarget(d, onId || 'root', fresh[0].type);
    if (!t) { toast(`${displayType(fresh[0].type)} does not fit here`); return undefined; }
    const p = findNode(d.root, t.parentId);
    if (!p || !aggAccepts(p.node, t.agg, fresh[0].type)) { toast(`${displayType(fresh[0].type)} does not fit here`); return undefined; }
    let index = t.index;
    for (const f of fresh) {
      if (!p || !aggAccepts(p.node, t.agg, f.type)) {
        // nothing of a paste that does not fit as a whole
        throw new Error(`${displayType(f.type)} does not fit here`);
      }
      ids.push(insertNode(d, f, t.parentId, t.agg, index));
      if (index != null) index += 1;
    }
    return ids[ids.length - 1];
  });
  if (ids.length > 1 && findNode(state.design.root, ids[0])) selectMany(ids);
}
