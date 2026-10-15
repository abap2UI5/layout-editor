// New, open, save, import and export: the dialogs and the files.
import { STARTERS } from '../starters.js';
import { fromXml, importReport } from '../xml.js';
import { clone, walk, normalizeDesign, validate, checkAttributeName } from '../model.js';
import { copyText } from './code.js';
import { fileName } from '../abap.js';
import { fromClass, classReport, classFiles, generateClassSource, sourceUrl, repoClassUrl } from '../clas.js';
import { playgroundLink, vscodeLink, PLAYGROUND_URL } from '../handoff.js';
import { zip } from '../zip.js';
import { state, commit, replaceDesign, showPanel, recentDesigns, designToLink } from './store.js';
import { $, h, toast, download, dialog } from './dom.js';
import { addControlByName } from './edit.js';

export function newDialog() {
  dialog('Start from a template', h('div', {},
    h('p', { class: 'hint', text: 'The current design is replaced - Undo brings it back.' }),
    h('div', { class: 'starters' }, STARTERS.map((s) => h('button', {
      class: 'starter',
      onclick: () => { replaceDesign(s.make()); $('#dlg').close(); toast(`New: ${s.title}`); },
    }, h('b', { text: s.title }), h('span', { text: s.text }))))), [{ text: 'Cancel', action: () => true }]);
}

// the designs New, Open, Import or a link replaced - back with one click
export function recentDialog() {
  const list = recentDesigns();
  const when = (t) => new Date(t).toLocaleString();
  dialog('Recent designs', list.length
    ? h('div', { class: 'starters' }, list.map((r) => h('button', {
      class: 'starter',
      onclick: () => {
        try { replaceDesign(normalizeDesign(JSON.parse(r.json))); $('#dlg').close(); toast(`Back to ${r.className}`); } catch (err) { toast(err.message); }
      },
    }, h('b', { text: r.className }), h('span', { text: r.description || ' ' }), h('span', { class: 'muted', text: when(r.at) }))))
    : h('p', { class: 'hint', text: 'Nothing yet - a design lands here when New, Open, Import or a shared link replaces it.' }),
  [{ text: 'Close', action: () => true }]);
}

// a link that carries the design - open it anywhere, the editor loads it
export async function shareLink() {
  try {
    const url = await designToLink(state.design);
    await copyText(url, 'Link');
  } catch (err) {
    toast(`No link: ${err.message}`);
  }
}

