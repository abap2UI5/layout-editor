// The Properties panel: the rows of a bound list, the properties in
// groups with their kind of value, the events, the children.
import { CONTROLS, DESCRIPTIONS, getControl, splitType, NAMESPACES } from '../catalog.js';
import {
  createNode, findNode, insertNode, aggAccepts, rowContext, bindableAggs, bindListToTable, hasOwnTemplate, unbindList,
  attributeFits, checkEventName, checkStatic, collectEvents,
} from '../model.js';
import { state, commit, selectedIds } from './store.js';
import { $, h, options, toast, choose, displayType, rememberFocus, restoreFocus } from './dom.js';
import { newTableAttribute, offerRows, newAttributeFor } from './edit.js';
import { WRAPPERS, wrapSelection, deleteSelection } from './actions.js';
import { propertyDefaults } from './preview.js';

const KINDS = { s: 'Aa', b: '@', f: '#', x: 'ƒx' };

const KIND_TITLE = 'Aa a value · @ bound to an attribute · # a field of the row · ƒx a UI5 expression';

function apiLink(type) {
  const { ns, name } = splitType(type);
  const lib = NAMESPACES[ns] || (state.design.namespaces || {})[ns];
  return lib ? `https://sdk.openui5.org/api/${lib}.${name}` : null;
}


const PROP_GROUPS = [
  ['Content', (d) => ['string', 'icon', 'uri'].includes(d.type)],
  ['Appearance', (d) => ['enum', 'cssSize', 'int', 'float'].includes(d.type)],
  ['Behaviour', (d) => d.type === 'boolean'],
];

