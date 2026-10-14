// The designer UI: palette, outline, preview, property and data panels,
// code views and export. All state is the design document (model.js); every
// edit goes through commit( ), which records undo, saves to localStorage and
// re-renders.

import { CONTROLS, CATEGORIES, getControl, splitType, NAMESPACES } from './catalog.js';
import {
  createDesign, createNode, clone, walk, findNode, aggNames, aggAccepts, canHaveChildren, insertNode, dropTarget, removeNode,
  moveNode, shiftNode, duplicateNode, rowContext, bindableAggs, bindListToTable, unbindList, attributeUsage, renameAttribute,
  validate, previewModel, checkAttributeName, checkFieldName, checkEventName, checkClassName, SCALAR_TYPES, ATTRIBUTE_TYPES, DESIGN_VERSION,
} from './model.js';
import { toXml, fromXml } from './xml.js';
import { generateClass, abapGitFiles, fileName } from './abap.js';
import { zip } from './zip.js';
import { STARTERS } from './starters.js';

const STORE_KEY = 'abap2ui5-designer:design';
const PREFS_KEY = 'abap2ui5-designer:prefs';
const GLYPHS = {
  Layout: '▤', Display: '¶', Input: '⌨', Lists: '☰', Parts: '◦',
};

const $ = (sel) => document.querySelector(sel);

// ------------------------------------------------------------- state

const state = {
  design: null,
  selected: 'root',
  undo: [],
  redo: [],
  tab: 'preview',
  rtab: 'props',
  mode: 'design',
  previewReady: false,
  prefs: { device: '100%', theme: 'sap_horizon', ui5: '' },
};

function loadPrefs() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* defaults */ }
  // ?ui5=<version|local> overrides the stored version, for links and tests
  const q = new URLSearchParams(location.search).get('ui5');
  if (q !== null) state.prefs.ui5 = q;
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* private mode */ }
}

function loadDesign() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.version === DESIGN_VERSION && d.root) return d;
    }
  } catch { /* start fresh */ }
  return STARTERS.find((s) => s.id === 'form').make();
}

function persist() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.design)); } catch { /* quota or private mode */ }
}

// Every change: snapshot for undo, apply, then re-render. `fn` may return
// the id to select next.
function commit(fn, opts = {}) {
  const before = JSON.stringify(state.design);
  const next = fn(state.design);
  if (JSON.stringify(state.design) === before && !opts.force) {
    if (typeof next === 'string') select(next);
    return;
  }
  if (!opts.mergeKey || state.lastMergeKey !== opts.mergeKey) {
    state.undo.push(before);
    if (state.undo.length > 200) state.undo.shift();
  }
  state.lastMergeKey = opts.mergeKey || null;
  state.redo = [];
  if (typeof next === 'string') state.selected = next;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  persist();
  renderAll(opts);
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(JSON.stringify(state.design));
  state.design = JSON.parse(state.undo.pop());
  state.lastMergeKey = null;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  persist();
  renderAll();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(JSON.stringify(state.design));
  state.design = JSON.parse(state.redo.pop());
  state.lastMergeKey = null;
  if (!findNode(state.design.root, state.selected)) state.selected = 'root';
  persist();
  renderAll();
}

function replaceDesign(d) {
  state.undo.push(JSON.stringify(state.design));
  state.redo = [];
  state.design = d;
  state.selected = d.root.aggs.content && d.root.aggs.content[0] ? d.root.aggs.content[0].id : 'root';
  persist();
  renderAll();
}

function select(id) {
  if (!findNode(state.design.root, id)) id = 'root';
  state.selected = id;
  renderOutline();
  renderProps();
  postPreview({ type: 'select', selected: id });
}

// ------------------------------------------------------------- dom helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function options(values, selected, labels = {}) {
  return values.map((v) => h('option', { value: v, selected: v === selected ? 'selected' : null, text: labels[v] ?? v }));
}

let toastTimer = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    // clipboard refused (no permission, not a secure context): select it
    // in the code view instead, so Ctrl+C works
    showTab(what === 'XML' ? 'xml' : 'abap');
    const pre = what === 'XML' ? $('#xmlCode') : $('#abapCode');
    const range = document.createRange();
    range.selectNodeContents(pre);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Press Ctrl+C to copy the selection');
  }
}

function label(node) {
  const p = node.props || {};
  const show = p.text || p.title || p.headerText || p.label || p.placeholder || p.value || p.key;
  if (!show) return '';
  if (show.m === 's') return show.v;
  if (show.m === 'b') return `→ ${show.v}`;
  if (show.m === 'f') return `{${show.v}}`;
  return show.v;
}

function displayType(type) {
  const { ns, name } = splitType(type);
  return ns && ns !== 'mvc' ? `${name}` : name;
}

function apiLink(type) {
  if (type === 'mvc:View') return 'https://sdk.openui5.org/api/sap.ui.core.mvc.XMLView';
  const { ns, name } = splitType(type);
  const lib = NAMESPACES[ns] || (state.design.namespaces || {})[ns];
  return lib ? `https://sdk.openui5.org/api/${lib}.${name}` : null;
}

// ------------------------------------------------------------- palette

