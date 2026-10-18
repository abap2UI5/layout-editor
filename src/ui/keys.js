// The keyboard shortcuts of the editor - also reached from the canvas.
import { state, select, undo, redo, selectedIds } from './store.js';
import { openPalette } from './palette.js';
import { copySelection, pasteSelection } from './edit.js';
import { saveDesign } from './files.js';
import { deleteSelection, duplicateSelection, moveSelection, selectParent } from './actions.js';
import { openContextMenuAtSelection } from './context.js';
import { h, dialog } from './dom.js';

// every shortcut, for the dialog ? opens - the one place they are listed
export const SHORTCUTS = [
  ['Ctrl+K', 'Command palette: insert, jump to or run anything'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
  ['Ctrl+S', 'Save the design as a file'],
  ['Delete', 'Delete the selection'],
  ['Ctrl+D', 'Duplicate the selection'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy, cut, paste the selection'],
  ['Ctrl+↑ / Ctrl+↓', 'Move the selection among its siblings'],
  ['Alt+↑', 'Select the parent'],
  ['Escape', 'Select the view (with several selected: only the last)'],
  ['Ctrl+click / Shift+click', 'Add a control to the selection, or take it out'],
  ['Shift+F10, right-click', 'Context menu of the selection'],
  ['Double-click', 'Edit the text of a control on the canvas'],
  ['↑ ↓ ← → Home End', 'Walk the outline; a letter jumps to the next control of that name'],
  ['Enter', 'From the outline into the properties; in the control search: insert the first match'],
  ['?', 'This list'],
];

export function shortcutsDialog() {
  dialog('Keyboard shortcuts', h('table', { class: 'keys' },
    SHORTCUTS.map(([k, t]) => h('tr', {}, h('td', {}, k.split(' / ').flatMap((x, i) => [i ? ' / ' : null, h('kbd', { text: x })])), h('td', { text: t })))),
  [{ text: 'Close', action: () => true }]);
}


export function onKey(e) {
  // a dialog has the keys: Escape closes it, nothing reaches the design
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
  // the design, not the editor's page
  if (ctrl && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveDesign(); return; }
  if (ctrl && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (typing) return;
  if (e.key === '?' && !ctrl) { e.preventDefault(); shortcutsDialog(); return; }
  const any = selectedIds().length > 0;
  if (ctrl && !e.shiftKey && (e.key === 'c' || e.key === 'C') && any && !getSelection().toString()) { e.preventDefault(); copySelection(false); return; }
  if (ctrl && (e.key === 'x' || e.key === 'X') && any) { e.preventDefault(); copySelection(true); return; }
  if (ctrl && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); pasteSelection(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && any) { e.preventDefault(); deleteSelection(); return; }
  if (ctrl && (e.key === 'd' || e.key === 'D') && any) { e.preventDefault(); duplicateSelection(); return; }
  // Ctrl+↑ / Ctrl+↓ move the selection among its siblings
  if (ctrl && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && any) { e.preventDefault(); moveSelection(e.key === 'ArrowUp' ? -1 : 1); return; }
  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); selectParent(); return; }
  if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && any) { e.preventDefault(); openContextMenuAtSelection(); return; }
  if (e.key === 'Escape') select(state.also.length ? state.selected : 'root');
}