export function renderInspector() {
  const box = $('#inspector');
  const focus = rememberFocus(box);
  const scroll = box.scrollTop;
  box.replaceChildren();
  const d = state.design;
  const hit = findNode(d.root, state.selected);
  if (!hit || hit.node.id === 'root') {
    box.append(h('div', { class: 'empty' },
      h('div', { class: 'big', text: '{ }' }),
      h('p', { text: 'Select a control on the canvas, in the outline or in the code.' }),
      h('p', { class: 'hint', text: 'Drag controls from the left onto the canvas. Bind their properties to attributes on the Data tab - each becomes a public attribute of the class.' })));
    return;
  }
  const node = hit.node;
  const c = getControl(node.type);
  const link = apiLink(node.type);
  const many = selectedIds();
  if (many.length > 1) box.append(multiBar(many));
  // the defaults of the canvas's UI5, asked once per control class
  const defaults = propertyDefaults(node.type, () => {
    // whichever control of that type is selected by the time they come
    const now = findNode(state.design.root, state.selected);
    if (now && now.node.type === node.type) renderInspector();
  }) || {};
  const ctx = rowContext(d, node.id);

  const filter = h('input', {
    type: 'search', placeholder: 'Filter properties…', value: state.inspector.filter, 'aria-label': 'Filter properties', 'data-focus': 'filter',
    oninput: (e) => { state.inspector.filter = e.target.value; renderInspector(); },
  });
  box.append(h('div', { class: 'insp-head' },
    h('div', { class: 'insp-title' }, h('b', { text: displayType(node.type) }), link ? h('a', { href: link, target: '_blank', rel: 'noopener', text: 'UI5 API ↗' }) : null),
    h('div', { class: 'insp-desc', text: DESCRIPTIONS[node.type] || (c && c.runtime ? `${c.className} - from the UI5 runtime, not checked against 1.71` : c ? '' : 'Imported control - kept as it is') }),
    h('div', { class: 'insp-tools' }, filter,
      h('label', {}, h('input', { type: 'checkbox', checked: state.inspector.onlySet, onchange: (e) => { state.inspector.onlySet = e.target.checked; renderInspector(); } }), 'set only'))));

  // rows of a list
  for (const agg of bindableAggs(node)) {
    const tables = d.attributes.filter((a) => a.type === 'table');
    // the table fields of the row this list sits in: a list in a list
    const rowFields = ctx ? (ctx.fields || []).filter((f) => f.type === 'table') : [];
    const b = node.props[agg];
    const cur = b && b.m === 'b' ? b.v : b && b.m === 'f' ? `#${b.v}` : '';
    const tree = node.type === 'Tree';
    box.append(group('Rows', h('div', {},
      h('div', { class: 'add-row' },
        h('select', {
          'aria-label': `Bind ${agg} to a table`,
          onchange: async (e) => {
            const v = e.target.value;
            const replace = !v || !hasOwnTemplate(node, agg, d) || await askReplace(node, agg, v);
            if (replace === null) { renderInspector(); return; }
            commit((dd) => {
              if (v.startsWith('#')) bindListToTable(dd, node.id, agg, v.slice(1), replace, true);
              else if (v) bindListToTable(dd, node.id, agg, v, replace);
              else unbindList(dd, node.id, agg);
            });
          },
        }, h('option', { value: '', text: tree ? '— not bound yet —' : tables.length ? '— static items —' : '— no table attribute yet —' }),
        options(tables.map((t) => t.name), cur),
        rowFields.length ? h('optgroup', { label: `table fields of the row (${ctx.name})` }, options(rowFields.map((f) => `#${f.name}`), cur, Object.fromEntries(rowFields.map((f) => [`#${f.name}`, `# ${f.name}`])))) : null),
        h('button', { onclick: () => newTableFor(node, agg), title: tree ? 'Create a table attribute with a table field for the children and bind the nodes to it' : 'Create a table attribute and bind the rows to it' }, tree ? '+ Nodes table' : '+ Table')),
      h('p', { class: 'hint', text: cur
        ? tree
          ? `One node per row of ${cur}; the children come from its table field${b.arr ? ` ${b.arr}` : ''}. The template's properties take the row's fields (#).`
          : `One line per row of ${cur}. The template inside repeats per row; its properties take the row's fields (#).`
        : tree
          ? 'A tree has to be bound: its nodes are the rows of a table attribute, the children the rows of a table field in it.'
          : 'Bind to a table attribute and the template repeats per row - or to a table field of the row this list sits in.' }))));
  }

  // properties, grouped
  const q = state.inspector.filter.trim().toLowerCase();
  const visible = ([p]) => !bindableAggs(node).includes(p) && (!q || p.toLowerCase().includes(q)) && (!state.inspector.onlySet || isSet(node.props[p]));
  const defs = (c ? Object.entries(c.props || {}) : []).filter(visible);
  for (const [title, test] of PROP_GROUPS) {
    const rows = defs.filter(([, def]) => test(def));
    if (!rows.length) continue;
    box.append(group(title, h('div', {}, title === 'Content' ? h('p', { class: 'hint', text: KIND_TITLE }) : null, rows.map(([p, def]) => propRow(node, p, def, ctx, defaults[p])))));
  }
  // what an import brought along that the catalogue does not know: shown
  // as text, written to the class as it is, and removable
  const extras = Object.keys(node.props).filter((p) => !(c && c.props && c.props[p])).map((p) => [p, { type: 'string' }]).filter(visible);
  if (extras.length || !c) {
    const addProp = () => {
      const n = inp.value.trim();
      if (!/^[a-zA-Z][\w]*$/.test(n)) { inp.classList.add('invalid'); toast('A property name: a letter, then letters, digits or _'); return; }
      if (node.props[n] || (c && c.props && c.props[n])) { toast(`${n} is there already`); return; }
      commit((dd) => { findNode(dd.root, node.id).node.props[n] = { m: 's', v: '' }; });
    };
    const inp = h('input', {
      placeholder: 'add property…', spellcheck: 'false', 'aria-label': 'Property name',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addProp(); } },
      oninput: (e) => e.target.classList.remove('invalid'),
    });
    box.append(group(c ? 'Imported' : 'Properties', h('div', {},
      c ? h('p', { class: 'hint', text: 'Not in the palette - written to the class as it is.' }) : null,
      extras.map(([p, def]) => h('div', { class: 'extra' }, propRow(node, p, def, ctx),
        h('button', { class: 'icon danger', title: `Remove ${p}`, 'aria-label': `Remove ${p}`, onclick: () => commit((dd) => { delete findNode(dd.root, node.id).node.props[p]; }) }, '✕'))),
      !q && !state.inspector.onlySet ? h('div', { class: 'add-row' }, inp, h('button', { onclick: addProp }, 'Add')) : null)));
  }

  // events
  if (c && c.events && c.events.length && (!q || c.events.some((e) => e.toLowerCase().includes(q)))) {
    const evs = c.events.filter((e) => !q || e.toLowerCase().includes(q)).filter((e) => !state.inspector.onlySet || node.events[e]);
    if (evs.length) {
      box.append(group('Events', h('div', {},
        h('p', { class: 'hint', text: 'A name becomes client->_event( ) in the view and a WHEN branch in on_event.' }),
        evs.map((ev) => eventRow(node, ev)),
        // the names the design raises already: one WHEN branch for two controls
        h('datalist', { id: 'eventNames' }, collectEvents(d).map((n) => h('option', { value: n }))))));
    }
  }

  // children
  if (c && c.aggs && !q && !state.inspector.onlySet) {
    const rows = [];
    for (const agg of Object.keys(c.aggs)) {
      const allowed = Object.keys(CONTROLS).filter((t) => aggAccepts(node, agg, t));
      if (!allowed.length) continue;
      const sel = h('select', {
        'aria-label': `Add to ${agg}`,
        onchange: () => {
          if (!sel.value) return;
          let id = null;
          commit((dd) => { id = insertNode(dd, createNode(sel.value), node.id, agg); return id; });
          // a list or a table added here gets the offer of its rows too
          if (id) offerRows(id);
        },
      }, h('option', { value: '', text: `+ add to ${agg}…` }), options(allowed, null, Object.fromEntries(allowed.map((t) => [t, displayType(t)]))));
      rows.push(h('div', { class: 'add-row' }, sel));
    }
    if (rows.length) box.append(group('Children', h('div', {}, rows), false));
  }
  box.scrollTop = scroll;
  restoreFocus(box, focus);
}