// a class name typed in, inserted at the selection
export function insertByNameDialog() {
  const inp = h('input', { placeholder: 'sap.m.Wizard', spellcheck: 'false', 'aria-label': 'Class name' });
  dialog('Insert a UI5 control by class name', h('div', {},
    h('p', { class: 'hint', text: 'The canvas asks its UI5 for the control; properties, aggregations and events come from there. Not checked against 1.71.' }),
    inp), [
    { text: 'Cancel', action: () => true },
    { text: 'Insert', primary: true, action: () => { addControlByName(inp.value.trim()); return true; } },
  ]);
  inp.focus();
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

// ------------------------------------------------------------- a class

export function openClassDialog() {
  const ta = h('textarea', { placeholder: 'CLASS zcl_my_app DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\n…', spellcheck: 'false', 'aria-label': 'ABAP class' });
  const url = h('input', { placeholder: 'https://raw.githubusercontent.com/owner/repo/main/src/zcl_my_app.clas.abap', spellcheck: 'false', 'aria-label': 'URL of the class' });
  dialog('Open an abap2UI5 app class', h('div', {},
    h('p', { class: 'hint', text: 'Paste the class, open a .clas.abap file, or give its URL on GitHub. Its view becomes the design, its public attributes the data, its events the event names - and the class keeps everything else: the export writes the view back into it.' }),
    ta,
    h('p', { class: 'hint', text: 'Or from GitHub (raw.githubusercontent.com, or the page of the file):' }),
    url), [
    { text: 'Cancel', action: () => true },
    { text: 'Open file…', action: () => { openFile('.abap'); return true; } },
    {
      text: 'Open', primary: true,
      action: () => {
        const text = ta.value.trim();
        if (!text && url.value.trim()) { $('#dlg').close(); fetchClass(url.value.trim()); return false; }
        try {
          $('#dlg').close(); // the import opens its summary in the same dialog
          importClassText(text);
          return false;
        } catch (err) {
          toast(err.message);
          return false;
        }
      },
    },
  ]);
  ta.focus();
}

// ?src=<url> or ?class=<name>&repo=<owner/repo>: the class replaces the
// design, the address stays clean (the ?ui5 of the tests included)
export function openClassFromUrl(params) {
  let url = params.get('src');
  try {
    if (!url && params.get('class') && params.get('repo')) url = repoClassUrl(params.get('class'), params.get('repo'), params.get('ref') || 'main', params.get('path') || 'src');
  } catch (err) {
    toast(err.message);
  }
  if (!url) return;
  for (const k of ['src', 'class', 'repo', 'ref', 'path']) params.delete(k);
  const q = params.toString();
  history.replaceState(null, '', `${location.pathname}${q ? `?${q}` : ''}${location.hash}`);
  fetchClass(url);
}

async function fetchClass(raw) {
  try {
    const href = sourceUrl(raw, location.href);
    const res = await fetch(href, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${href} answered ${res.status}`);
    const text = await res.text();
    if (!/^\s*(?:"|\*|CLASS\b)/im.test(text)) throw new Error(`${href} is not an ABAP class`);
    importClassText(text);
  } catch (err) {
    toast(`Cannot open the class: ${err.message}`);
  }
}

function importClassText(text) {
  if (!text) throw new Error('Nothing to open');
  const d = fromClass(text, clone(state.design));
  replaceDesign(d);
  const r = classReport();
  const lines = [];
  const seen = `${d.attributes.length} attribute(s), ${r.unknown.length ? 'controls the palette does not know kept as imported: ' + r.unknown.join(', ') : 'every control in the palette'}`;
  lines.push(seen);
  if (r.kept.length) lines.push(`Kept as ABAP - ${r.kept.length} attribute(s) the editor has no field for, written back into the view as they are (set one in the editor to replace it): ${r.kept.map((x) => `${x.control}.${x.attr} = ${x.abap}`).join('; ')}`);
  if (r.dropped.length) lines.push(`Could not import - ${r.dropped.length} attribute(s) of the View, which the editor writes itself: ${r.dropped.map((x) => `${x.attr} = ${x.abap}`).join('; ')}`);
  if (r.skipped.length) lines.push(`Public attributes of a type the Data tab has not, left to the class: ${r.skipped.map((x) => `${x.name} (${x.type})`).join(', ')}`);
  if (r.seeds.length) lines.push(`Sample data not read: ${r.seeds.join('; ')}`);
  if (r.handlers.length) lines.push(`${r.handlers.length} event handler(s) dropped: ${[...new Set(r.handlers)].join(', ')}`);
  if (r.expressions) lines.push(`${r.expressions} binding(s) kept as UI5 expressions (ƒx)`);
  const body = h('div', {}, lines.map((t) => h('p', { text: t })));
  const buttons = [{ text: 'OK', primary: !r.unresolved.length, action: () => true }];
  if (r.unresolved.length) {
    body.append(h('p', {}, h('b', { text: `${r.unresolved.length} binding(s) name no public attribute: ` }), r.unresolved.map((u) => `{/${u.path}}`).join(', ')));
    buttons.unshift({ text: `Create ${r.unresolved.length} attribute(s)`, primary: true, action: () => { createImportedAttributes(r.unresolved); return true; } });
  }
  dialog(`Opened ${d.className}`, body, buttons);
}

// ------------------------------------------------------------- hand-off

function classFile() {
  return { name: fileName(state.design.className, 'clas.abap'), source: generateClassSource(state.design) };
}

// the playground's base URL: ?playground=<url> once, remembered
export function playgroundBase() {
  return state.prefs.playground || PLAYGROUND_URL;
}

export async function openInPlayground() {
  try {
    const f = classFile();
    window.open(await playgroundLink(f.name, f.source, playgroundBase()), '_blank', 'noopener');
  } catch (err) {
    toast(`No playground link: ${err.message}`);
  }
}

export async function openInVscode() {
  try {
    const f = classFile();
    const href = await vscodeLink(f.name, f.source);
    location.assign(href);
    toast('Opening in VS Code - the abap2UI5 extension takes the class', { label: 'Copy link', run: () => copyText(href, 'Link') });
  } catch (err) {
    toast(`No VS Code link: ${err.message}`);
  }
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
      } else if (/\.abap$/i.test(f.name) || /^\s*(?:"|\*|CLASS\b)/im.test(text)) {
        importClassText(text);
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
  const bytes = zip(classFiles(d));
  download(`${d.className.toLowerCase().replace(/\//g, '#')}.zip`, new Blob([bytes], { type: 'application/zip' }));
  toast('Exported - abapGit: New Offline, Import ZIP');
}
