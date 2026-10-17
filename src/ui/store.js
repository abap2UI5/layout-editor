// The state of the editor and every way it changes. All state is the
// design document (model.js) plus what the UI remembers (selection, open
// panel, preferences); every edit goes through commit( ), which records
// undo, saves to localStorage and tells the listeners. The panels render
// on 'change' and 'select' (app.js wires them), so this module knows no
// panel.
import { findNode, normalizeDesign } from '../model.js';
import { STARTERS } from '../starters.js';
import { toBase64Url } from '../handoff.js';
import { $, displayType, toastError } from './dom.js';

const listeners = { change: [], select: [], panel: [] };
// on('change', fn(opts)) after every edit, on('select', fn(opts)) after
// every change of selection, on('panel', fn( )) when another tab of the
// drawer opens
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
  // the other selected controls, when Ctrl or Shift extends the selection
  // - `selected` is the one the properties show
  also: [],
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

// a UI5 of your own for the canvas, as typed: the folder that holds
// resources/ - an http(s) URL or a path on this server (preview.html
// checks the same shape, and the hosts above, in its own script)
export const isUi5Url = (v) => /^(https?:\/\/|\.{0,2}\/)[^"'<>\s]*$/.test(v);

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
  // in chunks: one spread of a large design's bytes overflows the stack
  return `${location.origin}${location.pathname}#d=${toBase64Url(new Uint8Array(packed))}`;
}

export async function designFromLink(hash) {
  const m = /^#d=([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  return normalizeDesign(JSON.parse(json));
}

// the design as text, kept per revision: a commit needs the text of the
// design before it for undo, and that is the text of the last commit
let snap = { rev: -1, json: '' };
function snapshot() {
  if (snap.rev !== state.rev) snap = { rev: state.rev, json: JSON.stringify(state.design) };
  return snap.json;
}

// the browser store: typing into a field (`later`) writes it once the
// burst is over, and at the latest when the page goes away - every other
// edit at once
let persistTimer = null;
function persist(later) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersist, 250);
  if (!later) flushPersist();
}
export function flushPersist() {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
  try { localStorage.setItem(STORE_KEY, snapshot()); } catch { /* quota or private mode */ }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushPersist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPersist(); });
}

// an undo step: the design and what was selected in it
const step = () => ({ json: snapshot(), selected: state.selected });

// the extra selection keeps only controls that are still there
function pruneSelection() {
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  state.also = state.also.filter((id) => id !== state.selected && id !== 'root' && findNode(state.design.root, id));
}

// Every change: snapshot for undo, apply, then re-render. `fn` may return
// the id to select next. Typing into one field merges into one undo step
// (`mergeKey`) and keeps the focus where it is (`keepFocus`).
export function commit(fn, opts = {}) {
  const before = snapshot();
  const selectedBefore = state.selected;
  let next;
  try {
    next = fn(state.design);
  } catch (err) {
    // an edit that fails half way leaves nothing behind: the design is
    // the one before it, and the panels never saw the half
    state.design = JSON.parse(before);
    toastError(err.message);
    return;
  }
  const after = JSON.stringify(state.design);
  if (after === before && !opts.force) {
    if (typeof next === 'string') select(next);
    return;
  }
  if (!opts.mergeKey || state.lastMergeKey !== opts.mergeKey) {
    state.undo.push({ json: before, selected: selectedBefore });
    if (state.undo.length > 200) state.undo.shift();
  }
  state.lastMergeKey = opts.mergeKey || null;
  state.redo = [];
  if (typeof next === 'string') { state.selected = next; state.also = []; }
  state.rev += 1;
  snap = { rev: state.rev, json: after };
  pruneSelection();
  persist(!!opts.mergeKey);
  emit('change', opts);
}

function restore(entry) {
  state.design = JSON.parse(entry.json);
  state.lastMergeKey = null;
  // the control that was selected when the step was taken
  if (entry.selected) state.selected = entry.selected;
  state.also = [];
  state.rev += 1;
  snap = { rev: state.rev, json: entry.json };
  pruneSelection();
  persist();
  emit('change', {});
  emit('select', {});
}

export function undo() {
  if (!state.undo.length) return;
  state.redo.push(step());
  restore(state.undo.pop());
}

export function redo() {
  if (!state.redo.length) return;
  state.undo.push(step());
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
  state.undo.push(step());
  state.redo = [];
  state.design = d;
  state.selected = d.root.aggs.content && d.root.aggs.content[0] ? d.root.aggs.content[0].id : 'root';
  state.also = [];
  // typing into the new design is a step of its own, never merged into
  // the replacement
  state.lastMergeKey = null;
  state.collapsed.clear();
  state.rev += 1;
  persist();
  emit('change', {});
}

// The designs kept in this browser under their class name - a library
// next to the one design that is open
const LIBRARY_KEY = 'abap2ui5-designer:library';
export function libraryDesigns() {
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); } catch { return []; }
}
function writeLibrary(list) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
}
// true when a design of that class name was there and is replaced
export function saveToLibrary(d) {
  const list = libraryDesigns();
  const had = list.some((r) => r.className === d.className);
  const rest = list.filter((r) => r.className !== d.className);
  rest.unshift({ className: d.className, description: d.description || '', at: Date.now(), json: JSON.stringify(d) });
  writeLibrary(rest);
  return had;
}
export function removeFromLibrary(className) {
  writeLibrary(libraryDesigns().filter((r) => r.className !== className));
}

// `opts.extend`: Ctrl or Shift held - the control joins the selection,
// or leaves it when it is in it already
export function select(id, opts = {}) {
  if (!findNode(state.design.root, id)) id = 'root';
  if (opts.extend && id !== 'root' && state.selected !== 'root') {
    const all = selectedIds();
    if (all.includes(id)) {
      const rest = all.filter((x) => x !== id);
      if (rest.length) { state.selected = rest[rest.length - 1]; state.also = rest.slice(0, -1); }
    } else {
      state.also = all;
      state.selected = id;
    }
  } else {
    state.selected = id;
    state.also = [];
  }
  // typing after a change of selection is a new undo step
  state.lastMergeKey = null;
  // a selected node is never hidden in a collapsed branch
  for (const x of selectedIds()) for (const a of ancestors(x)) state.collapsed.delete(a.id);
  emit('select', opts);
}

// several controls at once, the last one shown in the properties
export function selectMany(ids) {
  const ok = ids.filter((id) => id !== 'root' && findNode(state.design.root, id));
  if (!ok.length) { select('root'); return; }
  state.selected = ok[ok.length - 1];
  state.also = ok.slice(0, -1);
  state.lastMergeKey = null;
  for (const x of ok) for (const a of ancestors(x)) state.collapsed.delete(a.id);
  emit('select', {});
}

// every selected control, the one the properties show last
export function selectedIds() {
  return state.selected === 'root' ? [] : [...state.also, state.selected];
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
  emit('panel');
}