function group(title, body, open = true) {
  return h('details', { class: 'group', open: open ? 'open' : null }, h('summary', {}, h('h2', { text: title })), h('div', { class: 'gbody' }, body));
}

function isSet(v) {
  return !!v && (v.m !== 's' || (v.v !== '' && v.v != null));
}

function eventRow(node, ev) {
  const val = node.events[ev] || '';
  const inp = h('input', {
    value: val,
    placeholder: suggestEvent(node, ev),
    spellcheck: 'false',
    'aria-label': `Event ${ev}`,
    'data-focus': `ev-${ev}`,
    list: 'eventNames',
    autocomplete: 'off',
    oninput: (e) => {
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      // the field shows what the class gets, the caret stays where it was
      if (e.target.value !== v) {
        const at = e.target.selectionStart;
        e.target.value = v;
        try { e.target.setSelectionRange(at, at); } catch { /* not focused */ }
      }
      e.target.classList.toggle('invalid', !!v && !!checkEventName(v));
      commit((dd) => {
        const n = findNode(dd.root, node.id).node;
        if (v) n.events[ev] = v; else delete n.events[ev];
      }, { mergeKey: `ev:${node.id}:${ev}`, keepFocus: true });
    },
    // the suggestion is taken by a click into the empty field, or by Enter
    // - never by the focus alone: tabbing through the events would name
    // every one of them
    onclick: (e) => { if (!e.target.value) take(e.target); },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.target.value) { e.preventDefault(); take(e.target); } },
  });
  const take = (el) => {
    el.value = el.placeholder;
    el.dispatchEvent(new Event('input'));
    el.select();
  };
  return h('div', { class: 'event' }, h('label', { text: ev }), inp);
}

