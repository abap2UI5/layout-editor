// The Controls panel: building blocks and the palette, by category, to
// drag or click.
import { CONTROLS, CATEGORIES, DESCRIPTIONS } from '../catalog.js';
import { PATTERNS } from '../patterns.js';
import { canHaveChildren, findNode } from '../model.js';
import { state } from './store.js';
import { $, h, displayType } from './dom.js';
import { addControl, insertPattern } from './edit.js';

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
  if (!box.childElementCount) box.append(h('div', { class: 'empty', text: 'Nothing matches.' }));
}

// where a click in the insert panel puts the control
export function renderInsertTarget() {
  const box = $('#insertTarget');
  const hit = findNode(state.design.root, state.selected);
  const where = !hit || hit.node.id === 'root' ? 'the view' : displayType(hit.node.type);
  box.replaceChildren('A click inserts into ', h('b', { text: where }), canHaveChildren(hit ? hit.node : state.design.root) ? '' : ' (next to it)');
}
