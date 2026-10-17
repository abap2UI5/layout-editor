// The edits on the selection - delete, duplicate, move, select the parent,
// wrap - one implementation for the keys, the command palette and the
// toolbar on the canvas. Each takes the selection, or the ids it is given.
import { findNode, isAncestor, removeNode, duplicateNode, shiftNode, wrapNodes } from '../model.js';
import { state, commit, select, selectMany, selectedIds } from './store.js';
import { toast, displayType } from './dom.js';

// the controls a container can wrap a selection in
export const WRAPPERS = ['VBox', 'HBox', 'FlexBox', 'Panel'];

// the selected controls without those inside another selected one: what
// happens to a control happens to its children anyway
function topmost(ids) {
  return ids.filter((id) => !ids.some((o) => o !== id && isAncestor(state.design.root, o, id)));
}

export function deleteSelection(ids = selectedIds()) {
  const list = topmost(ids.filter((id) => id !== 'root'));
  if (!list.length) return;
  commit((d) => {
    let next;
    for (const id of list) next = removeNode(d, id) || next;
    // the next selection is never one of the deleted
    return next && findNode(d.root, next) ? next : 'root';
  });
}

export function duplicateSelection(ids = selectedIds()) {
  const list = topmost(ids.filter((id) => id !== 'root'));
  if (!list.length) return;
  const copies = [];
  commit((d) => {
    for (const id of list) {
      const c = duplicateNode(d, id);
      if (c) copies.push(c);
    }
    return copies[copies.length - 1];
  });
  if (!copies.length) toast(list.length > 1 ? 'They cannot be duplicated: their slot takes one control' : 'It cannot be duplicated: its slot takes one control');
  else if (copies.length > 1) selectMany(copies);
}

// one place up (-1) or down (+1) among the siblings; several selected
// controls move together, in the order that keeps them in order
export function moveSelection(delta, ids = selectedIds()) {
  const list = topmost(ids.filter((id) => id !== 'root'));
  if (!list.length) return;
  const keep = [...list];
  commit((d) => {
    const hits = list.map((id) => findNode(d.root, id)).filter(Boolean);
    hits.sort((a, b) => (delta < 0 ? a.index - b.index : b.index - a.index));
    for (const x of hits) {
      const h = findNode(d.root, x.node.id);
      const sib = h.parent.aggs[h.agg][h.index + delta];
      // a selected neighbour that could not move holds the next one back
      if (sib && list.includes(sib.id)) continue;
      shiftNode(d, x.node.id, delta);
    }
    return keep.length === 1 ? keep[0] : undefined;
  });
  if (keep.length > 1) selectMany(keep);
}

export function selectParent(id = state.selected) {
  const hit = findNode(state.design.root, id);
  if (hit && hit.parent) select(hit.parent.id);
}

export function wrapSelection(type, ids = selectedIds()) {
  const list = topmost(ids.filter((id) => id !== 'root'));
  if (!list.length) { toast('Select the controls to wrap first'); return; }
  commit((d) => wrapNodes(d, list, type));
  const hit = findNode(state.design.root, state.selected);
  if (hit && hit.node.type === type) toast(`Wrapped in ${displayType(type)}`);
}
