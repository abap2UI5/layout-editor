// The Data panel: the attributes of the class with their sample values,
// and the Checks panel.
import { walk, rowContext, attributeUsage, renameAttribute, validate, checkAttributeName, checkFieldName, SCALAR_TYPES, ATTRIBUTE_TYPES } from '../model.js';
import { state, commit, select } from './store.js';
import { $, h, options, toast, rememberFocus, restoreFocus } from './dom.js';


export function renderData() {
  const box = $('#dataPanel');
  const focus = rememberFocus(box);
  box.replaceChildren();
  const d = state.design;
  box.append(h('p', { class: 'hint', text: 'Public attributes of the class, bound with client->_bind( ). The values seed model_init and the canvas.' }));
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
      if (uses && !confirm(`${a.name} is bound ${uses} time(s). Delete it anyway? The bindings stay and show up under Checks.`)) return;
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
    card.append(h('div', { class: 'hint', style: 'margin:8px 0 0', text: 'Sample rows - they seed model_init and the canvas' }),
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


export function renderIssues() {
  const issues = validate(state.design);
  const box = $('#issuesPanel');
  box.replaceChildren();
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const badge = $('#issueCount');
  badge.textContent = String(errors || warns);
  badge.classList.toggle('hidden', !(errors || warns));
  badge.classList.toggle('warn', !errors);
  if (!issues.length) box.append(h('div', { class: 'empty', text: 'All clear - the class is ready to export.' }));
  for (const i of issues) {
    box.append(h('div', { class: `issue ${i.level}`, onclick: () => { if (i.node) select(i.node); } },
      h('span', { class: 'lvl', text: i.level === 'error' ? '✕' : i.level === 'warning' ? '!' : 'i' }), h('span', { text: i.text })));
  }
  $('#btnZip').title = errors ? `${errors} problem(s) - the class may not activate. See Checks.` : "The class with its abapGit files - abapGit: New Offline, Import ZIP";
  return issues;
}
