// New, open, save, import and export: the dialogs and the files.
import { STARTERS } from '../starters.js';
import { fromXml, importReport } from '../xml.js';
import { clone, walk, normalizeDesign, validate, checkAttributeName } from '../model.js';
import { abapGitFiles } from '../abap.js';
import { zip } from '../zip.js';
import { state, commit, replaceDesign, showPanel } from './store.js';
import { $, h, toast, download, dialog } from './dom.js';

export function newDialog() {
  dialog('Start from a template', h('div', {},
    h('p', { class: 'hint', text: 'The current design is replaced - Undo brings it back.' }),
    h('div', { class: 'starters' }, STARTERS.map((s) => h('button', {
      class: 'starter',
      onclick: () => { replaceDesign(s.make()); $('#dlg').close(); toast(`New: ${s.title}`); },
    }, h('b', { text: s.title }), h('span', { text: s.text }))))), [{ text: 'Cancel', action: () => true }]);
}

export function importDialog() {
  const ta = h('textarea', { placeholder: '<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">…</mvc:View>', spellcheck: 'false' });
  dialog('Import a UI5 XML view', h('div', {},
    h('p', { class: 'hint', text: 'Paste a view or open a .xml file. Bindings come in as expressions; event handlers are dropped, because abap2UI5 events are names, not controller methods. The data attributes stay.' }),
    ta), [
    { text: 'Cancel', action: () => true },
    { text: 'Open file…', action: () => { openFile('.xml'); return true; } },
    {
      text: 'Import', primary: true,
      action: () => {
        try {
          const text = ta.value;
          $('#dlg').close(); // the import opens its summary in the same dialog
          importXmlText(text);
          return false; // closed above - the summary may be open now
        } catch (err) {
          toast(err.message);
          return false;
        }
      },
    },
  ]);
}

function importXmlText(text) {
  replaceDesign(fromXml(text, clone(state.design)));
  const r = importReport();
  const lines = [];
  if (r.handlers.length) lines.push(`${r.handlers.length} event handler(s) dropped - abap2UI5 events are names: ${[...new Set(r.handlers)].slice(0, 6).join(', ')}${r.handlers.length > 6 ? ', …' : ''}`);
  if (r.ids) lines.push(`${r.ids} id(s) dropped - the class needs none`);
  if (r.unknown.length) lines.push(`Not in the palette, kept as imported: ${r.unknown.join(', ')}`);
  if (r.expressions) lines.push(`${r.expressions} binding(s) kept as UI5 expressions (ƒx)`);
  if (!lines.length && !r.unresolved.length) { toast('View imported'); return; }
  const body = h('div', {}, lines.map((t) => h('p', { text: t })));
  const buttons = [{ text: 'OK', primary: !r.unresolved.length, action: () => true }];
  if (r.unresolved.length) {
    body.append(h('p', {}, h('b', { text: `${r.unresolved.length} binding(s) name no attribute of the class: ` }), r.unresolved.map((u) => `{/${u.path}}`).join(', ')));
    buttons.unshift({
      text: `Create ${r.unresolved.length} attribute(s)`, primary: true,
      action: () => { createImportedAttributes(r.unresolved); return true; },
    });
  }
  dialog('View imported', body, buttons);
}

// the attributes an import asked for: a string per {/NAME}, a table with
// one field per {/NAME} that repeats rows - and the expressions that named
// them become bindings
function createImportedAttributes(unresolved) {
  commit((d) => {
    for (const u of unresolved) {
      let name = u.path.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, 'a');
      if (u.agg && !name.startsWith('t_')) name = `t_${name}`;
      let i = 1;
      const base = name;
      while (d.attributes.some((a) => a.name === name) || checkAttributeName(name)) name = `${base}${++i}`;
      d.attributes.push(u.agg
        ? { name, type: 'table', fields: [{ name: 'TEXT', type: 'string' }], rows: [{ TEXT: 'Row 1' }] }
        : { name, type: 'string', value: '' });
      const re = new RegExp(`^\\{\\s*/${u.path}\\s*\\}$`);
      walk(d.root, (n) => {
        for (const [p, v] of Object.entries(n.props)) if (v.m === 'x' && re.test(v.v)) n.props[p] = { m: 'b', v: name };
        return true;
      });
    }
  });
  showPanel('data');
  toast('Attributes created - edit them on the Data tab');
}

export function openFile(accept) {
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
        replaceDesign(normalizeDesign(JSON.parse(text)));
        toast(`Opened ${f.name}`);
      }
    } catch (err) {
      toast(`Cannot open ${f.name}: ${err.message}`);
    }
  };
  inp.click();
}

export function saveDesign() {
  download(`${state.design.className.toLowerCase().replace(/\//g, '#')}.design.json`, JSON.stringify(state.design, null, 1), 'application/json');
  toast('Design saved');
}


export function exportZip() {
  const d = state.design;
  const errors = validate(d).filter((i) => i.level === 'error');
  if (errors.length && !confirm(`${errors.length} problem(s) - the class may not activate:\n\n${errors.slice(0, 5).map((e) => '• ' + e.text).join('\n')}\n\nExport anyway?`)) return;
  const bytes = zip(abapGitFiles(d));
  download(`${d.className.toLowerCase().replace(/\//g, '#')}.zip`, new Blob([bytes], { type: 'application/zip' }));
  toast('Exported - abapGit: New Offline, Import ZIP');
}
