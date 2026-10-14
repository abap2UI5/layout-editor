// The layout editor UI, after the pattern of the SAP Web IDE layout editor
// and styled after SAP Fiori Horizon. One idea of its own shapes it: the class is the product, so the
// code is never hidden - canvas and class sit side by side, a control and
// its lines in the chain are selected together.
//
// Left: controls, outline, data and checks as tabs. Middle: the canvas (real
// UI5 in a frame) and the class. Right: the properties. All state is the
// design document (model.js); every edit goes through commit( ), which
// records undo, saves to localStorage and re-renders.

import { CONTROLS, CATEGORIES, DESCRIPTIONS, getControl, splitType, NAMESPACES } from './catalog.js';
import {
  createNode, clone, walk, findNode, newId, aggNames, aggAccepts, canHaveChildren, insertNode, dropTarget, removeNode,
  moveNode, shiftNode, duplicateNode, rowContext, bindableAggs, bindListToTable, hasOwnTemplate, unbindList, attributeUsage, renameAttribute,
  validate, previewModel, attributeFits, normalizeDesign, checkAttributeName, checkFieldName, checkEventName, checkClassName, SCALAR_TYPES, ATTRIBUTE_TYPES,
} from './model.js';
import { toXml, fromXml, importReport } from './xml.js';
import { generateClass, generateClassMap, abapGitFiles, fileName } from './abap.js';
import { zip } from './zip.js';
import { STARTERS } from './starters.js';
import { PATTERNS } from './patterns.js';

const STORE_KEY = 'abap2ui5-designer:design';
const PREFS_KEY = 'abap2ui5-designer:prefs';
const GLYPHS = { Layout: '▦', Display: 'T', Input: '⌨', Lists: '☰', Parts: '◦' };
const KINDS = { s: 'Aa', b: '@', f: '#', x: 'ƒx' };
const KIND_TITLE = 'Aa a value · @ bound to an attribute · # a field of the row · ƒx a UI5 expression';

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------- state

const state = {
  design: null,
  selected: 'root',
  undo: [],
  redo: [],
  panel: 'insert',
  view: 'split',
  code: 'abap',
  mode: 'design',
  collapsed: new Set(),
  inspector: { filter: '', onlySet: false },
  previewReady: false,
  prefs: { device: '100%', theme: 'sap_horizon', ui5: '', view: 'split' },
};

function loadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* defaults */ }
  // ?ui5=<version|local> overrides the stored version, for links and tests
  const q = new URLSearchParams(location.search).get('ui5');
  if (q !== null) state.prefs.ui5 = q;
  state.view = state.prefs.view || 'split';
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* private mode */ }
}

function loadDesign() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      return normalizeDesign(JSON.parse(raw));
    }
  } catch { /* start fresh */ }
  return STARTERS.find((s) => s.id === 'form').make();
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.design)); } catch { /* quota or private mode */ }
}

// Every change: snapshot for undo, apply, then re-render. `fn` may return
// the id to select next. Typing into one field merges into one undo step
// (`mergeKey`) and keeps the focus where it is (`keepFocus`).
function commit(fn, opts = {}) {
  const before = JSON.stringify(state.design);
  const next = fn(state.design);
  if (JSON.stringify(state.design) === before && !opts.force) {
    if (typeof next === 'string') select(next);
    return;
  }
  if (!opts.mergeKey || state.lastMergeKey !== opts.mergeKey) {
    state.undo.push(before);
    if (state.undo.length > 200) state.undo.shift();
  }
  state.lastMergeKey = opts.mergeKey || null;
  state.redo = [];
  if (typeof next === 'string') state.selected = next;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  persist();
  renderAll(opts);
}

function restore(json) {
  state.design = JSON.parse(json);
  state.lastMergeKey = null;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  persist();
  renderAll();
}
function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.design));
  restore(state.undo.pop());
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.design));
  restore(state.redo.pop());
}

function replaceDesign(d) {
  state.undo.push(JSON.stringify(state.design));
  state.redo = [];
  state.design = d;
  state.selected = d.root.aggs.content && d.root.aggs.content[0] ? d.root.aggs.content[0].id : 'root';
  state.collapsed.clear();
  persist();
  renderAll();
}

function select(id, opts = {}) {
  if (!findNode(state.design.root, id)) id = 'root';
  state.selected = id;
  // typing after a change of selection is a new undo step
  state.lastMergeKey = null;
  // a selected node is never hidden in a collapsed branch
  for (const a of ancestors(id)) state.collapsed.delete(a.id);
  renderLayers();
  renderInspector();
  renderCrumbs();
  renderInsertTarget();
  highlightCode(!opts.fromCode);
  postPreview({ type: 'select', selected: id, label: labelOfSelection() });
}

function ancestors(id) {
  const out = [];
  let hit = findNode(state.design.root, id);
  while (hit && hit.parent) {
    out.unshift(hit.parent);
    hit = findNode(state.design.root, hit.parent.id);
  }
  return out;
}

// ------------------------------------------------------------- dom helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function options(values, selected, labels = {}) {
  return values.map((v) => h('option', { value: v, selected: v === selected ? 'selected' : null, text: labels[v] ?? v }));
}

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    // clipboard refused (no permission, not a secure context): show the
    // code and select it, so Ctrl+C works
    setCode(what === 'XML' ? 'xml' : 'abap');
    if (state.view === 'canvas') setView('split');
    const range = document.createRange();
    range.selectNodeContents($('#code'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Press Ctrl+C to copy the selection');
  }
}

function displayType(type) {
  return splitType(type).name;
}

function nodeLabel(node) {
  const p = node.props || {};
  const show = p.text || p.title || p.headerText || p.placeholder || p.value || p.key;
  if (!show || show.v === undefined || show.v === '') return '';
  if (show.m === 's') return show.v;
  if (show.m === 'b') return `@${show.v}`;
  if (show.m === 'f') return `#${show.v}`;
  return show.v;
}

function labelOfSelection() {
  const hit = findNode(state.design.root, state.selected);
  return hit && hit.node.id !== 'root' ? displayType(hit.node.type) : '';
}

function apiLink(type) {
  const { ns, name } = splitType(type);
  const lib = NAMESPACES[ns] || (state.design.namespaces || {})[ns];
  return lib ? `https://sdk.openui5.org/api/${lib}.${name}` : null;
}

// ------------------------------------------------------------- panels

function showPanel(panel) {
  state.panel = panel;
  for (const b of document.querySelectorAll('.rail-btn')) {
    const on = b.dataset.panel === panel;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('aria-controls', `panel-${b.dataset.panel}`);
    b.tabIndex = on ? 0 : -1;
  }
  for (const p of ['insert', 'layers', 'data', 'issues']) $(`#panel-${p}`).classList.toggle('hidden', p !== panel);
}

// ------------------------------------------------------------- insert

