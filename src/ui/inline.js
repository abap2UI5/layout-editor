// Editing the text of a control where it is: a double-click on the canvas
// opens a field over the control for its text (title, header text, …);
// every keystroke is an edit, Enter or a click elsewhere keeps it, Escape
// takes it back.
import { getControl } from '../catalog.js';
import { findNode } from '../model.js';
import { state, commit, undo } from './store.js';
import { $, h, toast, displayType } from './dom.js';
import { frameToPage } from './preview.js';

// the properties that are a control's text, the first it has wins
const TEXT_PROPS = ['text', 'title', 'headerText', 'label', 'placeholder', 'value', 'number', 'intro'];

export function inlineProp(node) {
  const c = getControl(node.type);
  if (!c || !c.props) return null;
  return TEXT_PROPS.find((p) => c.props[p] && c.props[p].type === 'string') || null;
}

let field = null;

export function closeInlineEdit() { close(); }
if (typeof window !== 'undefined') window.addEventListener('resize', () => close());

function close() {
  if (!field) return;
  const f = field;
  field = null;
  f.remove();
}

// `rect`: the control's box in the frame's coordinates
export function openInlineEdit(id, rect) {
  close();
  const hit = findNode(state.design.root, id);
  if (!hit || id === 'root') return;
  const p = inlineProp(hit.node);
  if (!p) { toast(`${displayType(hit.node.type)} has no text to edit here - see Properties`); return; }
  const cur = hit.node.props[p];
  if (cur && cur.m !== 's') { toast(`${displayType(hit.node.type)}.${p} is bound - change it in Properties`); return; }
  const start = cur ? cur.v : '';
  const frame = $('#preview').getBoundingClientRect();
  const at = frameToPage(Math.max(0, rect.left), Math.max(0, rect.top));
  let edited = false;
  const input = h('input', {
    class: 'inline-edit',
    value: start,
    spellcheck: 'true',
    'aria-label': `${displayType(hit.node.type)} ${p}`,
    oninput: (e) => {
      const v = e.target.value;
      // only an edit that changed the design is one Escape takes back
      const rev = state.rev;
      commit((d) => {
        const n = findNode(d.root, id).node;
        if (v !== '') n.props[p] = { m: 's', v }; else delete n.props[p];
      }, { mergeKey: `inline:${id}:${p}`, keepFocus: true });
      if (state.rev !== rev) edited = true;
    },
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); close(); }
      // Escape: the text as it was - the edit is one undo step, taken back
      else if (e.key === 'Escape') { e.preventDefault(); const back = edited; close(); if (back) undo(); }
    },
    onblur: () => close(),
  });
  input.style.left = `${at.x}px`;
  input.style.top = `${at.y}px`;
  input.style.width = `${Math.max(140, Math.min(rect.width * at.z, frame.right - at.x))}px`;
  input.style.height = `${Math.max(28, Math.min(rect.height * at.z, 44))}px`;
  document.body.append(input);
  field = input;
  input.focus();
  input.select();
}
