// The command palette (Ctrl+K): insert, jump to or run anything.
import { CONTROLS, DESCRIPTIONS } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { walk, findNode, removeNode, duplicateNode } from '../model.js';
import { generateClass } from '../abap.js';
import { state, select, commit, undo, redo } from './store.js';
import { $, h, displayType, nodeLabel } from './dom.js';
import { addControl, insertPattern, copySelection, pasteSelection } from './edit.js';
import { setView, copyText } from './code.js';
import { exportZip, newDialog, importDialog, recentDialog, shareLink, saveDesign, openFile } from './files.js';


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
  action('Recent designs', recentDialog);
  action('Copy share link', shareLink, 'the design in a URL');
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

export function openPalette() {
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