function renderInsert() {
  const q = $('#insertSearch').value.trim().toLowerCase();
  const box = $('#insertList');
  box.replaceChildren();
  const match = (...texts) => !q || texts.some((t) => t && t.toLowerCase().includes(q));

  const pats = PATTERNS.filter((p) => match(p.title, p.text));
  if (pats.length) {
    box.append(h('div', { class: 'ins-group' }, h('h3', { text: 'Building blocks' }),
      pats.map((p) => h('div', {
        class: 'ins-item pattern',
        draggable: 'true',
        'data-pattern': p.id,
        title: 'Drag onto the canvas or the outline, or click to insert at the selection',
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', `dsg:pattern:${p.id}`); e.dataTransfer.effectAllowed = 'copy'; },
        onclick: () => insertPattern(p.id, state.selected),
      }, h('span', { class: 'ig', text: '◆' }), h('span', { class: 'in', text: p.title }), h('span', { class: 'id', text: p.text })))));
  }
  for (const cat of CATEGORIES) {
    const items = Object.keys(CONTROLS).filter((k) => CONTROLS[k].category === cat && match(k, DESCRIPTIONS[k]));
    if (!items.length) continue;
    box.append(h('div', { class: 'ins-group' },
      h('h3', { text: cat === 'Parts' ? 'Parts - inside their parent' : cat }),
      items.map((type) => h('div', {
        class: 'ins-item',
        draggable: 'true',
        'data-type': type,
        title: `${type} - drag onto the canvas or the outline, or click to insert at the selection`,
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', `dsg:new:${type}`); e.dataTransfer.effectAllowed = 'copy'; },
        onclick: () => addControl(type),
      }, h('span', { class: 'ig', text: GLYPHS[cat] }), h('span', { class: 'in', text: displayType(type) }), h('span', { class: 'id', text: DESCRIPTIONS[type] || '' })))));
  }
  if (!box.childElementCount) box.append(h('div', { class: 'empty', text: 'Nothing matches.' }));
}

// where a click in the insert panel puts the control
function renderInsertTarget() {
  const box = $('#insertTarget');
  const hit = findNode(state.design.root, state.selected);
  const where = !hit || hit.node.id === 'root' ? 'the view' : displayType(hit.node.type);
  box.replaceChildren('A click inserts into ', h('b', { text: where }), canHaveChildren(hit ? hit.node : state.design.root) ? '' : ' (next to it)');
}

function addControl(type, onId = state.selected) {
  commit((d) => {
    const t = dropTarget(d, onId || 'root', type);
    if (!t) {
      toast(`${displayType(type)} does not fit here`);
      return undefined;
    }
    return insertNode(d, createNode(type), t.parentId, t.agg, t.index);
  });
}

function insertPattern(id, onId, place) {
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
function handleDrop(data, onId, place, zone) {
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

// ------------------------------------------------------------- clipboard

// the selection as text: a design node in JSON, with a marker so a paste
// knows it - the system clipboard carries it between designs and tabs, the
// editor's own copy covers a browser that refuses to read the clipboard
const CLIP_MARK = 'abap2ui5-designer:node';
function copySelection(cut) {
  const hit = findNode(state.design.root, state.selected);
  if (!hit || !hit.parent) return;
  const text = JSON.stringify({ [CLIP_MARK]: 1, node: hit.node });
  state.clipboard = text;
  try { navigator.clipboard.writeText(text).catch(() => {}); } catch { /* no clipboard */ }
  if (cut) commit((d) => removeNode(d, hit.node.id));
  toast(`${displayType(hit.node.type)} ${cut ? 'cut' : 'copied'}`);
}

async function pasteSelection() {
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

// ------------------------------------------------------------- layers

function renderLayers() {
  const box = $('#layers');
  const scrollTop = box.scrollTop;
  box.replaceChildren();

  const row = (node, depth, extra) => {
    const isRoot = node.id === 'root';
    const kids = canHaveChildren(node) && aggNames(node).some((a) => (node.aggs[a] || []).length);
    const collapsed = state.collapsed.has(node.id);
    const bound = Object.values(node.props || {}).some((v) => v && v.m === 'b');
    const lbl = isRoot ? '' : nodeLabel(node);
    const el = h('div', {
      class: `lrow${state.selected === node.id ? ' sel' : ''}`,
      role: 'treeitem',
      tabindex: state.selected === node.id ? '0' : '-1',
      'aria-selected': state.selected === node.id ? 'true' : 'false',
      'aria-expanded': kids ? String(!collapsed) : null,
      'aria-level': String(depth + 1),
      style: `padding-left:${4 + depth * 14}px`,
      draggable: isRoot ? null : 'true',
      'data-id': node.id,
      onclick: (e) => { e.stopPropagation(); select(node.id); },
      ondragstart: (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `dsg:move:${node.id}`); e.dataTransfer.effectAllowed = 'move'; },
    },
    h('button', {
      class: 'caret',
      tabindex: '-1',
      'aria-label': collapsed ? 'Expand' : 'Collapse',
      text: kids ? (collapsed ? '▸' : '▾') : '',
      onclick: (e) => {
        e.stopPropagation();
        if (!kids) return;
        if (collapsed) state.collapsed.delete(node.id); else state.collapsed.add(node.id);
        renderLayers();
      },
    }),
    h('span', { class: 'ltype', text: isRoot ? 'View' : displayType(node.type) }),
    bound ? h('span', { class: 'bind', title: 'bound to data', text: '●' }) : null,
    lbl ? h('span', { class: 'lmeta', text: lbl }) : null);
    wireTreeDrop(el, node, extra);
    return el;
  };

  const out = (node, depth, parent, agg, index) => {
    box.append(row(node, depth, { parent, agg, index }));
    if (state.collapsed.has(node.id)) return;
    const c = getControl(node.type);
    const aggRows = node.type !== 'mvc:View' && c && c.aggs && Object.keys(c.aggs).length > 1;
    for (const a of aggNames(node)) {
      const kids = node.aggs[a] || [];
      // an empty aggregation shows only on the selected control - enough to
      // drop into, without a tree full of empty slots
      if (!kids.length && (!aggRows || state.selected !== node.id)) continue;
      let childDepth = depth + 1;
      if (aggRows || (!c && a)) {
        const binding = node.props[a];
        const aggRow = h('div', { class: 'lrow agg', style: `padding-left:${18 + (depth + 1) * 14}px`, 'data-agg': a },
          h('span', { class: 'lagg', text: a }),
          binding && binding.m === 'b' ? h('span', { class: 'lmeta', text: `@${binding.v}` }) : null);
        wireAggDrop(aggRow, node, a);
        box.append(aggRow);
        childDepth = depth + 2;
      }
      kids.forEach((k, i) => out(k, childDepth, node, a, i));
    }
  };
  out(state.design.root, 0, null, null, 0);
  box.scrollTop = scrollTop;
  const sel = box.querySelector('.lrow.sel');
  if (sel && !state.layersNoScroll) sel.scrollIntoView({ block: 'nearest' });
  if (state.focusLayers) { state.focusLayers = false; if (sel) sel.focus(); }
}

// the keys of the outline: up and down walk the visible rows, left
// collapses or goes to the parent, right expands or goes to the first
// child, Enter opens the properties
function onLayersKey(e) {
  const rows = [...$('#layers').querySelectorAll('.lrow[data-id]')];
  const i = rows.findIndex((r) => r.dataset.id === state.selected);
  if (i < 0) return;
  const go = (j) => { if (rows[j]) { state.focusLayers = true; select(rows[j].dataset.id); } };
  const node = findNode(state.design.root, state.selected);
  const open = node && rows[i].getAttribute('aria-expanded') === 'true';
  if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
  else if (e.key === 'Home') { e.preventDefault(); go(0); }
  else if (e.key === 'End') { e.preventDefault(); go(rows.length - 1); }
  else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (open) { state.collapsed.add(state.selected); state.focusLayers = true; renderLayers(); }
    else if (node && node.parent) go(rows.findIndex((r) => r.dataset.id === node.parent.id));
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (rows[i].getAttribute('aria-expanded') === 'false') { state.collapsed.delete(state.selected); state.focusLayers = true; renderLayers(); }
    else if (open) go(i + 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const first = $('#inspector').querySelector('input, select');
    if (first) first.focus();
  }
}

function clearDropMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-inside')) el.classList.remove('drop-before', 'drop-after', 'drop-inside');
}

// where a drop on a layer goes: the upper quarter before it, the lower
// quarter after it, the middle into it (when it takes children)
function treeDropPlace(e, node, extra) {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const inside = canHaveChildren(node);
  if (node.id === 'root') return { zone: 'inside' };
  if (y < 0.28 || (!inside && y < 0.5)) return { zone: 'before', place: { parentId: extra.parent.id, agg: extra.agg, index: extra.index } };
  if (y > 0.72 || !inside) return { zone: 'after', place: { parentId: extra.parent.id, agg: extra.agg, index: extra.index + 1 } };
  return { zone: 'inside' };
}

function wireTreeDrop(el, node, extra) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    clearDropMarks();
    el.classList.add(`drop-${treeDropPlace(e, node, extra).zone}`);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const { zone, place } = treeDropPlace(e, node, extra);
    handleDrop(e.dataTransfer.getData('text/plain'), node.id, zone === 'inside' ? null : place);
  });
}

