// Edits that start from the UI: inserting a control or a building block
// at the selection or at a drop, moving by drop, and the clipboard.
import { createNode, clone, walk, findNode, newId, aggAccepts, insertNode, dropTarget, removeNode, moveNode } from '../model.js';
import { PATTERNS } from '../patterns.js';
import { state, commit, ancestors } from './store.js';
import { toast, displayType } from './dom.js';

export function addControl(type, onId = state.selected) {
  commit((d) => {
    const t = dropTarget(d, onId || 'root', type);
    if (!t) {
      toast(`${displayType(type)} does not fit here`);
      return undefined;
    }
    return insertNode(d, createNode(type), t.parentId, t.agg, t.index);
  });
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
    commit((d) => {
      const p = findNode(d.root, place.parentId);
      if (!p || !aggAccepts(p.node, place.agg, what)) {
        toast(`${displayType(what)} does not fit here`);
        return undefined;
      }
      return insertNode(d, createNode(what), place.parentId, place.agg, place.index);
    });
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


// the selection as text: a design node in JSON, with a marker so a paste
// knows it - the system clipboard carries it between designs and tabs, the
// editor's own copy covers a browser that refuses to read the clipboard
const CLIP_MARK = 'abap2ui5-designer:node';

export function copySelection(cut) {
  const hit = findNode(state.design.root, state.selected);
  if (!hit || !hit.parent) return;
  const text = JSON.stringify({ [CLIP_MARK]: 1, node: hit.node });
  state.clipboard = text;
  try { navigator.clipboard.writeText(text).catch(() => {}); } catch { /* no clipboard */ }
  if (cut) commit((d) => removeNode(d, hit.node.id));
  toast(`${displayType(hit.node.type)} ${cut ? 'cut' : 'copied'}`);
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
  let node;
  try {
    const parsed = JSON.parse(text);
    node = parsed && parsed[CLIP_MARK] ? parsed.node : null;
  } catch { node = null; }
  if (!node) { toast('Nothing to paste'); return; }
  const fresh = clone(node);
  walk(fresh, (n) => { n.id = newId(); return true; });
  commit((d) => {
    const t = place || dropTarget(d, onId || 'root', fresh.type);
    if (!t) { toast(`${displayType(fresh.type)} does not fit here`); return undefined; }
    const p = findNode(d.root, t.parentId);
    if (!p || !aggAccepts(p.node, t.agg, fresh.type)) { toast(`${displayType(fresh.type)} does not fit here`); return undefined; }
    return insertNode(d, fresh, t.parentId, t.agg, t.index);
  });
}
