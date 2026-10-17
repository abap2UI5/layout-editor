// The Data panel: the attributes of the class with their sample values,
// and the Checks panel.
import {
  walk, findNode, rowContext, attributeUsage, renameAttribute, validate, checkAttributeName, checkFieldName, ATTRIBUTE_TYPES,
  moveItem, parseSampleRows, bindListToTable,
} from '../model.js';
import { getControl } from '../catalog.js';
import { state, commit, select } from './store.js';
import { $, h, options, toast, choose, dialog, rememberFocus, restoreFocus } from './dom.js';
import { newTableAttribute, newAttributeFor } from './edit.js';
import { focusProp } from './inspector.js';


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
    onclick: async () => {
      if (uses && !await choose(`Delete ${a.name}?`, `${a.name} is bound ${uses} time(s). The bindings stay and show up under Checks.`, [
        { text: 'Cancel', value: false }, { text: 'Delete', value: true, primary: true },
      ])) return;
      commit((dd) => { dd.attributes.splice(idx, 1); });
    },
  }, '✕');
  // the order of the attributes is the order of their declarations
  const last = d.attributes.length - 1;
  const card = h('div', { class: 'attr' }, h('div', { class: 'attr-head' }, nameIn, typeSel,
    moveButtons('attribute', idx, last, (delta) => commit((dd) => { moveItem(dd.attributes, idx, delta); })), del));
  if (uses) card.append(h('div', { class: 'uses', text: `bound ${uses}×` }));
  if (a.type !== 'table') {
    card.append(h('div', { class: 'avalue' }, h('span', { class: 'hint', style: 'margin:0', text: 'Value' }), scalarInput(a.type, a.value, (v) => upd((at) => { at.value = v; }, `a${idx}-v`), `a${idx}-v`)));
  } else {
    // `fieldPath`: the names of the table fields down to this list of
    // fields - the fields of a table field are edited under it
    const fieldsAt = (at, fieldPath) => fieldPath.reduce((fields, name) => fields.find((f) => f.name === name).fields, at.fields);
    const fieldsEditor = (fieldList, fieldPath) => {
      const key = `a${idx}-${fieldPath.join('.')}`;
      const box = h('div', { class: fieldPath.length ? 'subfields' : 'fields' },
        fieldPath.length ? null : h('div', { class: 'hint', style: 'margin:0 0 4px', text: 'Fields - a field of type table has fields of its own (the nodes of a tree, a list in a list)' }));
      fieldList.forEach((f, fi) => {
        box.append(h('div', { class: 'frow' },
          h('input', {
            value: f.name, spellcheck: 'false', 'aria-label': 'Field name', 'data-focus': `${key}-f${fi}`,
            onchange: (e) => {
              const v = e.target.value.trim().toUpperCase();
              const err = checkFieldName(v) || (fieldList.some((x, j) => j !== fi && x.name === v) ? 'Name is taken' : null);
              if (err) { e.target.classList.add('invalid'); toast(err); return; }
              commit((dd) => renameField(dd, idx, fieldPath, fi, v));
            },
          }),
          h('select', {
            'aria-label': 'Field type',
            onchange: (e) => commit((dd) => {
              const fld = fieldsAt(dd.attributes[idx], fieldPath)[fi];
              const was = fld.type;
              fld.type = e.target.value;
              if (fld.type === 'table') { fld.fields = fld.fields && fld.fields.length ? fld.fields : [{ name: 'TEXT', type: 'string' }]; } else delete fld.fields;
              // the sample rows follow: a table field holds rows, a scalar
              // field a value - a value left of the other kind would reach
              // the class and the canvas as it is
              if ((was === 'table') !== (fld.type === 'table')) {
                for (const r of rowsOfLevel(dd.attributes[idx].rows, fieldPath)) {
                  if (fld.type === 'table') r[fld.name] = []; else delete r[fld.name];
                }
              }
            }),
          }, options(ATTRIBUTE_TYPES, f.type)),
          moveButtons('field', fi, fieldList.length - 1, (delta) => commit((dd) => { moveItem(fieldsAt(dd.attributes[idx], fieldPath), fi, delta); })),
          h('button', { class: 'icon danger', 'aria-label': 'Delete field', title: 'Delete field', onclick: () => commit((dd) => { fieldsAt(dd.attributes[idx], fieldPath).splice(fi, 1); }) }, '✕')));
        if (f.type === 'table') box.append(fieldsEditor(f.fields || [], [...fieldPath, f.name]));
      });
      box.append(h('button', {
        onclick: () => commit((dd) => {
          const list = fieldsAt(dd.attributes[idx], fieldPath);
          let i = list.length + 1;
          while (list.some((f) => f.name === `FIELD${i}`)) i++;
          list.push({ name: `FIELD${i}`, type: 'string' });
        }),
      }, '+ Field'));
      return box;
    };
    card.append(fieldsEditor(a.fields, []));

    // the rows, and under a row the rows of its table fields
    const rowsAt = (at, rowPath) => rowPath.reduce((rows, [name, i]) => (rows[i][name] = rows[i][name] || []), at.rows);
    const rowsTable = (fieldList, rows, rowPath) => {
      const key = `a${idx}-${rowPath.map(([n, i]) => `${n}${i}`).join('.')}`;
      const table = h('table', { class: 'rows' }, h('tr', {}, fieldList.map((f) => h('th', { text: f.name })), h('th')));
      (rows || []).forEach((r, ri) => {
        table.append(h('tr', {}, fieldList.map((f) => (f.type === 'table'
          ? h('td', { class: 'nested' },
            h('div', { class: 'nested-rows' }, rowsTable(f.fields || [], r[f.name], [...rowPath, [f.name, ri]]),
              h('button', { style: 'margin-top:4px', onclick: () => commit((dd) => { rowsAt(dd.attributes[idx], [...rowPath, [f.name, ri]]).push({}); }) }, `+ ${f.name} row`)))
          : h('td', {}, scalarInput(f.type, r[f.name], (v) => upd((at) => { rowsAt(at, rowPath)[ri][f.name] = v; }, `${key}-r${ri}-${f.name}`), `${key}-r${ri}-${f.name}`)))),
        h('td', {}, h('button', { class: 'icon danger', 'aria-label': 'Delete row', title: 'Delete row', onclick: () => commit((dd) => { rowsAt(dd.attributes[idx], rowPath).splice(ri, 1); }) }, '✕'))));
      });
      return table;
    };
    card.append(h('div', { class: 'hint', style: 'margin:8px 0 0', text: 'Sample rows - they seed model_init and the canvas' }),
      h('div', { class: 'rows-wrap' }, rowsTable(a.fields, a.rows, [])),
      h('div', { class: 'add-row', style: 'margin-top:6px' },
        h('button', { onclick: () => commit((dd) => { (dd.attributes[idx].rows = dd.attributes[idx].rows || []).push({}); }) }, '+ Row'),
        h('button', { title: 'Rows copied from a spreadsheet, or CSV', onclick: () => pasteRowsDialog(idx) }, 'Paste rows…')));
  }
  return card;
}