function suggestEvent(node, ev) {
  const t = splitType(node.type).name.toUpperCase();
  const p = node.props.text && node.props.text.m === 's' ? node.props.text.v : '';
  const base = p ? p.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') : t;
  return ev === 'press' ? (base || t) : `${base || t}_${ev.toUpperCase()}`;
}

// Replace a template built by hand? true: replace, false: keep it and
// only bind, null: neither (the dialog was closed)
function askReplace(node, agg, table) {
  return choose(`Bind the ${agg} to ${table}`, [
    `This ${displayType(node.type)} has ${agg} of its own. Replace them with a template built from the fields of ${table}, or keep them and only set the binding?`,
  ], [
    { text: 'Keep, only bind', value: false },
    { text: 'Replace with a template', value: true, primary: true },
  ]);
}

async function newTableFor(node, agg) {
  // a template built by hand stays unless the user lets it go - as when
  // the rows are bound to a table that is there
  const replace = !hasOwnTemplate(node, agg, state.design) || await askReplace(node, agg, 'a new table');
  if (replace === null) return;
  commit((d) => {
    const name = newTableAttribute(d, node.type === 'Tree');
    bindListToTable(d, node.id, agg, name, replace);
    return node.id;
  });
  toast('Table attribute created - edit it on the Data tab');
}

// several controls selected: what can be done with all of them
function multiBar(ids) {
  const wrap = h('select', {
    'aria-label': 'Wrap the selection',
    onchange: (e) => { if (e.target.value) wrapSelection(e.target.value); },
  }, h('option', { value: '', text: 'Wrap in…' }), options(WRAPPERS, null));
  return h('div', { class: 'multi-bar' },
    h('b', { text: `${ids.length} controls selected` }),
    h('span', { class: 'hint', text: 'Ctrl+click adds or removes one. The properties are those of the last.' }),
    h('div', { class: 'add-row' }, wrap, h('button', { class: 'danger', onclick: () => deleteSelection() }, 'Delete all')));
}

// a value as the UI5 expression that says the same: a binding keeps its
// path, so switching to ƒx is a start to edit, not a blank
function asExpression(value) {
  if (!value || !value.v) return '';
  if (value.m === 's') return value.v;
  if (value.m === 'b') return value.arr ? `{path:'/${value.v.toUpperCase()}',parameters:{arrayNames:['${value.arr}']}}` : `{/${value.v.toUpperCase()}}`;
  if (value.m === 'f') return `{${value.v}}`;
  return value.v;
}

