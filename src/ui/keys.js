// The keyboard shortcuts of the editor - also reached from the canvas.
import { findNode, removeNode, duplicateNode } from '../model.js';
import { state, select, commit, undo, redo } from './store.js';
import { toast } from './dom.js';
import { openPalette } from './palette.js';
import { copySelection, pasteSelection } from './edit.js';


export function onKey(e) {
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