function renderPalette() {
  const q = $('#paletteSearch').value.trim().toLowerCase();
  const box = $('#palette');
  box.replaceChildren();
  for (const cat of CATEGORIES) {
    const items = Object.entries(CONTROLS).filter(([k, c]) => c.category === cat && (!q || k.toLowerCase().includes(q)));
    if (!items.length) continue;
    box.append(h('div', { class: 'pal-cat' },
      h('h3', { text: cat === 'Parts' ? 'Parts (go inside a parent)' : cat }),
      h('div', { class: 'pal-items' }, items.map(([type]) => h('div', {
        class: 'pal-item',
        draggable: 'true',
        title: `${type} - drag onto the preview or the outline, or click to add to the selection`,
        'data-type': type,
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', `dsg:new:${type}`);
          e.dataTransfer.effectAllowed = 'copy';
        },
        onclick: () => addControl(type),
      }, h('span', { class: 'glyph', text: GLYPHS[cat] }), displayType(type)))),
    ));
  }
}

function addControl(type, onId = state.selected) {
  commit((d) => {
    const t = dropTarget(d, onId || 'root', type);
    if (!t) {
      toast(`${displayType(type)} does not fit here`);
      return undefined;
    }
    const node = createNode(type);
    return insertNode(d, node, t.parentId, t.agg, t.index);
  });
}

// a drop: "dsg:new:<type>" or "dsg:move:<id>" onto a node, or into an
// aggregation (`agg`) / at a position (`index`)
function handleDrop(data, onId, place) {
  const m = /^dsg:(new|move):(.+)$/.exec(data || '');
  if (!m) return;
  const [, kind, what] = m;
  if (kind === 'new') {
    if (place) {
      commit((d) => {
        const p = findNode(d.root, place.parentId);
        if (!p || !aggAccepts(p.node, place.agg, what)) {
          toast(`${displayType(what)} does not fit here`);
          return undefined;
        }
        return insertNode(d, createNode(what), place.parentId, place.agg, place.index);
      });
    } else {
      addControl(what, onId);
    }
  } else if (kind === 'move') {
    commit((d) => {
      const hit = findNode(d.root, what);
      if (!hit) return undefined;
      const t = place || dropTarget(d, onId, hit.node.type);
      if (!t) return undefined;
      const r = moveNode(d, what, t.parentId, t.agg, t.index);
      if (!r) toast('It cannot go there');
      return r || undefined;
    });
  }
}

// ------------------------------------------------------------- outline

function renderOutline() {
  const box = $('#outline');
  const scrollTop = box.scrollTop;
  box.replaceChildren();
  const d = state.design;

  const row = (node, depth, extra = {}) => {
    const isRoot = node.id === 'root';
    const lbl = isRoot ? '' : label(node);
    const bound = Object.values(node.props || {}).some((v) => v && v.m === 'b');
    const el = h('div', {
      class: `trow${state.selected === node.id ? ' sel' : ''}`,
      role: 'treeitem',
      'aria-selected': state.selected === node.id ? 'true' : 'false',
      style: `padding-left:${8 + depth * 14}px`,
      draggable: isRoot ? null : 'true',
      'data-id': node.id,
      onclick: (e) => { e.stopPropagation(); select(node.id); },
      ondragstart: (e) => { e.stopPropagation(); e.dataTransfer.setData('text/plain', `dsg:move:${node.id}`); e.dataTransfer.effectAllowed = 'move'; },
    },
    h('span', { class: 'ttype', text: isRoot ? 'View' : displayType(node.type) }),
    bound ? h('span', { class: 'bind-dot', title: 'bound to data', text: '●' }) : null,
    lbl ? h('span', { class: 'tmeta', text: lbl }) : null,
    extra.note ? h('span', { class: 'tmeta', text: extra.note }) : null);
    wireTreeDrop(el, node, extra);
    return el;
  };

  const walkOut = (node, depth, parent, agg, index) => {
    box.append(row(node, depth, { parent, agg, index }));
    const c = getControl(node.type);
    const names = aggNames(node);
    const showAggRows = node.type !== 'mvc:View' && c && c.aggs && Object.keys(c.aggs).length > 1;
    for (const a of names) {
      const kids = node.aggs[a] || [];
      // an empty aggregation shows only on the selected control - enough to
      // drop into, without a tree full of empty slots
      if (!kids.length && (!showAggRows || state.selected !== node.id)) continue;
      let childDepth = depth + 1;
      if (showAggRows || (!c && a)) {
        const binding = node.props[a];
        const aggRow = h('div', { class: 'trow agg', style: `padding-left:${8 + (depth + 1) * 14}px`, 'data-agg': a },
          h('span', { class: 'tagg', text: a }),
          binding && binding.m === 'b' ? h('span', { class: 'tmeta', text: `→ ${binding.v}` }) : null);
        wireAggDrop(aggRow, node, a);
        box.append(aggRow);
        childDepth = depth + 2;
      }
      kids.forEach((k, i) => walkOut(k, childDepth, node, a, i));
    }
  };
  walkOut(d.root, 0, null, null, 0);
  box.scrollTop = scrollTop;
  const sel = box.querySelector('.trow.sel');
  if (sel && (sel.offsetTop < box.scrollTop || sel.offsetTop > box.scrollTop + box.clientHeight - 24)) sel.scrollIntoView({ block: 'nearest' });
}

function clearDropMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after, .drop-inside')) el.classList.remove('drop-before', 'drop-after', 'drop-inside');
}

