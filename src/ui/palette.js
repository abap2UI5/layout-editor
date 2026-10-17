// The command palette (Ctrl+K): insert, jump to or run anything.
import { CONTROLS, DESCRIPTIONS } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { walk, findNode } from '../model.js';
import { generateClassSource } from '../clas.js';
import { state, select, undo, redo, selectedIds } from './store.js';
import { $, h, displayType, nodeLabel } from './dom.js';
import { addControl, insertPattern, copySelection, pasteSelection, copyProperties, pasteProperties } from './edit.js';
import { setView, copyText } from './code.js';
import { exportZip, newDialog, importDialog, recentDialog, shareLink, insertByNameDialog, saveDesign, saveToBrowser, openFile } from './files.js';
import { shortcutsDialog } from './keys.js';
import { WRAPPERS, deleteSelection, duplicateSelection, moveSelection, selectParent, wrapSelection } from './actions.js';


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
  action('Copy ABAP', () => copyText(generateClassSource(state.design), 'ABAP'));
  action('New from template', newDialog);
  action('Import UI5 XML view', importDialog);
  action('Save design', saveDesign);
  action('Save design in this browser', saveToBrowser, 'under its class name');
  action('Open design, view or class', () => openFile('.json,.xml,.abap'));
  action('Designs in this browser', recentDialog, 'saved and recent');
  action('Insert any UI5 control by class name', insertByNameDialog, 'e.g. sap.m.Wizard');
  action('Copy share link', shareLink, 'the design in a URL');
  action('Show layout only', () => setView('canvas'));
  action('Show code only', () => setView('code'));
  action('Paste', pasteSelection, 'Ctrl+V');
  action('Keyboard shortcuts', shortcutsDialog, '?');
  action('Undo', undo, 'Ctrl+Z');
  action('Redo', redo, 'Ctrl+Shift+Z');
  if (sel && sel.parent) {
    const n = selectedIds().length;
    const what = n > 1 ? `${n} selected controls` : 'selection';
    action(`Delete ${what}`, () => deleteSelection(), 'Del');
    action(`Duplicate ${what}`, () => duplicateSelection(), 'Ctrl+D');
    action(`Copy ${what}`, () => copySelection(false), 'Ctrl+C');
    action(`Cut ${what}`, () => copySelection(true), 'Ctrl+X');
    action(`Move ${what} up`, () => moveSelection(-1), 'Ctrl+↑');
    action(`Move ${what} down`, () => moveSelection(1), 'Ctrl+↓');
    action('Select parent', () => selectParent(), 'Alt+↑');
    action('Copy properties', copyProperties, 'to set them on another control');
    if (state.propClipboard) action(`Paste properties onto ${what}`, pasteProperties, `of ${displayType(state.propClipboard.type)}`);
    for (const w of WRAPPERS) action(`Wrap ${what} in ${w}`, () => wrapSelection(w));
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
    // what starts with the words first, then what has them in its title,
    // then the rest - in the order of the list within each
    const rank = (c) => {
      const t = c.title.toLowerCase();
      if (!q) return 0;
      if (t.startsWith(q) || `${c.kind} ${t}`.startsWith(q)) return 0;
      if (words.every((w) => t.includes(w))) return 1;
      return 2;
    };
    shown = all.filter((c) => words.every((w) => `${c.kind} ${c.title} ${c.detail || ''}`.toLowerCase().includes(w)))
      .map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c).slice(0, 60);
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
  // a click on the backdrop (the dialog element itself, outside its box) closes it
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
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
