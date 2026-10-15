// The state of the editor and every way it changes. All state is the
// design document (model.js) plus what the UI remembers (selection, open
// panel, preferences); every edit goes through commit( ), which records
// undo, saves to localStorage and tells the listeners. The panels render
// on 'change' and 'select' (app.js wires them), so this module knows no
// panel.
import { findNode, normalizeDesign } from '../model.js';
import { STARTERS } from '../starters.js';
import { $, displayType } from './dom.js';

const listeners = { change: [], select: [] };
// on('change', fn(opts)) after every edit, on('select', fn(opts)) after
// every change of selection
export function on(event, fn) {
  listeners[event].push(fn);
}
function emit(event, arg) {
  for (const fn of listeners[event]) fn(arg || {});
}
// a re-render without an edit: what the panels show of the design changed
// (a control the runtime described), the design did not
export function emitChange() {
  state.rev += 1;
  emit('change', {});
}

const STORE_KEY = 'abap2ui5-designer:design';

const PREFS_KEY = 'abap2ui5-designer:prefs';


export const state = {
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
  rev: 0, // bumped on every change of the design - a cheap cache key
  prefs: { device: '100%', theme: 'sap_horizon', ui5: '', view: 'split' },
};

const TRUSTED_UI5_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'sdk.openui5.org', 'ui5.sap.com', 'openui5.hana.ondemand.com', 'sapui5.hana.ondemand.com'];

// a ?ui5= a link may set: a version, local, a path on this server, or a
// URL on this host, localhost or one of SAP's UI5 CDNs
export function isLinkableUi5(v) {
  if (!/^https?:/i.test(v)) return true;
  try {
    const { hostname } = new URL(v);
    return hostname === location.hostname || TRUSTED_UI5_HOSTS.includes(hostname);
  } catch { return false; }
}

export function loadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* defaults */ }
  // ?ui5=<version|local> overrides the stored version, for links and tests
  // - but a UI5 on a host of its own only when the user typed it into
  // the UI5 field: its scripts run on this origin, a link is anybody's
  const q = new URLSearchParams(location.search).get('ui5');
  if (q !== null && isLinkableUi5(q)) state.prefs.ui5 = q;
  else if (q !== null) state.refusedUi5 = q;
  // ?playground=<base url> sets where "Open in Playground" goes
  const pg = new URLSearchParams(location.search).get('playground');
  if (pg !== null) { state.prefs.playground = pg; savePrefs(); }
  state.view = state.prefs.view || 'split';
}

export function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* private mode */ }
}

export function loadDesign() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      return normalizeDesign(JSON.parse(raw));
    }
  } catch { /* start fresh */ }
  return STARTERS.find((s) => s.id === 'form').make();
}

// A design in a link: #d=<base64 of the deflated JSON> - a few kilobytes
// for a page, well inside what a browser takes in a URL
export async function designToLink(d) {
  const bytes = new TextEncoder().encode(JSON.stringify(d));
  const packed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(packed))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#d=${b64}`;
}

export async function designFromLink(hash) {
  const m = /^#d=([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  return normalizeDesign(JSON.parse(json));
}

// `json`: the design as text when the caller has it already
function persist(json) {
  try { localStorage.setItem(STORE_KEY, json || JSON.stringify(state.design)); } catch { /* quota or private mode */ }
}

// Every change: snapshot for undo, apply, then re-render. `fn` may return
// the id to select next. Typing into one field merges into one undo step
// (`mergeKey`) and keeps the focus where it is (`keepFocus`).
export function commit(fn, opts = {}) {
  const before = JSON.stringify(state.design);
  const next = fn(state.design);
  const after = JSON.stringify(state.design);
  if (after === before && !opts.force) {
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
  state.rev += 1;
  persist(after);
  emit('change', opts);
}

function restore(json) {
  state.design = JSON.parse(json);
  state.lastMergeKey = null;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  state.rev += 1;
  persist(json);
  emit('change', {});
}

export function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.design));
  restore(state.undo.pop());
}

export function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.design));
  restore(state.redo.pop());
}

// The designs that were replaced - by New, Open, Import or a shared link -
// so one can go back to them: the last eight, newest first
const RECENT_KEY = 'abap2ui5-designer:recent';
export function recentDesigns() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function rememberRecent(d) {
  if (!d || !d.root) return;
  const json = JSON.stringify(d);
  const list = recentDesigns().filter((r) => r.json !== json);
  list.unshift({ className: d.className, description: d.description || '', at: Date.now(), json });
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8))); } catch { /* quota */ }
}

export function replaceDesign(d) {
  rememberRecent(state.design);
  state.undo.push(JSON.stringify(state.design));
  state.redo = [];
  state.design = d;
  state.selected = d.root.aggs.content && d.root.aggs.content[0] ? d.root.aggs.content[0].id : 'root';
  state.collapsed.clear();
  state.rev += 1;
  persist();
  emit('change', {});
}

export function select(id, opts = {}) {
  if (!findNode(state.design.root, id)) id = 'root';
  state.selected = id;
  // typing after a change of selection is a new undo step
  state.lastMergeKey = null;
  // a selected node is never hidden in a collapsed branch
  for (const a of ancestors(id)) state.collapsed.delete(a.id);
  emit('select', opts);
}

export function ancestors(id) {
  const out = [];
  let hit = findNode(state.design.root, id);
  while (hit && hit.parent) {
    out.unshift(hit.parent);
    hit = findNode(state.design.root, hit.parent.id);
  }
  return out;
}

export function labelOfSelection() {
  const hit = findNode(state.design.root, state.selected);
  return hit && hit.node.id !== 'root' ? displayType(hit.node.type) : '';
}


export function showPanel(panel) {
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