function wireAggDrop(el, node, agg) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); clearDropMarks(); el.classList.add('drop-inside'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-inside'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    handleDrop(e.dataTransfer.getData('text/plain'), node.id, { parentId: node.id, agg, index: null });
  });
}

// ------------------------------------------------------------- breadcrumbs

function renderCrumbs() {
  const box = $('#crumbs');
  box.replaceChildren();
  const hit = findNode(state.design.root, state.selected);
  const path = hit ? [...ancestors(state.selected), hit.node] : [state.design.root];
  path.forEach((n, i) => {
    if (i) box.append(h('span', { class: 'sep', text: '›' }));
    box.append(h('button', {
      class: n.id === state.selected ? 'cur' : '',
      text: n.id === 'root' ? 'View' : displayType(n.type),
      title: n.id === 'root' ? 'The view' : nodeLabel(n) || displayType(n.type),
      onclick: () => select(n.id),
    }));
  });
}

// ------------------------------------------------------------- inspector

const PROP_GROUPS = [
  ['Content', (d) => ['string', 'icon', 'uri'].includes(d.type)],
  ['Appearance', (d) => ['enum', 'cssSize', 'int', 'float'].includes(d.type)],
  ['Behaviour', (d) => d.type === 'boolean'],
];

function renderInspector() {
  const box = $('#inspector');
  const focus = rememberFocus(box);
  const scroll = box.scrollTop;
  box.replaceChildren();
  const d = state.design;
  const hit = findNode(d.root, state.selected);
  if (!hit || hit.node.id === 'root') {
    box.append(h('div', { class: 'empty' },
      h('div', { class: 'big', text: '{ }' }),
      h('p', { text: 'Select a control on the canvas, in the outline or in the code.' }),
      h('p', { class: 'hint', text: 'Drag controls from the left onto the canvas. Bind their properties to attributes on the Data tab - each becomes a public attribute of the class.' })));
    return;
  }
  const node = hit.node;
  const c = getControl(node.type);
  const link = apiLink(node.type);
  const ctx = rowContext(d, node.id);

  const filter = h('input', {
    type: 'search', placeholder: 'Filter properties…', value: state.inspector.filter, 'aria-label': 'Filter properties', 'data-focus': 'filter',
    oninput: (e) => { state.inspector.filter = e.target.value; renderInspector(); },
  });
  box.append(h('div', { class: 'insp-head' },
    h('div', { class: 'insp-title' }, h('b', { text: displayType(node.type) }), link ? h('a', { href: link, target: '_blank', rel: 'noopener', text: 'UI5 API ↗' }) : null),
    h('div', { class: 'insp-desc', text: DESCRIPTIONS[node.type] || (c ? '' : 'Imported control - kept as it is') }),
    h('div', { class: 'insp-tools' }, filter,
      h('label', {}, h('input', { type: 'checkbox', checked: state.inspector.onlySet, onchange: (e) => { state.inspector.onlySet = e.target.checked; renderInspector(); } }), 'set only'))));

  // rows of a list
  for (const agg of bindableAggs(node)) {
    const tables = d.attributes.filter((a) => a.type === 'table');
    const cur = node.props[agg] && node.props[agg].m === 'b' ? node.props[agg].v : '';
    box.append(group('Rows', h('div', {},
      h('div', { class: 'add-row' },
        h('select', {
          'aria-label': `Bind ${agg} to a table`,
          onchange: (e) => {
            const replace = !e.target.value || !hasOwnTemplate(node, agg)
              || confirm(`Replace the ${agg} of this ${displayType(node.type)} with a template built from the fields of ${e.target.value}?\n\nCancel keeps them and only sets the binding.`);
            commit((dd) => {
              if (e.target.value) bindListToTable(dd, node.id, agg, e.target.value, replace);
              else unbindList(dd, node.id, agg);
            });
          },
        }, h('option', { value: '', text: tables.length ? '— static items —' : '— no table attribute yet —' }), options(tables.map((t) => t.name), cur)),
        h('button', { onclick: () => newTableFor(node, agg), title: 'Create a table attribute and bind the rows to it' }, '+ Table')),
      h('p', { class: 'hint', text: cur
        ? `One line per row of ${cur}. The template inside repeats per row; its properties take the row's fields (#).`
        : 'Bind to a table attribute and the template repeats per row.' }))));
  }

  // properties, grouped
  const q = state.inspector.filter.trim().toLowerCase();
  const visible = ([p]) => !bindableAggs(node).includes(p) && (!q || p.toLowerCase().includes(q)) && (!state.inspector.onlySet || isSet(node.props[p]));
  const defs = (c ? Object.entries(c.props || {}) : []).filter(visible);
  for (const [title, test] of PROP_GROUPS) {
    const rows = defs.filter(([, def]) => test(def));
    if (!rows.length) continue;
    box.append(group(title, h('div', {}, title === 'Content' ? h('p', { class: 'hint', text: KIND_TITLE }) : null, rows.map(([p, def]) => propRow(node, p, def, ctx)))));
  }
  // what an import brought along that the catalogue does not know: shown
  // as text, written to the class as it is, and removable
  const extras = Object.keys(node.props).filter((p) => !(c && c.props && c.props[p])).map((p) => [p, { type: 'string' }]).filter(visible);
  if (extras.length || !c) {
    const inp = h('input', { placeholder: 'add property…', spellcheck: 'false', 'aria-label': 'Property name' });
    box.append(group(c ? 'Imported' : 'Properties', h('div', {},
      c ? h('p', { class: 'hint', text: 'Not in the palette - written to the class as it is.' }) : null,
      extras.map(([p, def]) => h('div', { class: 'extra' }, propRow(node, p, def, ctx),
        h('button', { class: 'icon danger', title: `Remove ${p}`, 'aria-label': `Remove ${p}`, onclick: () => commit((dd) => { delete findNode(dd.root, node.id).node.props[p]; }) }, '✕'))),
      !q && !state.inspector.onlySet ? h('div', { class: 'add-row' }, inp, h('button', {
        onclick: () => {
          const n = inp.value.trim();
          if (/^[a-zA-Z][\w]*$/.test(n)) commit((dd) => { findNode(dd.root, node.id).node.props[n] = { m: 's', v: '' }; });
        },
      }, 'Add')) : null)));
  }

  // events
  if (c && c.events && c.events.length && (!q || c.events.some((e) => e.toLowerCase().includes(q)))) {
    const evs = c.events.filter((e) => !q || e.toLowerCase().includes(q)).filter((e) => !state.inspector.onlySet || node.events[e]);
    if (evs.length) {
      box.append(group('Events', h('div', {},
        h('p', { class: 'hint', text: 'A name becomes client->_event( ) in the view and a WHEN branch in on_event.' }),
        evs.map((ev) => eventRow(node, ev)))));
    }
  }

  // children
  if (c && c.aggs && !q && !state.inspector.onlySet) {
    const rows = [];
    for (const agg of Object.keys(c.aggs)) {
      const allowed = Object.keys(CONTROLS).filter((t) => aggAccepts(node, agg, t));
      if (!allowed.length) continue;
      const sel = h('select', {
        'aria-label': `Add to ${agg}`,
        onchange: () => { if (sel.value) commit((dd) => insertNode(dd, createNode(sel.value), node.id, agg)); },
      }, h('option', { value: '', text: `+ add to ${agg}…` }), options(allowed, null, Object.fromEntries(allowed.map((t) => [t, displayType(t)]))));
      rows.push(h('div', { class: 'add-row' }, sel));
    }
    if (rows.length) box.append(group('Children', h('div', {}, rows), false));
  }
  box.scrollTop = scroll;
  restoreFocus(box, focus);
}