// ↑ and ↓ of an entry of a list
function moveButtons(what, i, last, move) {
  return h('span', { class: 'move' },
    h('button', { class: 'icon', title: `Move ${what} up`, 'aria-label': `Move ${what} up`, disabled: i === 0 ? 'disabled' : null, onclick: () => move(-1) }, '↑'),
    h('button', { class: 'icon', title: `Move ${what} down`, 'aria-label': `Move ${what} down`, disabled: i === last ? 'disabled' : null, onclick: () => move(1) }, '↓'));
}

// rows from a spreadsheet or a CSV, into the sample rows of a table
function pasteRowsDialog(idx) {
  const at = state.design.attributes[idx];
  const ta = h('textarea', { placeholder: at.fields.filter((f) => f.type !== 'table').map((f) => f.name).join('\t'), spellcheck: 'false', 'aria-label': 'Rows' });
  const head = h('input', { type: 'checkbox', checked: true });
  const mode = h('select', { 'aria-label': 'Replace or append' }, options(['replace', 'append'], 'replace', { replace: 'Replace the rows', append: 'Append to the rows' }));
  dialog(`Paste rows into ${at.name}`, h('div', {},
    h('p', { class: 'hint', text: 'Copy cells from a spreadsheet, or paste CSV. With a header line, the columns go to the fields of the same name, and a name the table has not becomes a new field; without one, they fill the fields in their order.' }),
    ta,
    h('div', { class: 'add-row' }, h('label', {}, head, ' First line names the fields'), mode)), [
    { text: 'Cancel', action: () => true },
    {
      text: 'Paste', primary: true,
      action: () => {
        const r = parseSampleRows(ta.value, at.fields, head.checked);
        if (!r.rows.length) { toast('No rows in the text'); return false; }
        commit((d) => {
          const t = d.attributes[idx];
          t.fields.push(...r.added);
          t.rows = mode.value === 'append' ? [...(t.rows || []), ...r.rows] : r.rows;
        });
        toast(`${r.rows.length} row(s) pasted${r.added.length ? `, new field(s) ${r.added.map((f) => f.name).join(', ')}` : ''}${r.ignored ? ` - ${r.ignored} cell(s) had no field` : ''}`);
        return true;
      },
    },
  ]);
  ta.focus();
}

