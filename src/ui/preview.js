// The canvas: the preview frame (preview.html, src/preview/init.js) gets
// the view and the model, reports what is clicked, dropped and typed.
import { previewModel, findNode, shiftNode, duplicateNode, removeNode, walk, typeFor } from '../model.js';
import { toXml, namespaceUri } from '../xml.js';
import { getControl, registerControl, runtimeDef, parseClassName, splitType } from '../catalog.js';
import { state, select, commit, labelOfSelection, emitChange } from './store.js';
import { $, toast } from './dom.js';
import { handleDrop } from './edit.js';
import { onKey } from './keys.js';


let previewTimer = null;

function previewUrl() {
  const q = new URLSearchParams();
  if (state.prefs.ui5) q.set('ui5', state.prefs.ui5);
  if (state.prefs.theme) q.set('theme', state.prefs.theme);
  return `preview.html?${q}`;
}

export function loadPreview() {
  state.previewReady = false;
  previewStatus(`Loading UI5${state.prefs.ui5 ? ` ${state.prefs.ui5}` : ''}…`);
  $('#preview').src = previewUrl();
}

// the line over the canvas: what UI5 is doing, or what went wrong
function previewStatus(text, level) {
  const el = $('#previewStatus');
  el.textContent = text || '';
  el.className = `preview-status${text ? '' : ' hidden'}${level ? ` ${level}` : ''}`;
}

export function postPreview(msg) {
  const f = $('#preview');
  if (!state.previewReady || !f.contentWindow) return;
  f.contentWindow.postMessage(Object.assign({ target: 'dsg-preview' }, msg), '*');
}

export function sendPreview(now) {
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
  } else if (msg.type === 'described') {
    const d = describing.get(msg.key);
    if (!d) return;
    describing.delete(msg.key);
    if (msg.error) { d.reject(new Error(msg.error)); return; }
    registerControl(d.type, runtimeDef(msg.meta));
    d.resolve(d.type);
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
    previewStatus(msg.boot ? 'UI5 did not load - see the canvas' : `The view ${msg.runtime ? 'failed at runtime' : 'does not render'}: ${msg.message}`, 'error');
    count();
  } else if (msg.type === 'rendered') {
    delete document.body.dataset.previewError;
    previewStatus('');
    count();
  }
});
