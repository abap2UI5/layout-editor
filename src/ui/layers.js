// The Outline: the tree of the view, with drag and drop and the keys, and
// the breadcrumbs below the canvas.
import { getControl } from '../catalog.js';
import { canHaveChildren, aggNames, findNode } from '../model.js';
import { state, select, ancestors } from './store.js';
import { $, h, displayType, nodeLabel } from './dom.js';
import { handleDrop } from './edit.js';


export function renderLayers() {
  const box = $('#layers');
  const scrollTop = box.scrollTop;
  box.replaceChildren();

  const row = (node, depth, extra) => {
    const isRoot = node.id === 'root';
    const kids = canHaveChildren(node) && aggNames(node).some((a) => (node.aggs[a] || []).length);
    const collapsed = state.collapsed.has(node.id);
    const bound = Object.values(node.props || {}).some((v) => v && (v.m === 'b' || v.m === 'f'));
    const lbl = isRoot ? '' : nodeLabel(node);
    const el = h('div', {
      class: `lrow${state.selected === node.id ? ' sel' : ''}`,
      role: 'treeitem',
      tabindex: state.selected === node.id ? '0' : '-1',
      'aria-selected': state.selected === node.id ? 'true' : 'false',
      'aria-expanded': kids ? String(!collapsed) : null,
      'aria-level': String(depth + 1),
      style: `padding-left:${4 + depth * 14}px`,
      draggable: isRoot ? null : 'true',
      'data-id': node.id,
      onclick: (e) => { e.stopPropagation(); select(node.id); },
      ondragstart: (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `dsg:move:${node.id}`); e.dataTransfer.effectAllowed = 'move'; },
    },
    h('button', {
      class: 'caret',
      tabindex: '-1',
      'aria-label': collapsed ? 'Expand' : 'Collapse',
      text: kids ? (collapsed ? '▸' : '▾') : '',
      onclick: (e) => {
        e.stopPropagation();
        if (!kids) return;
        if (collapsed) state.collapsed.delete(node.id); else state.collapsed.add(node.id);
        renderLayers();
      },
    }),
    h('span', { class: 'ltype', text: isRoot ? 'View' : displayType(node.type) }),
    bound ? h('span', { class: 'bind', title: 'bound to data', text: '●' }) : null,
    lbl ? h('span', { class: 'lmeta', text: lbl }) : null);
    wireTreeDrop(el, node, extra);
    return el;
  };

  const out = (node, depth, parent, agg, index) => {
    box.append(row(node, depth, { parent, agg, index }));
    if (state.collapsed.has(node.id)) return;
    const c = getControl(node.type);
    const aggRows = node.type !== 'mvc:View' && c && c.aggs && Object.keys(c.aggs).length > 1;
    for (const a of aggNames(node)) {
      const kids = node.aggs[a] || [];
      // an empty aggregation shows only on the selected control - enough to
      // drop into, without a tree full of empty slots
      if (!kids.length && (!aggRows || state.selected !== node.id)) continue;
      let childDepth = depth + 1;
      if (aggRows || (!c && a)) {
        const binding = node.props[a];
        const aggRow = h('div', { class: 'lrow agg', style: `padding-left:${18 + (depth + 1) * 14}px`, 'data-agg': a },
          h('span', { class: 'lagg', text: a }),
          binding && (binding.m === 'b' || binding.m === 'f') && binding.v ? h('span', { class: 'lmeta', text: `${binding.m === 'b' ? '@' : '#'}${binding.v}` }) : null);
        wireAggDrop(aggRow, node, a);
        box.append(aggRow);
        childDepth = depth + 2;
      }
      kids.forEach((k, i) => out(k, childDepth, node, a, i));
    }
  };
  out(state.design.root, 0, null, null, 0);
  box.scrollTop = scrollTop;
  const sel = box.querySelector('.lrow.sel');
  if (sel && !state.layersNoScroll) sel.scrollIntoView({ block: 'nearest' });
  if (state.focusLayers) { state.focusLayers = false; if (sel) sel.focus(); }
}

// the keys of the outline: up and down walk the visible rows, left
// collapses or goes to the parent, right expands or goes to the first
// child, Enter opens the properties
export function onLayersKey(e) {
  const rows = [...$('#layers').querySelectorAll('.lrow[data-id]')];
  const i = rows.findIndex((r) => r.dataset.id === state.selected);
  if (i < 0) return;
  const go = (j) => { if (rows[j]) { state.focusLayers = true; select(rows[j].dataset.id); } };
  const node = findNode(state.design.root, state.selected);
  const open = node && rows[i].getAttribute('aria-expanded') === 'true';
  if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
  else if (e.key === 'Home') { e.preventDefault(); go(0); }
  else if (e.key === 'End') { e.preventDefault(); go(rows.length - 1); }
  else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    if (open) { state.collapsed.add(state.selected); state.focusLayers = true; renderLayers(); }
    else if (node && node.parent) go(rows.findIndex((r) => r.dataset.id === node.parent.id));
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (rows[i].getAttribute('aria-expanded') === 'false') { state.collapsed.delete(state.selected); state.focusLayers = true; renderLayers(); }
    else if (open) go(i + 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const first = $('#inspector').querySelector('input, select');
    if (first) first.focus();
  }
}

export function clearDropMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-inside')) el.classList.remove('drop-before', 'drop-after', 'drop-inside');
}

// where a drop on a layer goes: the upper quarter before it, the lower
// quarter after it, the middle into it (when it takes children)
function treeDropPlace(e, node, extra) {
  const r = e.currentTarget.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const inside = canHaveChildren(node);
  if (node.id === 'root') return { zone: 'inside' };
  if (y < 0.28 || (!inside && y < 0.5)) return { zone: 'before', place: { parentId: extra.parent.id, agg: extra.agg, index: extra.index } };
  if (y > 0.72 || !inside) return { zone: 'after', place: { parentId: extra.parent.id, agg: extra.agg, index: extra.index + 1 } };
  return { zone: 'inside' };
}

function wireTreeDrop(el, node, extra) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    clearDropMarks();
    el.classList.add(`drop-${treeDropPlace(e, node, extra).zone}`);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after', 'drop-inside'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    const { zone, place } = treeDropPlace(e, node, extra);
    handleDrop(e.dataTransfer.getData('text/plain'), node.id, zone === 'inside' ? null : place);
  });
}

function wireAggDrop(el, node, agg) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); clearDropMarks(); el.classList.add('drop-inside'); });
  el.addEventListener('dragleave', () => el.classList.remove('drop-inside'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropMarks();
    handleDrop(e.dataTransfer.getData('text/plain'), node.id, { parentId: node.id, agg, index: null });
  });
}


export function renderCrumbs() {
  const box = $('#crumbs');
  box.replaceChildren();
  const hit = findNode(state.design.root, state.selected);
  const path = hit ? [...ancestors(state.selected), hit.node] : [state.design.root];
  path.forEach((n, i) => {
    if (i) box.append(h('span', { class: 'sep', text: '›' }));
    box.append(h('button', {
      class: n.id === state.selected ? 'cur' : '',
      text: n.id === 'root' ? 'View' : displayType(n.type),
      title: n.id === 'root' ? 'The view' : nodeLabel(n) || displayType(n.type),
      onclick: () => select(n.id),
    }));
  });
}