function group(title, body, open = true) {
  return h('details', { class: 'group', open: open ? 'open' : null }, h('summary', {}, h('h2', { text: title })), h('div', { class: 'gbody' }, body));
}

function isSet(v) {
  return !!v && (v.m !== 's' || (v.v !== '' && v.v != null));
}

function eventRow(node, ev) {
  const val = node.events[ev] || '';
  const inp = h('input', {
    value: val,
    placeholder: suggestEvent(node, ev),
    spellcheck: 'false',
    'aria-label': `Event ${ev}`,
    'data-focus': `ev-${ev}`,
    oninput: (e) => {
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      e.target.classList.toggle('invalid', !!v && !!checkEventName(v));
      commit((dd) => {
        const n = findNode(dd.root, node.id).node;
        if (v) n.events[ev] = v; else delete n.events[ev];
      }, { mergeKey: `ev:${node.id}:${ev}`, keepFocus: true });
    },
    onfocus: (e) => {
      if (!e.target.value) {
        e.target.value = e.target.placeholder;
        e.target.dispatchEvent(new Event('input'));
        e.target.select();
      }
    },
  });
  return h('div', { class: 'event' }, h('label', { text: ev }), inp);
}

function suggestEvent(node, ev) {
  const t = splitType(node.type).name.toUpperCase();
  const p = node.props.text && node.props.text.m === 's' ? node.props.text.v : '';
  const base = p ? p.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') : t;
  return ev === 'press' ? (base || t) : `${base || t}_${ev.toUpperCase()}`;
}

function newTableFor(node, agg) {
  commit((d) => {
    let i = 1;
    let name = 't_items';
    while (d.attributes.some((a) => a.name === name)) name = `t_items${++i}`;
    d.attributes.push({
      name, type: 'table',
      fields: [{ name: 'TITLE', type: 'string' }, { name: 'INFO', type: 'string' }],
      rows: [{ TITLE: 'First', INFO: 'A' }, { TITLE: 'Second', INFO: 'B' }, { TITLE: 'Third', INFO: 'C' }],
    });
    bindListToTable(d, node.id, agg, name);
    return node.id;
  });
  toast('Table attribute created - edit it on the Data tab');
}

function attrTypeFor(def) {
  if (def.type === 'boolean') return 'bool';
  if (def.type === 'int') return 'int';
  if (def.type === 'float') return 'decimal';
  return 'string';
}

