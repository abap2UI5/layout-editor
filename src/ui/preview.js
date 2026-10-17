// The canvas: the preview frame (preview.html, src/preview/init.js) gets
// the view and the model, reports what is clicked, dropped and typed.
import { previewModel, walk, typeFor, canHaveChildren } from '../model.js';
import { toXml, namespaceUri } from '../xml.js';
import { getControl, registerControl, runtimeDef, parseClassName, splitType } from '../catalog.js';
import { state, select, labelOfSelection, emitChange } from './store.js';
import { $, h } from './dom.js';
import { handleDrop } from './edit.js';
import { onKey } from './keys.js';
import { deleteSelection, duplicateSelection, moveSelection, selectParent } from './actions.js';
import { openContextMenu, closeContextMenu } from './context.js';
import { openInlineEdit, closeInlineEdit } from './inline.js';


let previewTimer = null;

function previewUrl() {
  const q = new URLSearchParams();
  if (state.prefs.ui5) q.set('ui5', state.prefs.ui5);
  if (state.prefs.theme) q.set('theme', state.prefs.theme);
  return `preview.html?${q}`;
}

// a point of the canvas frame (its own CSS pixels) on the editor's page:
// the frame may be zoomed out
export function frameToPage(x, y) {
  const r = $('#preview').getBoundingClientRect();
  const z = Number(state.prefs.zoom) || 1;
  return { x: r.left + x * z, y: r.top + y * z, z };
}

export function loadPreview() {
  state.previewReady = false;
  // another UI5 may have other defaults; what the old one was asked is gone
  defaultsOf.clear();
  asking.clear();
  previewStatus(`Loading UI5${state.prefs.ui5 ? ` ${state.prefs.ui5}` : ''}…`);
  $('#preview').src = previewUrl();
}

// the line over the canvas: what UI5 is doing, or what went wrong -
// `reload` adds the way out of a canvas that is stuck
function previewStatus(text, level, reload) {
  const el = $('#previewStatus');
  el.replaceChildren(text || '');
  if (text && reload) el.append(h('button', { class: 'link', title: 'Reload the canvas', onclick: () => loadPreview() }, 'Reload canvas'));
  el.title = text || '';
  el.className = `preview-status${text ? '' : ' hidden'}${level ? ` ${level}` : ''}`;
}

export function postPreview(msg) {
  const f = $('#preview');
  if (!state.previewReady || !f.contentWindow) return;
  f.contentWindow.postMessage(Object.assign({ target: 'dsg-preview' }, msg), '*');
}

// the containers without a child: the canvas gives them room to drop into
// - not a control whose children are its values (a list line's
// attributes, a select's items, a column's header)
function holdsControls(n) {
  const c = getControl(n.type);
  if (!c || c.category === 'Input' || c.input) return false;
  const { name } = splitType(n.type);
  if (/ListItem$/.test(name) && name !== 'CustomListItem') return false;
  return !['Column', 'MenuItem', 'ObjectHeader', 'ObjectStatus'].includes(name);
}
function emptyContainers() {
  const out = [];
  walk(state.design.root, (n) => {
    if (n.id !== 'root' && canHaveChildren(n) && holdsControls(n) && !Object.values(n.aggs || {}).some((l) => l.length)) out.push(n.id);
    return true;
  });
  return out;
}

export function sendPreview(now) {
  clearTimeout(previewTimer);
  const send = () => postPreview({
    type: 'render', xml: toXml(state.design, { preview: true }), model: previewModel(state.design), selected: state.selected, also: state.also, mode: state.mode, label: labelOfSelection(), empty: emptyContainers(),
  });
  if (now) send(); else previewTimer = setTimeout(send, 120);
}

// the toolbar acts on the control it sits on - and on the rest of the
// selection with it, when that control is part of it
function onToolbarAction(action, id) {
  const ids = [...state.also, state.selected].includes(id) ? [...state.also, state.selected] : [id];
  if (action === 'parent') selectParent(id);
  else if (action === 'up') moveSelection(-1, ids);
  else if (action === 'down') moveSelection(1, ids);
  else if (action === 'dup') duplicateSelection(ids);
  else if (action === 'del') deleteSelection(ids);
}

// Ask the UI5 runtime of the canvas what a control class is: its
// properties, aggregations and events - and keep it as a catalogue entry,
// so the control works like one of the palette's
const describing = new Map();
let describeSeq = 0;
export function describeControl(className) {
  const parsed = parseClassName(className);
  if (!parsed) return Promise.reject(new Error(`${className} is not a class name like sap.m.Wizard`));
  const type = typeFor(state.design, parsed.lib, parsed.name);
  if (getControl(type)) return Promise.resolve(type);
  if (!state.previewReady) return Promise.reject(new Error('the canvas is still loading UI5'));
  return new Promise((resolve, reject) => {
    const key = `d${++describeSeq}`;
    describing.set(key, { type, resolve, reject });
    postPreview({ type: 'describe', key, module: parsed.module });
    setTimeout(() => { if (describing.delete(key)) reject(new Error(`UI5 did not answer for ${className}`)); }, 15000);
  });
}

