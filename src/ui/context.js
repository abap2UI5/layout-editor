// The context menu of a control - on the canvas, in the outline, or by
// Shift+F10: the edits of src/ui/actions.js and the clipboard, for the
// selection the control is part of.
import { findNode } from '../model.js';
import { state, select, selectedIds } from './store.js';
import { $, h } from './dom.js';
import { WRAPPERS, deleteSelection, duplicateSelection, moveSelection, selectParent, wrapSelection } from './actions.js';
import { copySelection, pasteSelection, copyProperties, pasteProperties } from './edit.js';

let open = null;

export function closeContextMenu() {
  if (!open) return;
  open.remove();
  open = null;
}

// at (x, y) of the editor's page, for control `id` - which joins the
// selection unless it is in it already
export function openContextMenu(x, y, id) {
  closeContextMenu();
  if (!findNode(state.design.root, id) || id === 'root') return;
  if (!selectedIds().includes(id)) select(id);
  const n = selectedIds().length;
  const hit = findNode(state.design.root, state.selected);
  const item = (text, run, key, cls) => h('button', {
    role: 'menuitem', class: cls || null,
    onclick: () => { closeContextMenu(); run(); },
  }, h('span', { text }), key ? h('kbd', { text: key }) : null);
  const sep = () => h('div', { class: 'sep', role: 'separator' });
  const menu = h('div', { class: 'menu ctx', role: 'menu', 'aria-label': n > 1 ? `${n} controls` : 'Control' },
    hit && hit.parent && hit.parent.id !== 'root' ? item('Select parent', () => selectParent(), 'Alt+↑') : null,
    item('Move up', () => moveSelection(-1), 'Ctrl+↑'),
    item('Move down', () => moveSelection(1), 'Ctrl+↓'),
    sep(),
    item('Copy', () => copySelection(false), 'Ctrl+C'),
    item('Cut', () => copySelection(true), 'Ctrl+X'),
    item('Paste', () => pasteSelection(), 'Ctrl+V'),
    item('Duplicate', () => duplicateSelection(), 'Ctrl+D'),
    sep(),
    item('Copy properties', () => copyProperties()),
    state.propClipboard ? item(`Paste properties${n > 1 ? ` onto ${n}` : ''}`, () => pasteProperties()) : null,
    sep(),
    h('div', { class: 'ctx-label', text: 'Wrap in' }),
    h('div', { class: 'ctx-row' }, WRAPPERS.map((w) => item(w, () => wrapSelection(w)))),
    sep(),
    item(n > 1 ? `Delete ${n} controls` : 'Delete', () => deleteSelection(), 'Del', 'danger'));
  document.body.append(menu);
  open = menu;
  // inside the window, whatever the corner
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  const items = () => [...menu.querySelectorAll('button')];
  items()[0].focus();
  menu.addEventListener('keydown', (e) => {
    // the menu has the keys: Delete here is no Delete of the selection
    e.stopPropagation();
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeContextMenu(); return; }
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    list[(next + list.length) % list.length].focus();
  });
}

// at the selected control's row of the outline, or the middle of the canvas
export function openContextMenuAtSelection() {
  if (state.selected === 'root') return;
  const row = $(`#layers .lrow[data-id="${CSS.escape(state.selected)}"]`);
  const r = (row && row.offsetParent ? row : $('#canvasPane')).getBoundingClientRect();
  openContextMenu(r.left + Math.min(40, r.width / 2), r.top + (row ? r.height : r.height / 3), state.selected);
}

if (typeof window !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target)) closeContextMenu(); }, true);
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('resize', closeContextMenu);
  // a wheel, not a scroll: selecting the control scrolls the code to it
  document.addEventListener('wheel', (e) => { if (open && !open.contains(e.target)) closeContextMenu(); }, { capture: true, passive: true });
}