function propRow(node, p, def, ctx) {
  const d = state.design;
  const value = node.props[p];
  const m = value ? value.m : 's';
  const kinds = { s: KINDS.s, b: KINDS.b, x: KINDS.x };
  if (ctx || m === 'f') kinds.f = KINDS.f;
  const update = (fn, opts) => commit((dd) => { fn(findNode(dd.root, node.id).node); }, opts);

  const kind = h('select', {
    class: `kind k-${m}`,
    title: KIND_TITLE,
    'aria-label': `${p}: kind of value`,
    onchange: (e) => update((n) => {
      const mm = e.target.value;
      if (mm === 's') delete n.props[p];
      else if (mm === 'b') {
        const fits = d.attributes.filter((a) => attributeFits(def, a.type));
        n.props[p] = { m: 'b', v: fits[0] ? fits[0].name : '' };
      } else if (mm === 'f') n.props[p] = { m: 'f', v: ctx && ctx.fields[0] ? ctx.fields[0].name : '' };
      else n.props[p] = { m: 'x', v: value && value.m === 's' ? value.v : '' };
    }),
  }, options(Object.keys(kinds), m, kinds));

  let editor;
  const focusKey = `p-${p}`;
  if (m === 's') {
    const v = value ? value.v : '';
    if (def.type === 'enum' || def.type === 'boolean') {
      const vals = def.type === 'boolean' ? ['true', 'false'] : def.values;
      editor = h('select', {
        'aria-label': p,
        onchange: (e) => update((n) => { if (e.target.value) n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }),
      }, h('option', { value: '', text: '— default —' }), options(vals, v));
    } else {
      editor = h('input', {
        value: v,
        'aria-label': p,
        'data-focus': focusKey,
        spellcheck: def.type === 'string' ? 'true' : 'false',
        placeholder: def.hint || (def.type === 'cssSize' ? 'e.g. 10rem' : def.type === 'icon' ? 'sap-icon://…' : ''),
        oninput: (e) => update((n) => { if (e.target.value !== '') n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true }),
      });
    }
  } else if (m === 'b') {
    const attrs = d.attributes.filter((a) => attributeFits(def, a.type));
    editor = h('div', { class: 'val' },
      h('select', {
        'aria-label': `${p}: attribute`,
        onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
      }, value.v && !attrs.some((a) => a.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
      options(attrs.map((a) => a.name), value.v, Object.fromEntries(attrs.map((a) => [a.name, `${a.name} : ${a.type}`])))),
      h('button', { class: 'icon', title: 'New attribute for this property', 'aria-label': 'New attribute', onclick: () => newAttrFor(node, p, def) }, '+'));
  } else if (m === 'f') {
    const fields = ctx ? ctx.fields : [];
    editor = h('select', {
      'aria-label': `${p}: field`,
      onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
    }, value.v && !fields.some((f) => f.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
    options(fields.map((f) => f.name), value.v));
  } else {
    editor = h('input', {
      value: value.v || '',
      'aria-label': `${p}: expression`,
      'data-focus': focusKey,
      spellcheck: 'false',
      placeholder: '{= ${/X} > 0 }',
      oninput: (e) => update((n) => { n.props[p] = { m: 'x', v: e.target.value }; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true }),
    });
  }
  return h('div', { class: `prop${isSet(value) ? ' set' : ''}`, 'data-prop': p, title: `${p} : ${def.type}${def.values ? ` (${def.values.join(', ')})` : ''}` },
    h('label', { text: p }), h('div', { class: 'val' }, editor), kind);
}

function newAttrFor(node, p, def) {
  commit((d) => {
    const base = `${splitType(node.type).name}_${p}`.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 26);
    let name = base;
    let i = 1;
    while (d.attributes.some((a) => a.name === name) || checkAttributeName(name)) name = `${base}${++i}`;
    const n = findNode(d.root, node.id).node;
    const cur = n.props[p];
    d.attributes.push({ name, type: attrTypeFor(def), value: cur && cur.m === 's' ? cur.v : '' });
    n.props[p] = { m: 'b', v: name };
  });
  toast('Attribute created on the Data tab');
}

// ------------------------------------------------------------- data

function renderData() {
  const box = $('#dataPanel');
  const focus = rememberFocus(box);
  box.replaceChildren();
  const d = state.design;
  box.append(h('p', { class: 'hint', text: 'Public attributes of the class, bound with client->_bind( ). The values seed model_init and the canvas.' }));
  d.attributes.forEach((a, idx) => box.append(attrCard(a, idx)));
  box.append(h('div', { class: 'add-row' },
    h('button', { onclick: () => addAttribute('string') }, '+ Attribute'),
    h('button', { onclick: () => addAttribute('table') }, '+ Table')));
  restoreFocus(box, focus);
}

function addAttribute(type) {
  commit((d) => {
    let i = 1;
    const base = type === 'table' ? 't_table' : 'attr';
    let name = `${base}${i}`;
    while (d.attributes.some((a) => a.name === name)) name = `${base}${++i}`;
    d.attributes.push(type === 'table'
      ? { name, type, fields: [{ name: 'TEXT', type: 'string' }], rows: [{ TEXT: 'Row 1' }] }
      : { name, type, value: '' });
  });
}

function attrCard(a, idx) {
  const d = state.design;
  const upd = (fn, key) => commit((dd) => fn(dd.attributes[idx], dd), { mergeKey: key, keepFocus: true });
  const uses = attributeUsage(d, a.name);
  const nameIn = h('input', {
    class: 'aname',
    value: a.name,
    spellcheck: 'false',
    'aria-label': 'Attribute name',
    'data-focus': `a${idx}-name`,
    onchange: (e) => {
      const v = e.target.value.trim().toLowerCase();
      const err = checkAttributeName(v) || (d.attributes.some((x, j) => j !== idx && x.name === v) ? 'Name is taken' : null);
      if (err) { e.target.classList.add('invalid'); toast(err); return; }
      commit((dd) => { renameAttribute(dd, dd.attributes[idx].name, v); dd.attributes[idx].name = v; });
    },
  });
  const typeSel = h('select', {
    'aria-label': 'Attribute type',
    onchange: (e) => commit((dd) => {
      const at = dd.attributes[idx];
      at.type = e.target.value;
      if (at.type === 'table') { at.fields = at.fields && at.fields.length ? at.fields : [{ name: 'TEXT', type: 'string' }]; at.rows = at.rows || []; delete at.value; } else { at.value = ''; delete at.fields; delete at.rows; }
    }),
  }, options(ATTRIBUTE_TYPES, a.type));
  const del = h('button', {
    class: 'icon danger',
    title: uses ? `Delete - ${uses} binding(s) use it` : 'Delete',
    'aria-label': 'Delete attribute',
    onclick: () => {
      if (uses && !confirm(`${a.name} is bound ${uses} time(s). Delete it anyway? The bindings stay and show up under Checks.`)) return;
      commit((dd) => { dd.attributes.splice(idx, 1); });
    },
  }, '✕');
  const card = h('div', { class: 'attr' }, h('div', { class: 'attr-head' }, nameIn, typeSel, del));
  if (uses) card.append(h('div', { class: 'uses', text: `bound ${uses}×` }));
  if (a.type !== 'table') {
    card.append(h('div', { class: 'avalue' }, h('span', { class: 'hint', style: 'margin:0', text: 'Value' }), scalarInput(a.type, a.value, (v) => upd((at) => { at.value = v; }, `a${idx}-v`), `a${idx}-v`)));
  } else {
    const fields = h('div', { class: 'fields' }, h('div', { class: 'hint', style: 'margin:0 0 4px', text: 'Fields' }));
    a.fields.forEach((f, fi) => {
      fields.append(h('div', { class: 'frow' },
        h('input', {
          value: f.name, spellcheck: 'false', 'aria-label': 'Field name', 'data-focus': `a${idx}-f${fi}`,
          onchange: (e) => {
            const v = e.target.value.trim().toUpperCase();
            const err = checkFieldName(v) || (a.fields.some((x, j) => j !== fi && x.name === v) ? 'Name is taken' : null);
            if (err) { e.target.classList.add('invalid'); toast(err); return; }
            commit((dd) => renameField(dd, idx, fi, v));
          },
        }),
        h('select', { 'aria-label': 'Field type', onchange: (e) => commit((dd) => { dd.attributes[idx].fields[fi].type = e.target.value; }) }, options(SCALAR_TYPES, f.type)),
        h('button', { class: 'icon danger', 'aria-label': 'Delete field', title: 'Delete field', onclick: () => commit((dd) => { dd.attributes[idx].fields.splice(fi, 1); }) }, '✕')));
    });
    fields.append(h('button', {
      onclick: () => commit((dd) => {
        const at = dd.attributes[idx];
        let i = at.fields.length + 1;
        while (at.fields.some((f) => f.name === `FIELD${i}`)) i++;
        at.fields.push({ name: `FIELD${i}`, type: 'string' });
      }),
    }, '+ Field'));
    card.append(fields);

    const table = h('table', { class: 'rows' }, h('tr', {}, a.fields.map((f) => h('th', { text: f.name })), h('th')));
    (a.rows || []).forEach((r, ri) => {
      table.append(h('tr', {}, a.fields.map((f) => h('td', {}, scalarInput(f.type, r[f.name], (v) => upd((at) => { at.rows[ri][f.name] = v; }, `a${idx}-r${ri}-${f.name}`), `a${idx}-r${ri}-${f.name}`))),
        h('td', {}, h('button', { class: 'icon danger', 'aria-label': 'Delete row', title: 'Delete row', onclick: () => commit((dd) => { dd.attributes[idx].rows.splice(ri, 1); }) }, '✕'))));
    });
    card.append(h('div', { class: 'hint', style: 'margin:8px 0 0', text: 'Sample rows - they seed model_init and the canvas' }),
      h('div', { class: 'rows-wrap' }, table),
      h('button', { style: 'margin-top:6px', onclick: () => commit((dd) => { (dd.attributes[idx].rows = dd.attributes[idx].rows || []).push({}); }) }, '+ Row'));
  }
  return card;
}

function renameField(d, idx, fi, to) {
  const at = d.attributes[idx];
  const from = at.fields[fi].name;
  at.fields[fi].name = to;
  for (const r of at.rows || []) {
    if (from in r) { r[to] = r[from]; delete r[from]; }
  }
  walk(d.root, (n) => {
    for (const v of Object.values(n.props || {})) {
      if (v && v.m === 'f' && v.v === from) {
        const ctx = rowContext(d, n.id);
        if (ctx && ctx.name === at.name) v.v = to;
      }
    }
    return true;
  });
}

function scalarInput(type, value, onValue, focusKey) {
  if (type === 'bool') {
    return h('input', { type: 'checkbox', checked: value === true || value === 'true', 'aria-label': 'Value', 'data-focus': focusKey, onchange: (e) => onValue(e.target.checked) });
  }
  const t = type === 'date' ? 'date' : type === 'time' ? 'time' : type === 'int' || type === 'decimal' ? 'number' : 'text';
  return h('input', {
    type: t, value: value ?? '', 'aria-label': 'Value', 'data-focus': focusKey,
    step: type === 'time' ? '1' : type === 'decimal' ? '0.01' : null,
    oninput: (e) => onValue(e.target.value),
  });
}

function rememberFocus(box) {
  const a = document.activeElement;
  if (!a || !box.contains(a) || !a.dataset.focus) return null;
  return { key: a.dataset.focus, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(box, f) {
  if (!f) return;
  const el = box.querySelector(`[data-focus="${CSS.escape(f.key)}"]`);
  if (!el) return;
  el.focus();
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* number/date inputs */ }
}

// ------------------------------------------------------------- checks

function renderIssues() {
  const issues = validate(state.design);
  const box = $('#issuesPanel');
  box.replaceChildren();
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const badge = $('#issueCount');
  badge.textContent = String(errors || warns);
  badge.classList.toggle('hidden', !(errors || warns));
  badge.classList.toggle('warn', !errors);
  if (!issues.length) box.append(h('div', { class: 'empty', text: 'All clear - the class is ready to export.' }));
  for (const i of issues) {
    box.append(h('div', { class: `issue ${i.level}`, onclick: () => { if (i.node) select(i.node); } },
      h('span', { class: 'lvl', text: i.level === 'error' ? '✕' : i.level === 'warning' ? '!' : 'i' }), h('span', { text: i.text })));
  }
  $('#btnZip').title = errors ? `${errors} problem(s) - the class may not activate. See Checks.` : "The class with its abapGit files - abapGit: New Offline, Import ZIP";
  return issues;
}

// ------------------------------------------------------------- code

const ABAP_KW = /\b(CLASS|DEFINITION|PUBLIC|PROTECTED|PRIVATE|SECTION|INTERFACES|TYPES|BEGIN|OF|END|TYPE|DATA|STANDARD|TABLE|WITH|EMPTY|KEY|REF|TO|METHODS|ENDCLASS|IMPLEMENTATION|METHOD|ENDMETHOD|IF|ELSEIF|ELSE|ENDIF|CASE|WHEN|ENDCASE|VALUE|LENGTH|DECIMALS|ME)\b/g;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightAbapLine(line) {
  if (/^\s*"/.test(line) || /^\*/.test(line)) return `<span class="cmt">${esc(line)}</span>`;
  const parts = line.split(/(`(?:[^`]|``)*`|'[^']*'|\|(?:[^|\\]|\\.)*\|)/);
  return parts.map((p, i) => (i % 2 ? `<span class="str">${esc(p)}</span>` : esc(p).replace(ABAP_KW, '<span class="kw">$1</span>'))).join('');
}

function highlightXmlLine(line) {
  return esc(line).replace(/(&lt;\/?)([\w:.]+)/g, '$1<span class="tag">$2</span>').replace(/(="[^"]*")/g, '<span class="str">$1</span>');
}

let codeCache = { key: null };
function renderCode() {
  const d = state.design;
  const pre = $('#code');
  const key = `${state.code}:${JSON.stringify(d)}`;
  if (codeCache.key === key) { highlightCode(false); return; }
  codeCache = { key };
  let lines;
  let nodeIds;
  if (state.code === 'abap') {
    const map = generateClassMap(d);
    lines = map.source.replace(/\n$/, '').split('\n');
    nodeIds = map.nodeIds;
    $('#codeInfo').textContent = `${fileName(d.className, 'clas.abap')} · ${lines.length} lines`;
  } else {
    lines = toXml(d).split('\n');
    nodeIds = [];
    $('#codeInfo').textContent = 'what the class builds';
  }
  const hl = state.code === 'abap' ? highlightAbapLine : highlightXmlLine;
  pre.innerHTML = lines.map((l, i) => {
    const n = nodeIds[i] && nodeIds[i] !== 'root' ? ` data-node="${nodeIds[i]}"` : '';
    return `<span class="ln" data-n="${i + 1}"${n}>${hl(l) || ' '}</span>`;
  }).join('');
  highlightCode(false);
}

// mark the selected control's lines, and bring the first into view
function highlightCode(scroll) {
  const pre = $('#code');
  for (const el of pre.querySelectorAll('.ln.hi')) el.classList.remove('hi');
  const lines = pre.querySelectorAll(`.ln[data-node="${CSS.escape(state.selected)}"]`);
  lines.forEach((el) => el.classList.add('hi'));
  if (scroll && lines[0] && state.view !== 'canvas') {
    const top = lines[0].offsetTop - pre.clientHeight / 3;
    if (lines[0].offsetTop < pre.scrollTop || lines[0].offsetTop > pre.scrollTop + pre.clientHeight - 30) pre.scrollTo({ top, behavior: 'smooth' });
  }
}

function setCode(code) {
  state.code = code;
  for (const b of document.querySelectorAll('[data-code]')) b.classList.toggle('active', b.dataset.code === code);
  renderCode();
}

function setView(view) {
  state.view = view;
  state.prefs.view = view;
  savePrefs();
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
  $('#stageBody').className = `stage-body view-${view}`;
  highlightCode(true);
}

// ------------------------------------------------------------- preview

let previewTimer = null;
function previewUrl() {
  const q = new URLSearchParams();
  if (state.prefs.ui5) q.set('ui5', state.prefs.ui5);
  if (state.prefs.theme) q.set('theme', state.prefs.theme);
  return `preview.html?${q}`;
}

function loadPreview() {
  state.previewReady = false;
  $('#preview').src = previewUrl();
}

function postPreview(msg) {
  const f = $('#preview');
  if (!state.previewReady || !f.contentWindow) return;
  f.contentWindow.postMessage(Object.assign({ target: 'dsg-preview' }, msg), '*');
}

function sendPreview(now) {
  clearTimeout(previewTimer);
  const send = () => postPreview({
    type: 'render', xml: toXml(state.design, { preview: true }), model: previewModel(state.design), selected: state.selected, mode: state.mode, label: labelOfSelection(),
  });
  if (now) send(); else previewTimer = setTimeout(send, 120);
}

function onToolbarAction(action, id) {
  if (action === 'parent') {
    const hit = findNode(state.design.root, id);
    if (hit && hit.parent) select(hit.parent.id);
  } else if (action === 'up') commit((d) => shiftNode(d, id, -1));
  else if (action === 'down') commit((d) => shiftNode(d, id, 1));
  else if (action === 'dup') commit((d) => duplicateNode(d, id) || toast('It cannot be duplicated: its slot takes one control'));
  else if (action === 'del') commit((d) => removeNode(d, id));
}

window.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.source !== 'dsg-preview' || e.source !== $('#preview').contentWindow) return;
  const count = () => { document.body.dataset.renders = String(Number(document.body.dataset.renders || 0) + 1); };
  if (msg.type === 'ready') {
    state.previewReady = true;
    $('#ui5version').placeholder = `UI5 ${msg.version}`;
    sendPreview(true);
  } else if (msg.type === 'select') {
    select(msg.id);
  } else if (msg.type === 'action') {
    onToolbarAction(msg.action, msg.id);
  } else if (msg.type === 'drop') {
    handleDrop(msg.data, msg.onId, null, msg.zone);
  } else if (msg.type === 'key') {
    onKey({ key: msg.key, ctrlKey: msg.ctrl, metaKey: false, shiftKey: msg.shift, altKey: msg.alt, preventDefault() {}, target: document.body });
  } else if (msg.type === 'error') {
    document.body.dataset.previewError = msg.message;
    count();
  } else if (msg.type === 'rendered') {
    delete document.body.dataset.previewError;
    count();
  }
});

// ------------------------------------------------------------- command palette

function commands() {
  const list = [];
  const sel = findNode(state.design.root, state.selected);
  for (const p of PATTERNS) list.push({ kind: 'block', title: p.title, detail: p.text, run: () => insertPattern(p.id, state.selected) });
  for (const t of Object.keys(CONTROLS)) list.push({ kind: 'insert', title: displayType(t), detail: DESCRIPTIONS[t], run: () => addControl(t) });
  walk(state.design.root, (n) => {
    if (n.id !== 'root') list.push({ kind: 'go to', title: displayType(n.type), detail: nodeLabel(n), run: () => select(n.id) });
    return true;
  });
  const action = (title, run, detail) => list.push({ kind: 'action', title, detail, run });
  action('Show layout and code', () => setView('split'));
  action('Export abapGit ZIP', exportZip);
  action('Copy ABAP', () => copyText(generateClass(state.design), 'ABAP'));
  action('New from template', newDialog);
  action('Import UI5 XML view', importDialog);
  action('Save design', saveDesign);
  action('Open design', () => openFile('.json,.xml'));
  action('Show layout only', () => setView('canvas'));
  action('Show code only', () => setView('code'));
  action('Paste', pasteSelection, 'Ctrl+V');
  action('Undo', undo, 'Ctrl+Z');
  action('Redo', redo, 'Ctrl+Shift+Z');
  if (sel && sel.parent) {
    action('Delete selection', () => commit((d) => removeNode(d, state.selected)), 'Del');
    action('Duplicate selection', () => commit((d) => duplicateNode(d, state.selected)), 'Ctrl+D');
    action('Copy selection', () => copySelection(false), 'Ctrl+C');
    action('Cut selection', () => copySelection(true), 'Ctrl+X');
    action('Select parent', () => select(sel.parent.id), 'Alt+↑');
  }
  return list;
}

function openPalette() {
  const dlg = $('#cmdk');
  const input = $('#cmdkInput');
  const listBox = $('#cmdkList');
  const all = commands();
  let active = 0;
  let shown = [];
  const render = () => {
    const q = input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    shown = all.filter((c) => words.every((w) => `${c.kind} ${c.title} ${c.detail || ''}`.toLowerCase().includes(w))).slice(0, 60);
    active = Math.min(active, Math.max(0, shown.length - 1));
    listBox.replaceChildren(...shown.map((c, i) => h('div', {
      class: `cmdk-item${i === active ? ' active' : ''}`,
      role: 'option',
      'aria-selected': i === active ? 'true' : 'false',
      onmousemove: () => { if (active !== i) { active = i; render(); } },
      onclick: () => run(i),
    }, h('span', { class: 'ck', text: c.kind }), h('span', { text: c.title }), c.detail ? h('span', { class: 'cd', text: c.detail }) : null)));
    listBox.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => {
    const c = shown[i];
    dlg.close();
    if (c) c.run();
  };
  input.value = '';
  input.oninput = () => { active = 0; render(); };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
  };
  render();
  dlg.showModal();
  input.focus();
}

// ------------------------------------------------------------- dialogs

function dialog(title, body, buttons) {
  const dlg = $('#dlg');
  dlg.replaceChildren(h('header', { text: title }), h('div', { class: 'body' }, body),
    h('footer', {}, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => { if (b.action() !== false) dlg.close(); } }, b.text))));
  dlg.showModal();
}

function newDialog() {
  dialog('Start from a template', h('div', {},
    h('p', { class: 'hint', text: 'The current design is replaced - Undo brings it back.' }),
    h('div', { class: 'starters' }, STARTERS.map((s) => h('button', {
      class: 'starter',
      onclick: () => { replaceDesign(s.make()); $('#dlg').close(); toast(`New: ${s.title}`); },
    }, h('b', { text: s.title }), h('span', { text: s.text }))))), [{ text: 'Cancel', action: () => true }]);
}

function importDialog() {
  const ta = h('textarea', { placeholder: '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">…</mvc:View>', spellcheck: 'false' });
  dialog('Import a UI5 XML view', h('div', {},
    h('p', { class: 'hint', text: 'Paste a view or open a .xml file. Bindings come in as expressions; event handlers are dropped, because abap2UI5 events are names, not controller methods. The data attributes stay.' }),
    ta), [
    { text: 'Cancel', action: () => true },
    { text: 'Open file…', action: () => { openFile('.xml'); return true; } },
    {
      text: 'Import', primary: true,
      action: () => {
        try {
          const text = ta.value;
          $('#dlg').close(); // the import opens its summary in the same dialog
          importXmlText(text);
          return false; // closed above - the summary may be open now
        } catch (err) {
          toast(err.message);
          return false;
        }
      },
    },
  ]);
}

function importXmlText(text) {
  replaceDesign(fromXml(text, clone(state.design)));
  const r = importReport();
  const lines = [];
  if (r.handlers.length) lines.push(`${r.handlers.length} event handler(s) dropped - abap2UI5 events are names: ${[...new Set(r.handlers)].slice(0, 6).join(', ')}${r.handlers.length > 6 ? ', …' : ''}`);
  if (r.ids) lines.push(`${r.ids} id(s) dropped - the class needs none`);
  if (r.unknown.length) lines.push(`Not in the palette, kept as imported: ${r.unknown.join(', ')}`);
  if (r.expressions) lines.push(`${r.expressions} binding(s) kept as UI5 expressions (ƒx)`);
  if (!lines.length && !r.unresolved.length) { toast('View imported'); return; }
  const body = h('div', {}, lines.map((t) => h('p', { text: t })));
  const buttons = [{ text: 'OK', primary: !r.unresolved.length, action: () => true }];
  if (r.unresolved.length) {
    body.append(h('p', {}, h('b', { text: `${r.unresolved.length} binding(s) name no attribute of the class: ` }), r.unresolved.map((u) => `{/${u.path}}`).join(', ')));
    buttons.unshift({
      text: `Create ${r.unresolved.length} attribute(s)`, primary: true,
      action: () => { createImportedAttributes(r.unresolved); return true; },
    });
  }
  dialog('View imported', body, buttons);
}

// the attributes an import asked for: a string per {/NAME}, a table with
// one field per {/NAME} that repeats rows - and the expressions that named
// them become bindings
function createImportedAttributes(unresolved) {
  commit((d) => {
    for (const u of unresolved) {
      let name = u.path.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'a');
      if (u.agg && !name.startsWith('t_')) name = `t_${name}`;
      let i = 1;
      const base = name;
      while (d.attributes.some((a) => a.name === name) || checkAttributeName(name)) name = `${base}${++i}`;
      d.attributes.push(u.agg
        ? { name, type: 'table', fields: [{ name: 'TEXT', type: 'string' }], rows: [{ TEXT: 'Row 1' }] }
        : { name, type: 'string', value: '' });
      const re = new RegExp(`^\\{\\s*/${u.path}\\s*\\}$`);
      walk(d.root, (n) => {
        for (const [p, v] of Object.entries(n.props)) if (v.m === 'x' && re.test(v.v)) n.props[p] = { m: 'b', v: name };
        return true;
      });
    }
  });
  showPanel('data');
  toast('Attributes created - edit them on the Data tab');
}

function openFile(accept) {
  const inp = $('#fileInput');
  inp.accept = accept || '.json,.xml';
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      if (/\.xml$/i.test(f.name) || /^\s*</.test(text)) {
        importXmlText(text);
      } else {
        replaceDesign(normalizeDesign(JSON.parse(text)));
        toast(`Opened ${f.name}`);
      }
    } catch (err) {
      toast(`Cannot open ${f.name}: ${err.message}`);
    }
  };
  inp.click();
}

function saveDesign() {
  download(`${state.design.className.toLowerCase().replace(/\//g, '#')}.design.json`, JSON.stringify(state.design, null, 1), 'application/json');
  toast('Design saved');
}

// ------------------------------------------------------------- export

function exportZip() {
  const d = state.design;
  const errors = validate(d).filter((i) => i.level === 'error');
  if (errors.length && !confirm(`${errors.length} problem(s) - the class may not activate:\n\n${errors.slice(0, 5).map((e) => '• ' + e.text).join('\n')}\n\nExport anyway?`)) return;
  const bytes = zip(abapGitFiles(d));
  download(`${d.className.toLowerCase().replace(/\//g, '#')}.zip`, new Blob([bytes], { type: 'application/zip' }));
  toast('Exported - abapGit: New Offline, Import ZIP');
}

// ------------------------------------------------------------- menus

function wireMenu(button, menu) {
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    for (const m of document.querySelectorAll('.menu')) m.hidden = true;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', close);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
}

// ------------------------------------------------------------- panes

function applyWidths() {
  const ws = $('.workspace');
  for (const [key, prop] of [['drawerW', '--drawer-w'], ['inspectorW', '--inspector-w']]) {
    if (state.prefs[key]) ws.style.setProperty(prop, `${state.prefs[key]}px`); else ws.style.removeProperty(prop);
  }
}

function wireResizer(handle, pane, min, max) {
  if (!handle) return;
  const key = `${pane}W`;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const start = e.clientX;
    const from = state.prefs[key] || (pane === 'drawer' ? 280 : 320);
    const move = (ev) => {
      const delta = pane === 'drawer' ? ev.clientX - start : start - ev.clientX;
      state.prefs[key] = Math.round(Math.max(min, Math.min(max, from + delta)));
      applyWidths();
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); savePrefs(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => { delete state.prefs[key]; applyWidths(); savePrefs(); });
}

// ------------------------------------------------------------- keyboard

function onKey(e) {
  // a dialog has the keys: Escape closes it, nothing reaches the design
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
  if (ctrl && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (typing) return;
  const sel = state.selected;
  if (ctrl && !e.shiftKey && (e.key === 'c' || e.key === 'C') && sel !== 'root' && !getSelection().toString()) { e.preventDefault(); copySelection(false); return; }
  if (ctrl && (e.key === 'x' || e.key === 'X') && sel !== 'root') { e.preventDefault(); copySelection(true); return; }
  if (ctrl && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteSelection(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== 'root') { e.preventDefault(); commit((d) => removeNode(d, sel)); }
  if (ctrl && (e.key === 'd' || e.key === 'D') && sel !== 'root') { e.preventDefault(); commit((d) => duplicateNode(d, sel) || toast('It cannot be duplicated: its slot takes one control')); }
  if (e.altKey && e.key === 'ArrowUp') { const hit = findNode(state.design.root, sel); if (hit && hit.parent) select(hit.parent.id); }
  if (e.key === 'Escape') select('root');
}

// ------------------------------------------------------------- render all

function renderAll(opts = {}) {
  const d = state.design;
  const cn = $('#className');
  if (document.activeElement !== cn) cn.value = d.className;
  cn.classList.toggle('invalid', !!checkClassName(d.className));
  if (document.activeElement !== $('#description')) $('#description').value = d.description || '';
  renderLayers();
  // keep the input being typed into: re-rendering its panel would drop it
  if (!opts.keepFocus || !$('#inspector').contains(document.activeElement)) renderInspector();
  if (!opts.keepFocus || !$('#dataPanel').contains(document.activeElement)) renderData();
  renderIssues();
  renderCrumbs();
  renderInsertTarget();
  renderCode();
  sendPreview();
  $('#btnUndo').disabled = !state.undo.length;
  $('#btnRedo').disabled = !state.redo.length;
}

// ------------------------------------------------------------- wiring

function wire() {
  $('#insertSearch').addEventListener('input', renderInsert);
  $('#className').addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase().replace(/\s/g, '');
    commit((d) => { d.className = v; }, { mergeKey: 'className', keepFocus: true });
  });
  $('#description').addEventListener('input', (e) => commit((d) => { d.description = e.target.value; }, { mergeKey: 'description', keepFocus: true }));
  wireMenu($('#btnFile'), $('#fileMenu'));
  wireMenu($('#btnExport'), $('#exportMenu'));
  $('#btnNew').onclick = newDialog;
  $('#btnOpen').onclick = () => openFile('.json,.xml');
  $('#btnSave').onclick = saveDesign;
  $('#btnImport').onclick = importDialog;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnCmd').onclick = openPalette;
  $('#btnZip').onclick = exportZip;
  $('#btnZip2').onclick = exportZip;
  $('#btnCopy').onclick = () => copyText(generateClass(state.design), 'ABAP');
  $('#btnCopyXml').onclick = () => copyText(toXml(state.design), 'XML');
  $('#btnDownloadAbap').onclick = () => download(fileName(state.design.className, 'clas.abap'), generateClass(state.design), 'text/plain');
  for (const b of document.querySelectorAll('.rail-btn')) b.onclick = () => showPanel(b.dataset.panel);
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  for (const b of document.querySelectorAll('[data-code]')) b.onclick = () => setCode(b.dataset.code);
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      for (const x of document.querySelectorAll('[data-mode]')) x.classList.toggle('active', x === b);
      postPreview({ type: 'mode', mode: state.mode });
    };
  }
  // a click on a line of the class selects the control it writes
  $('#code').addEventListener('click', (e) => {
    const ln = e.target.closest('.ln[data-node]');
    if (ln && !getSelection().toString()) select(ln.dataset.node, { fromCode: true });
  });
  const setDevice = (w) => {
    state.prefs.device = w;
    $('#deviceFrame').style.width = w;
    for (const b of document.querySelectorAll('[data-device]')) b.classList.toggle('active', b.dataset.device === w);
  };
  setDevice(state.prefs.device);
  for (const b of document.querySelectorAll('[data-device]')) b.onclick = () => { setDevice(b.dataset.device); savePrefs(); };
  const theme = $('#theme');
  theme.value = state.prefs.theme;
  theme.onchange = () => { state.prefs.theme = theme.value; savePrefs(); loadPreview(); };
  const ver = $('#ui5version');
  ver.value = state.prefs.ui5 && !state.prefs.ui5.startsWith('local') ? state.prefs.ui5 : '';
  ver.onchange = () => {
    const v = ver.value.trim();
    if (v && !/^\d+\.\d+\.\d+$/.test(v)) { ver.classList.add('invalid'); toast('A version like 1.71.80, or empty for the latest'); return; }
    ver.classList.remove('invalid');
    state.prefs.ui5 = v;
    const minor = /^1\.(\d+)\./.exec(v);
    if (minor && Number(minor[1]) < 102 && state.prefs.theme === 'sap_horizon') { state.prefs.theme = 'sap_fiori_3'; theme.value = 'sap_fiori_3'; }
    savePrefs();
    loadPreview();
  };
  document.addEventListener('keydown', onKey);

  // the drawer and the properties can be dragged wider or narrower
  wireResizer($('#resizeDrawer'), 'drawer', 200, 480);
  wireResizer($('#resizeInspector'), 'inspector', 240, 560);
  applyWidths();

  // the canvas around the frame takes drops too
  const pane = $('#canvasPane');
  pane.addEventListener('dragover', (e) => e.preventDefault());
  pane.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
  $('#layers').addEventListener('keydown', onLayersKey);
  $('#layers').addEventListener('dragover', (e) => e.preventDefault());
  $('#layers').addEventListener('drop', (e) => { e.preventDefault(); clearDropMarks(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
}

// ------------------------------------------------------------- start

loadPrefs();
state.design = loadDesign();
state.selected = state.design.root.aggs.content && state.design.root.aggs.content[0] ? state.design.root.aggs.content[0].id : 'root';
wire();
setView(state.view);
renderInsert();
renderAll();
loadPreview();

// for the browser tests and the curious: the state and the generators
window.designer = { state, generateClass, toXml, validate, select, commit, handleDrop, openPalette, copySelection, pasteSelection };
