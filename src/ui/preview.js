// The canvas: the preview frame (preview.html, src/preview/init.js) gets
// the view and the model, reports what is clicked, dropped and typed.
import { previewModel, findNode, shiftNode, duplicateNode, removeNode } from '../model.js';
import { toXml } from '../xml.js';
import { state, select, commit, labelOfSelection } from './store.js';
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
  $('#preview').src = previewUrl();
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