// every row at the depth of a list of fields: the rows of the table, or
// of the table field `fieldPath` down, in every row above it
function rowsOfLevel(rows, fieldPath) {
  return fieldPath.reduce((level, name) => level.flatMap((r) => (Array.isArray(r[name]) ? r[name] : [])), rows || []);
}

// rename a field - of the table, or of a table field `fieldPath` down -
// in its rows and in every binding that names it in that context
function renameField(d, idx, fieldPath, fi, to) {
  const at = d.attributes[idx];
  const list = fieldPath.reduce((fields, name) => fields.find((f) => f.name === name).fields, at.fields);
  const from = list[fi].name;
  list[fi].name = to;
  const renameRows = (rows, depth) => {
    for (const r of rows || []) {
      if (depth === fieldPath.length) { if (from in r) { r[to] = r[from]; delete r[from]; } } else renameRows(r[fieldPath[depth]], depth + 1);
    }
  };
  renameRows(at.rows, 0);
  const ctxFields = list;
  walk(d.root, (n) => {
    for (const v of Object.values(n.props || {})) {
      if (v && v.m === 'f' && v.v === from) {
        const ctx = rowContext(d, n.id);
        if (ctx && ctx.fields === ctxFields) v.v = to;
      }
      if (v && v.m === 'b' && v.v === at.name && v.arr === from && !fieldPath.length) v.arr = to;
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


// A quick fix from the Checks: what validate( ) proposes, done
function applyFix(fix) {
  if (fix.kind === 'createAttribute') {
    commit((d) => {
      if (d.attributes.some((a) => a.name === fix.name)) return;
      d.attributes.push(fix.type === 'table'
        ? { name: fix.name, type: 'table', fields: [{ name: 'TEXT', type: 'string' }], rows: [{ TEXT: 'Row 1' }] }
        : { name: fix.name, type: fix.type, value: fix.type === 'bool' ? false : '' });
    });
  } else if (fix.kind === 'removeAttribute') {
    commit((d) => { d.attributes = d.attributes.filter((a) => a.name !== fix.name); });
  } else if (fix.kind === 'resetProp') {
    commit((d) => { delete findNode(d.root, fix.node).node.props[fix.prop]; });
  } else if (fix.kind === 'template') {
    commit((d) => {
      const n = findNode(d.root, fix.node).node;
      const items = n.aggs[fix.agg] || [];
      const b = n.props[fix.agg];
      // more than one: the first is the template; none: built from the fields
      if (items.length > 1) n.aggs[fix.agg] = items.slice(0, 1);
      else bindListToTable(d, n.id, fix.agg, b.v, true, b.m === 'f');
      return n.id;
    });
  } else if (fix.kind === 'nodesTable') {
    commit((d) => {
      bindListToTable(d, fix.node, fix.agg, newTableAttribute(d, true));
      return fix.node;
    });
  } else if (fix.kind === 'bindNew') {
    commit((d) => {
      const n = findNode(d.root, fix.node).node;
      const c = getControl(n.type);
      newAttributeFor(d, n.id, fix.prop, c && c.props && c.props[fix.prop]);
      return n.id;
    });
  }
}

export function renderIssues() {
  const issues = validate(state.design);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warning').length;
  const badge = $('#issueCount');
  badge.textContent = String(errors || warns);
  badge.classList.toggle('hidden', !(errors || warns));
  badge.classList.toggle('warn', !errors);
  $('#btnZip').title = errors ? `${errors} problem(s) - the class may not activate. See Checks.` : "The class with its abapGit files - abapGit: New Offline, Import ZIP";
  // the list itself only while the tab is open
  if (state.panel !== 'issues') return issues;
  const box = $('#issuesPanel');
  box.replaceChildren();
  if (!issues.length) box.append(h('div', { class: 'empty', text: 'All clear - the class is ready to export.' }));
  for (const i of issues) {
    box.append(h('div', {
      class: `issue ${i.level}${i.node ? ' at' : ''}`,
      onclick: () => {
        if (!i.node) return;
        select(i.node);
        // the property the line is about, in view and focused
        if (i.prop) focusProp(i.prop);
      },
    },
    h('span', { class: 'lvl', text: i.level === 'error' ? '✕' : i.level === 'warning' ? '!' : 'i' }), h('span', { class: 'itext', text: i.text }),
    i.fix ? h('button', { class: 'fix', onclick: (e) => { e.stopPropagation(); applyFix(i.fix); } }, i.fix.label) : null));
  }
  return issues;
}