// where a drop on a tree row goes: the upper quarter before it, the lower
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

// ------------------------------------------------------------- properties

function renderProps() {
  const box = $('#rpane-props');
  box.replaceChildren();
  const d = state.design;
  const hit = findNode(d.root, state.selected);
  if (!hit || hit.node.id === 'root') {
    box.append(h('div', { class: 'empty' },
      h('p', { text: 'Select a control in the preview or the outline.' }),
      h('p', { class: 'hint', text: 'Drag controls from the palette onto the preview or the outline. Bind properties to the attributes on the Data tab - they become public attributes of the class.' })));
    return;
  }
  const node = hit.node;
  const c = getControl(node.type);
  const link = apiLink(node.type);

  box.append(h('div', { class: 'ph' },
    h('div', { class: 'title' }, displayType(node.type), link ? h('a', { href: link, target: '_blank', rel: 'noopener', text: 'API ↗' }) : null),
    h('button', { class: 'icon', title: 'Move up', 'aria-label': 'Move up', onclick: () => commit((dd) => shiftNode(dd, node.id, -1)), text: '↑' }),
    h('button', { class: 'icon', title: 'Move down', 'aria-label': 'Move down', onclick: () => commit((dd) => shiftNode(dd, node.id, 1)), text: '↓' }),
    h('button', { class: 'icon', title: 'Duplicate (Ctrl+D)', 'aria-label': 'Duplicate', onclick: () => commit((dd) => duplicateNode(dd, node.id)), text: '⧉' }),
    h('button', { class: 'icon danger', title: 'Delete (Del)', 'aria-label': 'Delete', onclick: () => commit((dd) => removeNode(dd, node.id)), text: '✕' }),
  ));
  if (!c) box.append(h('p', { class: 'hint', text: 'Imported control the palette does not know - its attributes are kept as they are.' }));

  // list binding
  for (const agg of bindableAggs(node)) {
    const tables = d.attributes.filter((a) => a.type === 'table');
    const cur = node.props[agg] && node.props[agg].m === 'b' ? node.props[agg].v : '';
    box.append(h('div', { class: 'section' },
      h('h2', { text: `Rows (${agg})` }),
      h('div', { class: 'add-row' },
        h('select', {
          'aria-label': `Bind ${agg} to a table`,
          onchange: (e) => commit((dd) => {
            if (e.target.value) bindListToTable(dd, node.id, agg, e.target.value);
            else unbindList(dd, node.id, agg);
          }),
        }, h('option', { value: '', text: tables.length ? '— static items —' : '— no table attribute yet —' }), options(tables.map((t) => t.name), cur)),
        h('button', { onclick: () => newTableFor(node, agg), title: 'Create a table attribute and bind the rows to it' }, '+ Table')),
      h('p', { class: 'hint', text: cur
        ? `One row per line of ${cur}. The template below repeats per row; its properties take the row's fields ({FIELD}).`
        : 'Bind the rows to a table attribute and the control repeats its template per line.' }),
    ));
  }

  // properties
  const ctx = rowContext(d, node.id);
  const propDefs = c ? Object.entries(c.props || {}) : Object.keys(node.props).map((p) => [p, { type: 'string' }]);
  const sec = h('div', { class: 'section' }, h('h2', { text: 'Properties' }));
  for (const [p, def] of propDefs) {
    if (bindableAggs(node).includes(p)) continue;
    sec.append(propRow(node, p, def, ctx));
  }
  if (!c) {
    const inp = h('input', { placeholder: 'add property…', spellcheck: 'false' });
    sec.append(h('div', { class: 'add-row' }, inp, h('button', {
      onclick: () => {
        const n = inp.value.trim();
        if (/^[a-zA-Z][\w]*$/.test(n)) commit((dd) => { findNode(dd.root, node.id).node.props[n] = { m: 's', v: '' }; });
      },
    }, 'Add')));
  }
  box.append(sec);

  // events
  if (c && c.events && c.events.length) {
    const es = h('div', { class: 'section' }, h('h2', { text: 'Events' }),
      h('p', { class: 'hint', text: 'An event name becomes client->_event( ) in the view and a WHEN branch in on_event.' }));
    for (const ev of c.events) {
      const val = node.events[ev] || '';
      const inp = h('input', {
        value: val,
        placeholder: suggestEvent(node, ev),
        spellcheck: 'false',
        'aria-label': `Event ${ev}`,
        oninput: (e) => {
          const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          e.target.classList.toggle('invalid', !!v && !!checkEventName(v));
          commit((dd) => {
            const n = findNode(dd.root, node.id).node;
            if (v) n.events[ev] = v; else delete n.events[ev];
          }, { mergeKey: `ev:${node.id}:${ev}`, keepFocus: true });
        },
        onfocus: (e) => {
          if (!e.target.value) {
            e.target.value = e.target.placeholder;
            e.target.dispatchEvent(new Event('input'));
            e.target.select();
          }
        },
      });
      es.append(h('div', { class: 'erow' }, h('label', { text: ev }), inp));
    }
    box.append(es);
  }

  // children
  if (c && c.aggs) {
    const cs = h('div', { class: 'section' }, h('h2', { text: 'Add inside' }));
    for (const agg of Object.keys(c.aggs)) {
      const allowed = Object.keys(CONTROLS).filter((t) => aggAccepts(node, agg, t));
      if (!allowed.length) continue;
      const sel = h('select', {
        'aria-label': `Add to ${agg}`,
        onchange: () => { if (sel.value) commit((dd) => insertNode(dd, createNode(sel.value), node.id, agg)); },
      }, h('option', { value: '', text: `+ add to ${agg}…` }), options(allowed, null, Object.fromEntries(allowed.map((t) => [t, displayType(t)]))));
      cs.append(h('div', { class: 'add-row' }, sel));
    }
    if (cs.childElementCount > 1) box.append(cs);
  }
}