// The default values of a control class's properties, from the canvas's
// UI5: null until they are there - `then` runs once they are
const defaultsOf = new Map();
const asking = new Map();
let defaultsSeq = 0;
export function propertyDefaults(type, then) {
  if (defaultsOf.has(type)) return defaultsOf.get(type);
  if (!state.previewReady) return null;
  // asked already: this caller waits for the same answer
  const pending = [...asking.values()].find((a) => a.type === type);
  if (pending) { if (then) pending.then.push(then); return null; }
  const { ns, name } = splitType(type);
  const lib = namespaceUri(state.design, ns);
  if (!lib || type === 'mvc:View') return null;
  const parsed = parseClassName(`${lib}.${name}`);
  if (!parsed) return null;
  const key = `f${++defaultsSeq}`;
  asking.set(key, { type, then: then ? [then] : [] });
  postPreview({ type: 'defaults', key, module: parsed.module });
  setTimeout(() => asking.delete(key), 15000);
  return null;
}

// What the events of Preview mode did: their names, and what the user
// had changed in the model by then - the values on_event would read
const eventLog = [];
function changesOf(model) {
  const start = previewModel(state.design);
  const out = [];
  for (const [k, v] of Object.entries(model || {})) {
    if (JSON.stringify(v) === JSON.stringify(start[k])) continue;
    out.push(Array.isArray(v) ? `${k.toLowerCase()} (table changed)` : `${k.toLowerCase()} = ${JSON.stringify(v)}`);
  }
  return out;
}
export function renderEventLog() {
  const box = $('#eventLog');
  if (!box) return;
  box.classList.toggle('hidden', state.mode !== 'interact' || !eventLog.length);
  box.replaceChildren(h('div', { class: 'ev-head' },
    h('b', { text: 'Events - what on_event would get' }),
    h('button', { class: 'link', onclick: () => { eventLog.length = 0; renderEventLog(); } }, 'Clear')),
  ...eventLog.slice().reverse().map((e) => h('div', { class: 'ev-line' },
    h('code', { text: e.name }),
    h('span', { class: 'muted', text: e.changes.length ? e.changes.join(' · ') : 'the model as the class sent it' }))));
}

// every control of the design the catalogue does not know, described
// anew - a design opened from a file or the browser store lost them
function describeUnknown() {
  const todo = new Set();
  walk(state.design.root, (n) => {
    if (n.id !== 'root' && !getControl(n.type)) {
      const { ns, name } = splitType(n.type);
      const lib = namespaceUri(state.design, ns);
      if (lib) todo.add(`${lib}.${name}`);
    }
    return true;
  });
  for (const c of todo) describeControl(c).then(() => emitChange()).catch(() => {});
}

window.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.source !== 'dsg-preview' || e.source !== $('#preview').contentWindow) return;
  const count = () => { document.body.dataset.renders = String(Number(document.body.dataset.renders || 0) + 1); };
  if (msg.type === 'ready') {
    state.previewReady = true;
    previewStatus('');
    $('#ui5version').placeholder = `UI5 ${msg.version}`;
    sendPreview(true);
    describeUnknown();
    // the properties shown before UI5 was there learn their defaults
    emitChange();
  } else if (msg.type === 'described') {
    const d = describing.get(msg.key);
    if (!d) return;
    describing.delete(msg.key);
    if (msg.error) { d.reject(new Error(msg.error)); return; }
    registerControl(d.type, runtimeDef(msg.meta));
    d.resolve(d.type);
  } else if (msg.type === 'select') {
    closeContextMenu();
    select(msg.id, { extend: !!msg.extend });
  } else if (msg.type === 'defaults') {
    const a = asking.get(msg.key);
    if (!a) return;
    asking.delete(msg.key);
    defaultsOf.set(a.type, msg.defaults || {});
    for (const fn of a.then) fn();
  } else if (msg.type === 'event') {
    eventLog.push({ name: msg.name, changes: changesOf(msg.model) });
    if (eventLog.length > 20) eventLog.shift();
    renderEventLog();
  } else if (msg.type === 'inline') {
    openInlineEdit(msg.id, msg.rect);
  } else if (msg.type === 'scroll') {
    // the field over a control stays over it, or goes
    closeInlineEdit();
  } else if (msg.type === 'context') {
    // the frame's coordinates, on the editor's page
    const at = frameToPage(msg.x, msg.y);
    openContextMenu(at.x, at.y, msg.id);
  } else if (msg.type === 'action') {
    onToolbarAction(msg.action, msg.id);
  } else if (msg.type === 'drop') {
    handleDrop(msg.data, msg.onId, null, msg.zone);
  } else if (msg.type === 'key') {
    onKey({ key: msg.key, ctrlKey: msg.ctrl, metaKey: false, shiftKey: msg.shift, altKey: msg.alt, preventDefault() {}, target: document.body });
  } else if (msg.type === 'error') {
    document.body.dataset.previewError = msg.message;
    previewStatus(msg.boot ? 'UI5 did not load - see the canvas' : msg.runtime ? `The view failed at runtime: ${msg.message}` : msg.message, 'error', true);
    count();
  } else if (msg.type === 'ui5log') {
    // UI5's own error: the view may show, but not as meant
    if (!document.body.dataset.previewError) previewStatus(`UI5 reports: ${msg.message}`, 'warn', true);
  } else if (msg.type === 'rendered') {
    delete document.body.dataset.previewError;
    previewStatus('');
    count();
  }
});