function propRow(node, p, def, ctx, dflt) {
  const d = state.design;
  const value = node.props[p];
  const m = value ? value.m : 's';
  const kinds = { s: KINDS.s, b: KINDS.b, x: KINDS.x };
  if (ctx || m === 'f') kinds.f = KINDS.f;
  const update = (fn, opts) => commit((dd) => { fn(findNode(dd.root, node.id).node); }, opts);

  const kind = h('select', {
    class: `kind k-${m}`,
    title: KIND_TITLE,
    'aria-label': `${p}: kind of value`,
    'data-focus': `p-${p}-kind`,
    onchange: (e) => update((n) => {
      const mm = e.target.value;
      if (mm === 's') delete n.props[p];
      else if (mm === 'b') {
        const fits = d.attributes.filter((a) => attributeFits(def, a.type));
        n.props[p] = { m: 'b', v: fits[0] ? fits[0].name : '' };
      } else if (mm === 'f') n.props[p] = { m: 'f', v: ctx && ctx.fields[0] ? ctx.fields[0].name : '' };
      else n.props[p] = { m: 'x', v: asExpression(value) };
    }),
  }, options(Object.keys(kinds), m, kinds));

  let editor;
  const focusKey = `p-${p}`;
  if (m === 's') {
    const v = value ? value.v : '';
    if (def.type === 'enum' || def.type === 'boolean') {
      const vals = def.type === 'boolean' ? ['true', 'false'] : def.values;
      editor = h('select', {
        'aria-label': p,
        'data-focus': focusKey,
        onchange: (e) => update((n) => { if (e.target.value) n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }),
      }, h('option', { value: '', text: dflt != null && dflt !== '' ? `— default (${dflt}) —` : '— default —' }), options(vals, v));
    } else {
      const bad = checkStatic(def, v);
      editor = h('input', {
        value: v,
        class: bad ? 'invalid' : null,
        title: bad || null,
        'aria-label': p,
        'data-focus': focusKey,
        spellcheck: def.type === 'string' ? 'true' : 'false',
        placeholder: dflt != null && dflt !== '' ? `default: ${dflt}` : def.hint || (def.type === 'cssSize' ? 'e.g. 10rem' : def.type === 'icon' ? 'sap-icon://…' : ''),
        oninput: (e) => {
          // a value UI5 would refuse shows as one while it is typed
          const w = checkStatic(def, e.target.value);
          e.target.classList.toggle('invalid', !!w);
          e.target.title = w || '';
          update((n) => { if (e.target.value !== '') n.props[p] = { m: 's', v: e.target.value }; else delete n.props[p]; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true });
        },
      });
    }
  } else if (m === 'b') {
    const attrs = d.attributes.filter((a) => attributeFits(def, a.type));
    editor = h('div', { class: 'val' },
      h('select', {
        'aria-label': `${p}: attribute`,
        'data-focus': `${focusKey}-attr`,
        onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
      }, value.v && !attrs.some((a) => a.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
      options(attrs.map((a) => a.name), value.v, Object.fromEntries(attrs.map((a) => [a.name, `${a.name} : ${a.type}`])))),
      h('button', { class: 'icon', title: 'New attribute for this property', 'aria-label': 'New attribute', onclick: () => newAttrFor(node, p, def) }, '+'));
  } else if (m === 'f') {
    const fields = ctx ? ctx.fields : [];
    editor = h('select', {
      'aria-label': `${p}: field`,
      'data-focus': `${focusKey}-field`,
      onchange: (e) => update((n) => { n.props[p].v = e.target.value; }),
    }, value.v && !fields.some((f) => f.name === value.v) ? h('option', { value: value.v, text: `${value.v} (missing)` }) : null,
    options(fields.map((f) => f.name), value.v));
  } else {
    editor = h('input', {
      value: value.v || '',
      'aria-label': `${p}: expression`,
      'data-focus': focusKey,
      spellcheck: 'false',
      placeholder: '{= ${/X} > 0 }',
      oninput: (e) => update((n) => { n.props[p] = { m: 'x', v: e.target.value }; }, { mergeKey: `p:${node.id}:${p}`, keepFocus: true }),
    });
  }
  return h('div', { class: `prop${isSet(value) ? ' set' : ''}`, 'data-prop': p, title: `${p} : ${def.type}${def.values ? ` (${def.values.join(', ')})` : ''}` },
    h('label', { text: p }), h('div', { class: 'val' }, editor), kind);
}

function newAttrFor(node, p, def) {
  commit((d) => { newAttributeFor(d, node.id, p, def); });
  toast('Attribute created on the Data tab');
}

// a property brought into view and focused - from a line of the Checks:
// the filter that would hide it is cleared, its group opened
export function focusProp(p) {
  if (state.inspector.filter || state.inspector.onlySet) {
    state.inspector.filter = '';
    state.inspector.onlySet = false;
    renderInspector();
  }
  const row = $('#inspector').querySelector(`.prop[data-prop="${CSS.escape(p)}"]`);
  if (!row) return;
  const g = row.closest('details');
  if (g) g.open = true;
  row.scrollIntoView({ block: 'center' });
  row.classList.add('flash');
  setTimeout(() => row.classList.remove('flash'), 1200);
  const ed = row.querySelector('.val input, .val select');
  if (ed) ed.focus();
}