function suggestEvent(node, ev) {
  const t = splitType(node.type).name.toUpperCase();
  const p = node.props.text && node.props.text.m === 's' ? node.props.text.v : '';
  const base = p ? p.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') : t;
  return ev === 'press' ? (base || t) : `${base || t}_${ev.toUpperCase()}`;
}

function newTableFor(node, agg) {
  commit((d) => {
    let i = 1;
    let name = 't_items';
    while (d.attributes.some((a) => a.name === name)) name = `t_items${++i}`;
    d.attributes.push({
      name, type: 'table',
      fields: [{ name: 'TITLE', type: 'string' }, { name: 'INFO', type: 'string' }],
      rows: [{ TITLE: 'First', INFO: 'A' }, { TITLE: 'Second', INFO: 'B' }, { TITLE: 'Third', INFO: 'C' }],
    });
    bindListToTable(d, node.id, agg, name);
    return node.id;
  });
  toast('Table attribute created - edit it on the Data tab');
}

function attrTypeFor(def) {
  if (def.type === 'boolean') return 'bool';
  if (def.type === 'int') return 'int';
  if (def.type === 'float') return 'decimal';
  return 'string';
}

function propRow(node, p, def, ctx) {
  const d = state.design;
  const value = node.props[p];
  const m = value ? value.m : 's';
  const set = !!value && (value.m !== 's' || value.v !== '');
  const modes = { s: 'Value', b: 'Bind', x: 'Expr' };
  if (ctx || m === 'f') modes.f = 'Field';
  const update = (fn, opts) => commit((dd) => { fn(findNode(dd.root, node.id).node); }, opts);

  const modeSel = h('select', {
    class: 'mode',
    'aria-label': `${p}: kind of value`,
    onchange: (e) => update((n) => {
      const mm = e.target.value;
      if (mm === 's') delete n.props[p];
      else if (mm === 'b') {
        const fits = d.attributes.filter((a) => a.type !== 'table');
        n.props[p] = { m: 'b', v: fits[0] ? fits[0].name : '' };
      } else if (mm === 'f') n.props[p] = { m: 'f', v: ctx && ctx.fields[0] ? ctx.fields[0].name : '' };
      else n.props[p] = { m: 'x', v: value && value.m === 's' ? value.v : '' };
    }),
  }, options(Object.keys(modes), m, modes));

  let editor;
  if (m === 's') {
    const v = value ? value.v : '';
    if (def.type === 'enum' || def.type === 'boolean') {
      const vals = def.type === 'boolean' ? ['true', 'false'] : def.values;
      editor = h('select', {
        'aria-label': p,
        onchange: (e) => update((n) => { if (e.target.value) n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }),
      }, h('option', { value: '', text: '— default —' }), options(vals, v));
    } else {
      editor = h('input', {
        value: v,
        'aria-label': p,
        spellcheck: def.type === 'string' ? 'true' : 'false',
        placeholder: def.hint || (def.type === 'cssSize' ? 'e.g. 10rem' : def.type === 'icon' ? 'sap-icon://…' : ''),
        oninput: (e) => update((n) => { if (e.target.value !== '') n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true }),
      });
    }
  } else if (m === 'b') {
    const attrs = d.attributes.filter((a) => a.type !== 'table');
    editor = h('div', { class: 'val' },
      h('select', {
        'aria-label': `${p}: attribute`,
        onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
      }, value.v && !attrs.some((a) => a.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
      options(attrs.map((a) => a.name), value.v, Object.fromEntries(attrs.map((a) => [a.name, `${a.name} : ${a.type}`])))),
      h('button', { class: 'icon', title: 'New attribute for this property', 'aria-label': 'New attribute', onclick: () => newAttrFor(node, p, def) }, '+'));
  } else if (m === 'f') {
    const fields = ctx ? ctx.fields : [];
    editor = h('select', {
      'aria-label': `${p}: field`,
      onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
    }, value.v && !fields.some((f) => f.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
    options(fields.map((f) => f.name), value.v));
  } else {
    editor = h('input', {
      value: value.v || '',
      'aria-label': `${p}: expression`,
      spellcheck: 'false',
      placeholder: "{= ${/X} > 0 }",
      oninput: (e) => update((n) => { n.props[p] = { m: 'x', v: e.target.value }; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true }),
    });
  }
  return h('div', { class: `prow${set ? ' set' : ''}`, title: `${p} : ${def.type}${def.values ? ` (${def.values.join(', ')})` : ''}` },
    h('label', { text: p }), modeSel, h('div', { class: 'val' }, editor));
}

function newAttrFor(node, p, def) {
  commit((d) => {
    const base = `${splitType(node.type).name}_${p}`.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 26);
    let name = base;
    let i = 1;
    while (d.attributes.some((a) => a.name === name) || checkAttributeName(name)) name = `${base}${++i}`;
    const n = findNode(d.root, node.id).node;
    const cur = n.props[p];
    d.attributes.push({ name, type: attrTypeFor(def), value: cur && cur.m === 's' ? cur.v : '' });
    n.props[p] = { m: 'b', v: name };
  });
  toast('Attribute created on the Data tab');
}

// ------------------------------------------------------------- data

function renderData() {
  const box = $('#rpane-data');
  const focus = rememberFocus(box);
  box.replaceChildren();
  const d = state.design;
  box.append(h('p', { class: 'hint', text: 'The data of the app: public attributes of the class, bound with client->_bind( ). Values here seed model_init and the preview.' }));
  d.attributes.forEach((a, idx) => box.append(attrCard(a, idx)));
  box.append(h('div', { class: 'add-row' },
    h('button', { onclick: () => addAttribute('string') }, '+ Attribute'),
    h('button', { onclick: () => addAttribute('table') }, '+ Table')));
  restoreFocus(box, focus);
}

function addAttribute(type) {
  commit((d) => {
    let i = 1;
    const base = type === 'table' ? 't_table' : 'attr';
    let name = `${base}${i}`;
    while (d.attributes.some((a) => a.name === name)) name = `${base}${++i}`;
    d.attributes.push(type === 'table'
      ? { name, type, fields: [{ name: 'TEXT', type: 'string' }], rows: [{ TEXT: 'Row 1' }] }
      : { name, type, value: '' });
  });
}

function attrCard(a, idx) {
  const d = state.design;
  const upd = (fn, key) => commit((dd) => fn(dd.attributes[idx], dd), { mergeKey: key, keepFocus: true });
  const uses = attributeUsage(d, a.name);
  const nameIn = h('input', {
    class: 'aname',
    value: a.name,
    spellcheck: 'false',
    'aria-label': 'Attribute name',
    'data-focus': `a${idx}-name`,
    onchange: (e) => {
      const v = e.target.value.trim().toLowerCase();
      const err = checkAttributeName(v) || (d.attributes.some((x, j) => j !== idx && x.name === v) ? 'Name is taken' : null);
      if (err) { e.target.classList.add('invalid'); toast(err); return; }
      commit((dd) => { renameAttribute(dd, dd.attributes[idx].name, v); dd.attributes[idx].name = v; });
    },
  });
  const typeSel = h('select', {
    'aria-label': 'Attribute type',
    onchange: (e) => commit((dd) => {
      const at = dd.attributes[idx];
      at.type = e.target.value;
      if (at.type === 'table') { at.fields = at.fields && at.fields.length ? at.fields : [{ name: 'TEXT', type: 'string' }]; at.rows = at.rows || []; delete at.value; } else { at.value = ''; delete at.fields; delete at.rows; }
    }),
  }, options(ATTRIBUTE_TYPES, a.type));
  const del = h('button', {
    class: 'icon danger',
    title: uses ? `Delete - ${uses} binding(s) use it` : 'Delete',
    'aria-label': 'Delete attribute',
    onclick: () => {
      if (uses && !confirm(`${a.name} is bound ${uses} time(s). Delete it anyway? The bindings stay and show as problems.`)) return;
      commit((dd) => { dd.attributes.splice(idx, 1); });
    },
  }, '✕');
  const card = h('div', { class: 'attr' }, h('div', { class: 'attr-head' }, nameIn, typeSel, del));
  if (uses) card.append(h('div', { class: 'uses', text: `bound ${uses}×` }));
  if (a.type !== 'table') {
    card.append(h('div', { class: 'avalue' }, h('span', { class: 'hint', style: 'margin:0', text: 'Value' }), scalarInput(a.type, a.value, (v) => upd((at) => { at.value = v; }, `a${idx}-v`), `a${idx}-v`)));
  } else {
    const fields = h('div', { class: 'fields' }, h('div', { class: 'hint', style: 'margin:0 0 4px', text: 'Fields' }));
    a.fields.forEach((f, fi) => {
      fields.append(h('div', { class: 'frow' },
        h('input', {
          value: f.name, spellcheck: 'false', 'aria-label': 'Field name', 'data-focus': `a${idx}-f${fi}`,
          onchange: (e) => {
            const v = e.target.value.trim().toUpperCase();
            const err = checkFieldName(v) || (a.fields.some((x, j) => j !== fi && x.name === v) ? 'Name is taken' : null);
            if (err) { e.target.classList.add('invalid'); toast(err); return; }
            commit((dd) => renameField(dd, idx, fi, v));
          },
        }),
        h('select', { 'aria-label': 'Field type', onchange: (e) => commit((dd) => { dd.attributes[idx].fields[fi].type = e.target.value; }) }, options(SCALAR_TYPES, f.type)),
        h('button', { class: 'icon danger', 'aria-label': 'Delete field', title: 'Delete field', onclick: () => commit((dd) => { dd.attributes[idx].fields.splice(fi, 1); }) }, '✕')));
    });
    fields.append(h('button', {
      onclick: () => commit((dd) => {
        const at = dd.attributes[idx];
        let i = at.fields.length + 1;
        while (at.fields.some((f) => f.name === `FIELD${i}`)) i++;
        at.fields.push({ name: `FIELD${i}`, type: 'string' });
      }),
    }, '+ Field'));
    card.append(fields);

    const table = h('table', { class: 'rows' }, h('tr', {}, a.fields.map((f) => h('th', { text: f.name })), h('th')));
    (a.rows || []).forEach((r, ri) => {
      table.append(h('tr', {}, a.fields.map((f) => h('td', {}, scalarInput(f.type, r[f.name], (v) => upd((at) => { at.rows[ri][f.name] = v; }, `a${idx}-r${ri}-${f.name}`), `a${idx}-r${ri}-${f.name}`))),
        h('td', {}, h('button', { class: 'icon danger', 'aria-label': 'Delete row', title: 'Delete row', onclick: () => commit((dd) => { dd.attributes[idx].rows.splice(ri, 1); }) }, '✕'))));
    });
    card.append(h('div', { class: 'hint', style: 'margin:8px 0 0', text: 'Sample rows (seed model_init and the preview)' }),
      h('div', { class: 'rows-wrap' }, table),
      h('button', { style: 'margin-top:6px', onclick: () => commit((dd) => { (dd.attributes[idx].rows = dd.attributes[idx].rows || []).push({}); }) }, '+ Row'));
  }
  return card;
}

function renameField(d, idx, fi, to) {
  const at = d.attributes[idx];
  const from = at.fields[fi].name;
  at.fields[fi].name = to;
  for (const r of at.rows || []) {
    if (from in r) { r[to] = r[from]; delete r[from]; }
  }
  walk(d.root, (n) => {
    for (const v of Object.values(n.props || {})) {
      if (v && v.m === 'f' && v.v === from) {
        const ctx = rowContext(d, n.id);
        if (ctx && ctx.name === at.name) v.v = to;
      }
    }
    return true;
  });
}

function scalarInput(type, value, onValue, focusKey) {
  if (type === 'bool') {
    return h('input', { type: 'checkbox', checked: value === true || value === 'true', 'aria-label': 'Value', 'data-focus': focusKey, onchange: (e) => onValue(e.target.checked) });
  }
  const t = type === 'date' ? 'date' : type === 'time' ? 'time' : type === 'int' || type === 'decimal' ? 'number' : 'text';
  return h('input', {
    type: t, value: value ?? '', 'aria-label': 'Value', 'data-focus': focusKey,
    step: type === 'time' ? '1' : type === 'decimal' ? '0.01' : null,
    oninput: (e) => onValue(e.target.value),
  });
}

function rememberFocus(box) {
  const a = document.activeElement;
  if (!a || !box.contains(a) || !a.dataset.focus) return null;
  return { key: a.dataset.focus, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(box, f) {
  if (!f) return;
  const el = box.querySelector(`[data-focus="${CSS.escape(f.key)}"]`);
  if (!el) return;
  el.focus();
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* number/date inputs */ }
}

// ------------------------------------------------------------- problems

function renderIssues() {
  const issues = validate(state.design);
  const box = $('#rpane-issues');
  box.replaceChildren();
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const badge = $('#issueCount');
  badge.textContent = String(errors || warns);
  badge.classList.toggle('hidden', !(errors || warns));
  badge.classList.toggle('warn', !errors);
  if (!issues.length) {
    box.append(h('div', { class: 'empty', text: 'No problems - the class is ready to download.' }));
  }
  for (const i of issues) {
    box.append(h('div', { class: `issue ${i.level}`, onclick: () => { if (i.node) { select(i.node); showRTab('props'); } } },
      h('span', { class: 'lvl', text: i.level === 'error' ? '✕' : i.level === 'warning' ? '!' : 'i' }), h('span', { text: i.text })));
  }
  $('#btnZip').title = errors ? `${errors} problem(s) - the class may not activate. See the Problems tab.` : "Download the class as an abapGit ZIP - pull it with abapGit's offline import";
  return issues;
}

// ------------------------------------------------------------- code views

const ABAP_KW = /\b(CLASS|DEFINITION|PUBLIC|PROTECTED|PRIVATE|SECTION|INTERFACES|TYPES|BEGIN|OF|END|TYPE|DATA|STANDARD|TABLE|WITH|EMPTY|KEY|REF|TO|METHODS|ENDCLASS|IMPLEMENTATION|METHOD|ENDMETHOD|IF|ELSEIF|ELSE|ENDIF|CASE|WHEN|ENDCASE|VALUE|LENGTH|DECIMALS|ME)\b/g;

function highlightAbap(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return src.split('\n').map((line) => {
    if (/^\s*"/.test(line) || /^\*/.test(line)) return `<span class="cmt">${esc(line)}</span>`;
    // strings first, keywords outside them
    const parts = line.split(/(`(?:[^`]|``)*`|'[^']*'|\|(?:[^|\\]|\\.)*\|)/);
    return parts.map((p, i) => (i % 2 ? `<span class="str">${esc(p)}</span>` : esc(p).replace(ABAP_KW, '<span class="kw">$1</span>'))).join('');
  }).join('\n');
}

function highlightXml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(src)
    .replace(/(&lt;\/?)([\w:.]+)/g, '$1<span class="tag">$2</span>')
    .replace(/(="[^"]*")/g, '<span class="str">$1</span>');
}

let codeCache = { abap: null, xml: null };
function renderCode() {
  const d = state.design;
  const abap = generateClass(d);
  const xml = toXml(d);
  codeCache = { abap, xml };
  if (state.tab === 'abap') {
    $('#abapCode').innerHTML = highlightAbap(abap);
    $('#abapInfo').textContent = `${fileName(d.className, 'clas.abap')} · ${abap.split('\n').length - 1} lines`;
  }
  if (state.tab === 'xml') $('#xmlCode').innerHTML = highlightXml(xml);
}

// ------------------------------------------------------------- preview

let previewTimer = null;
function previewUrl() {
  const q = new URLSearchParams();
  if (state.prefs.ui5) q.set('ui5', state.prefs.ui5);
  if (state.prefs.theme) q.set('theme', state.prefs.theme);
  return `preview.html?${q}`;
}

function loadPreview() {
  state.previewReady = false;
  $('#preview').src = previewUrl();
}

function postPreview(msg) {
  const f = $('#preview');
  if (!state.previewReady || !f.contentWindow) return;
  f.contentWindow.postMessage(Object.assign({ target: 'dsg-preview' }, msg), '*');
}

function sendPreview(now) {
  clearTimeout(previewTimer);
  const send = () => postPreview({
    type: 'render', xml: toXml(state.design, { preview: true }), model: previewModel(state.design), selected: state.selected, mode: state.mode,
  });
  if (now) send(); else previewTimer = setTimeout(send, 120);
}

window.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.source !== 'dsg-preview' || e.source !== $('#preview').contentWindow) return;
  if (msg.type === 'ready') {
    state.previewReady = true;
    $('#ui5version').placeholder = `UI5 ${msg.version}`;
    sendPreview(true);
  } else if (msg.type === 'select') {
    select(msg.id);
    showRTab('props');
  } else if (msg.type === 'drop') {
    handleDrop(msg.data, msg.onId);
  } else if (msg.type === 'key') {
    onKey({ key: msg.key, ctrlKey: msg.ctrl, metaKey: false, shiftKey: msg.shift, preventDefault() {}, target: document.body });
  } else if (msg.type === 'error') {
    document.body.dataset.previewError = msg.message;
    document.body.dataset.renders = String(Number(document.body.dataset.renders || 0) + 1);
  } else if (msg.type === 'rendered') {
    delete document.body.dataset.previewError;
    document.body.dataset.renders = String(Number(document.body.dataset.renders || 0) + 1);
  }
});

// ------------------------------------------------------------- tabs

function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const t of ['preview', 'abap', 'xml']) $(`#stage-${t}`).classList.toggle('hidden', t !== tab);
  $('#previewTools').classList.toggle('hidden', tab !== 'preview');
  renderCode();
}

function showRTab(tab) {
  state.rtab = tab;
  for (const b of document.querySelectorAll('[data-rtab]')) b.classList.toggle('active', b.dataset.rtab === tab);
  for (const t of ['props', 'data', 'issues']) $(`#rpane-${t}`).classList.toggle('hidden', t !== tab);
}

// ------------------------------------------------------------- render all

function renderAll(opts = {}) {
  const d = state.design;
  const cn = $('#className');
  if (document.activeElement !== cn) cn.value = d.className;
  cn.classList.toggle('invalid', !!checkClassName(d.className));
  if (document.activeElement !== $('#description')) $('#description').value = d.description || '';
  renderOutline();
  // keep the input being typed into: re-rendering the panel would drop it
  if (!opts.keepFocus || !$('#rpane-props').contains(document.activeElement)) renderProps();
  if (!opts.keepFocus || !$('#rpane-data').contains(document.activeElement)) renderData();
  renderIssues();
  renderCode();
  sendPreview();
  $('#btnUndo').disabled = !state.undo.length;
  $('#btnRedo').disabled = !state.redo.length;
}

// ------------------------------------------------------------- dialogs

function dialog(title, body, buttons) {
  const dlg = $('#dlg');
  dlg.replaceChildren(h('header', { text: title }), h('div', { class: 'body' }, body),
    h('footer', {}, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => { if (b.action() !== false) dlg.close(); } }, b.text))));
  dlg.showModal();
}

function newDialog() {
  dialog('New design', h('div', {},
    h('p', { class: 'hint', text: 'Start from a template. The current design is replaced - Undo brings it back.' }),
    h('div', { class: 'starters' }, STARTERS.map((s) => h('button', {
      class: 'starter',
      onclick: () => { replaceDesign(s.make()); $('#dlg').close(); toast(`New: ${s.title}`); },
    }, h('b', { text: s.title }), h('span', { text: s.text }))))), [{ text: 'Cancel', action: () => true }]);
}

function importDialog() {
  const ta = h('textarea', { placeholder: '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">…</mvc:View>', spellcheck: 'false' });
  dialog('Import a UI5 XML view', h('div', {},
    h('p', { class: 'hint', text: 'Paste a view, or open a .xml file. Bindings come in as expressions, event handlers are dropped (abap2UI5 events are named, not controller methods). The data attributes stay.' }),
    ta), [
    { text: 'Cancel', action: () => true },
    { text: 'Open file…', action: () => { openFile('.xml'); return true; } },
    {
      text: 'Import', primary: true,
      action: () => {
        try {
          importXmlText(ta.value);
          return true;
        } catch (err) {
          toast(err.message);
          return false;
        }
      },
    },
  ]);
}

function importXmlText(text) {
  const base = clone(state.design);
  const d = fromXml(text, base);
  replaceDesign(d);
  toast('View imported');
}

function openFile(accept) {
  const inp = $('#fileInput');
  inp.accept = accept || '.json,.xml';
  inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    const text = await f.text();
    try {
      if (/\.xml$/i.test(f.name) || /^\s*</.test(text)) {
        importXmlText(text);
      } else {
        const d = JSON.parse(text);
        if (!d || !d.root || d.version !== DESIGN_VERSION) throw new Error('Not a designer file');
        replaceDesign(d);
        toast(`Opened ${f.name}`);
      }
    } catch (err) {
      toast(`Cannot open ${f.name}: ${err.message}`);
    }
  };
  inp.click();
}

// ------------------------------------------------------------- export

function exportZip() {
  const d = state.design;
  const errors = validate(d).filter((i) => i.level === 'error');
  if (errors.length && !confirm(`${errors.length} problem(s) - the class may not activate:\n\n${errors.slice(0, 5).map((e) => '• ' + e.text).join('\n')}\n\nDownload anyway?`)) return;
  const bytes = zip(abapGitFiles(d));
  download(`${d.className.toLowerCase().replace(/\//g, '#')}.zip`, new Blob([bytes], { type: 'application/zip' }));
  toast('abapGit ZIP downloaded - abapGit → New Offline → Import ZIP');
}

// ------------------------------------------------------------- keyboard

function onKey(e) {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !typing && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (ctrl && !typing && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
  if (typing) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected !== 'root') { e.preventDefault(); commit((d) => removeNode(d, state.selected)); }
  if (ctrl && (e.key === 'd' || e.key === 'D') && state.selected !== 'root') { e.preventDefault(); commit((d) => duplicateNode(d, state.selected)); }
  if (e.key === 'Escape') select('root');
}

// ------------------------------------------------------------- wiring

function wire() {
  $('#paletteSearch').addEventListener('input', renderPalette);
  $('#className').addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase().replace(/\s/g, '');
    commit((d) => { d.className = v; }, { mergeKey: 'className', keepFocus: true });
  });
  $('#description').addEventListener('input', (e) => commit((d) => { d.description = e.target.value; }, { mergeKey: 'description', keepFocus: true }));
  $('#btnNew').onclick = newDialog;
  $('#btnOpen').onclick = () => openFile('.json,.xml');
  $('#btnSave').onclick = () => {
    download(`${state.design.className.toLowerCase().replace(/\//g, '#')}.design.json`, JSON.stringify(state.design, null, 1), 'application/json');
    toast('Design saved');
  };
  $('#btnImport').onclick = importDialog;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnCopy').onclick = () => copyText(generateClass(state.design), 'ABAP');
  $('#btnCopy2').onclick = () => copyText(generateClass(state.design), 'ABAP');
  $('#btnCopyXml').onclick = () => copyText(toXml(state.design), 'XML');
  $('#btnZip').onclick = exportZip;
  $('#btnDownloadAbap').onclick = () => download(fileName(state.design.className, 'clas.abap'), generateClass(state.design), 'text/plain');
  for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
  for (const b of document.querySelectorAll('[data-rtab]')) b.onclick = () => showRTab(b.dataset.rtab);
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      for (const x of document.querySelectorAll('[data-mode]')) x.classList.toggle('active', x === b);
      postPreview({ type: 'mode', mode: state.mode });
    };
  }
  const device = $('#device');
  device.value = state.prefs.device;
  $('#deviceFrame').style.width = state.prefs.device;
  device.onchange = () => { state.prefs.device = device.value; $('#deviceFrame').style.width = device.value; savePrefs(); };
  const theme = $('#theme');
  theme.value = state.prefs.theme;
  theme.onchange = () => { state.prefs.theme = theme.value; savePrefs(); loadPreview(); };
  const ver = $('#ui5version');
  ver.value = state.prefs.ui5 === 'local' ? '' : state.prefs.ui5;
  ver.onchange = () => {
    const v = ver.value.trim();
    if (v && !/^\d+\.\d+\.\d+$/.test(v)) { ver.classList.add('invalid'); toast('A version like 1.71.80, or empty for the latest'); return; }
    ver.classList.remove('invalid');
    state.prefs.ui5 = v;
    // Horizon exists from 1.102 on - an older release falls back to Quartz
    if (v && /^1\.(\d+)\./.test(v) && Number(RegExp.$1) < 102 && state.prefs.theme === 'sap_horizon') { state.prefs.theme = 'sap_fiori_3'; theme.value = 'sap_fiori_3'; }
    savePrefs();
    loadPreview();
  };
  document.addEventListener('keydown', onKey);

  // the whole preview stage takes drops too (on the frame border, empty space)
  const stage = $('#stage-preview');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
  $('#outline').addEventListener('dragover', (e) => e.preventDefault());
  $('#outline').addEventListener('drop', (e) => { e.preventDefault(); clearDropMarks(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
}

// ------------------------------------------------------------- start

loadPrefs();
state.design = loadDesign();
state.selected = state.design.root.aggs.content && state.design.root.aggs.content[0] ? state.design.root.aggs.content[0].id : 'root';
wire();
renderPalette();
renderAll();
loadPreview();

// for the browser tests and the curious: the state and the generators
window.designer = { state, generateClass, toXml, validate, select, commit, handleDrop };
