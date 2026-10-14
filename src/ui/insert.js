// The Controls panel: building blocks and the palette, by category, to
// drag or click.
import { CONTROLS, CATEGORIES, DESCRIPTIONS, RUNTIME } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { canHaveChildren, findNode } from '../model.js';
import { state } from './store.js';
import { $, h, displayType } from './dom.js';
import { addControl, insertPattern, addControlByName } from './edit.js';

const GLYPHS = { Layout: '▦', Display: 'T', Input: '⌨', Lists: '☰', Parts: '◦' };


export function renderInsert() {
  const q = $('#insertSearch').value.trim().toLowerCase();
  const box = $('#insertList');
  box.replaceChildren();
  const match = (...texts) => !q || texts.some((t) => t && t.toLowerCase().includes(q));

  const pats = PATTERNS.filter((p) => match(p.title, p.text));
  if (pats.length) {
    box.append(h('div', { class: 'ins-group' }, h('h3', { text: 'Building blocks' }),
      pats.map((p) => h('div', {
        class: 'ins-item pattern',
        draggable: 'true',
        'data-pattern': p.id,
        title: 'Drag onto the canvas or the outline, or click to insert at the selection',
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', `dsg:pattern:${p.id}`); e.dataTransfer.effectAllowed = 'copy'; },
        onclick: () => insertPattern(p.id, state.selected),
      }, h('span', { class: 'ig', text: '◆' }), h('span', { class: 'in', text: p.title }), h('span', { class: 'id', text: p.text })))));
  }
  for (const cat of CATEGORIES) {
    const items = Object.keys(CONTROLS).filter((k) => CONTROLS[k].category === cat && match(k, DESCRIPTIONS[k]));
    if (!items.length) continue;
    box.append(h('div', { class: 'ins-group' },
      h('h3', { text: cat === 'Parts' ? 'Parts - inside their parent' : cat }),
      items.map((type) => h('div', {
        class: 'ins-item',
        draggable: 'true',
        'data-type': type,
        title: `${type} - drag onto the canvas or the outline, or click to insert at the selection`,
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', `dsg:new:${type}`); e.dataTransfer.effectAllowed = 'copy'; },
        onclick: () => addControl(type),
      }, h('span', { class: 'ig', text: GLYPHS[cat] }), h('span', { class: 'in', text: displayType(type) }), h('span', { class: 'id', text: DESCRIPTIONS[type] || '' })))));
  }
  const runtime = Object.keys(RUNTIME).filter((k) => match(k, RUNTIME[k].className));
  if (runtime.length) {
    box.append(h('div', { class: 'ins-group' }, h('h3', { text: 'From the UI5 runtime - not checked against 1.71' }),
      runtime.map((type) => h('div', {
        class: 'ins-item runtime',
        draggable: 'true',
        'data-type': type,
        title: `${RUNTIME[type].className} - drag onto the canvas or the outline, or click to insert at the selection`,
        ondragstart: (e) => { e.dataTransfer.setData('text/plain', `dsg:new:${type}`); e.dataTransfer.effectAllowed = 'copy'; },
        onclick: () => addControl(type),
      }, h('span', { class: 'ig', text: '⚙' }), h('span', { class: 'in', text: displayType(type) }), h('span', { class: 'id', text: RUNTIME[type].className })))));
  }
  if (!box.childElementCount) box.append(h('div', { class: 'empty', text: 'Nothing matches.' }));
  // any control UI5 has, by its class name
  const name = h('input', { placeholder: 'sap.m.Wizard, sap.f.ShellBar…', 'aria-label': 'Class name of a UI5 control', spellcheck: 'false', id: 'insertByName', value: q && q.includes('.') ? q : '' });
  const add = () => { if (name.value.trim()) addControlByName(name.value.trim()); };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  box.append(h('div', { class: 'ins-group byname' }, h('h3', { text: 'Any UI5 control' }),
    h('div', { class: 'add-row' }, name, h('button', { onclick: add }, 'Add')),
    h('p', { class: 'hint', text: 'The canvas asks its UI5 for the control; its properties, aggregations and events come from there. Not checked against 1.71.' })));
}

// where a click in the insert panel puts the control
export function renderInsertTarget() {
  const box = $('#insertTarget');
  const hit = findNode(state.design.root, state.selected);
  const where = !hit || hit.node.id === 'root' ? 'the view' : displayType(hit.node.type);
  box.replaceChildren('A click inserts into ', h('b', { text: where }), canHaveChildren(hit ? hit.node : state.design.root) ? '' : ' (next to it)');
}
