// New, open, save, import and export: the dialogs and the files.
import { STARTERS } from '../starters.js';
import { fromXml, importReport } from '../xml.js';
import { clone, walk, normalizeDesign, validate, checkAttributeName } from '../model.js';
import { copyText } from './code.js';
import { fileName } from '../abap.js';
import { fromClass, classReport, classFiles, generateClassSource, sourceUrl, repoClassUrl } from '../clas.js';
import { playgroundLink, vscodeLink, PLAYGROUND_URL } from '../handoff.js';
import { zip } from '../zip.js';
import { state, commit, replaceDesign, showPanel, recentDesigns, designToLink, libraryDesigns, saveToLibrary, removeFromLibrary } from './store.js';
import { $, h, toast, toastError, download, dialog, choose } from './dom.js';
import { addControlByName } from './edit.js';

export function newDialog() {
  dialog('Start from a template', h('div', {},
    h('p', { class: 'hint', text: 'The current design is replaced - Undo brings it back.' }),
    h('div', { class: 'starters' }, STARTERS.map((s) => h('button', {
      class: 'starter',
      onclick: () => { replaceDesign(s.make()); $('#dlg').close(); toast(`New: ${s.title}`); },
    }, h('b', { text: s.title }), h('span', { text: s.text }))))), [{ text: 'Cancel', action: () => true }]);
}

// The designs of this browser: those saved under their class name, and
// those New, Open, Import or a link replaced - back with one click
export function recentDialog() {
  const when = (t) => new Date(t).toLocaleString();
  const open = (r, what) => {
    try { replaceDesign(normalizeDesign(JSON.parse(r.json))); $('#dlg').close(); toast(`${what} ${r.className}`); } catch (err) { toastError(err.message); }
  };
  const render = () => {
    const saved = libraryDesigns();
    const recent = recentDesigns();
    const card = (r, what, extra) => h('div', { class: 'starter-wrap' },
      h('button', { class: 'starter', onclick: () => open(r, what) },
        h('b', { text: r.className }), h('span', { text: r.description || ' ' }), h('span', { class: 'muted', text: when(r.at) })),
      extra || null);
    return h('div', {},
      h('h3', { class: 'dlg-sub', text: 'Saved in this browser' }),
      saved.length
        ? h('div', { class: 'starters' }, saved.map((r) => card(r, 'Opened', h('button', {
          class: 'icon danger remove', title: `Remove ${r.className} from this browser`, 'aria-label': `Remove ${r.className}`,
          onclick: async () => {
            const ok = await choose(`Remove ${r.className}?`, 'The design is removed from this browser. A file saved with Save design (.json) stays.', [
              { text: 'Cancel', value: false }, { text: 'Remove', value: true, primary: true },
            ]);
            if (ok) removeFromLibrary(r.className);
            recentDialog();
          },
        }, '✕'))))
        : h('p', { class: 'hint', text: 'Nothing yet - File, Save in browser keeps the open design here under its class name.' }),
      h('h3', { class: 'dlg-sub', text: 'Recent - replaced by New, Open, Import or a link' }),
      recent.length
        ? h('div', { class: 'starters' }, recent.map((r) => card(r, 'Back to')))
        : h('p', { class: 'hint', text: 'Nothing yet - a design lands here when New, Open, Import or a shared link replaces it.' }));
  };
  dialog('Designs in this browser', render(), [{ text: 'Close', action: () => true }]);
}

export function saveToBrowser() {
  try {
    const had = saveToLibrary(state.design);
    toast(`${state.design.className} ${had ? 'updated' : 'saved'} in this browser`, { label: 'Show all', run: recentDialog });
  } catch (err) {
    toastError(`Not saved in this browser: ${err.message}`);
  }
}

// a link that carries the design - open it anywhere, the editor loads it;
// a link longer than some browsers, chats and mail take says so
const LONG_LINK = 8000;
export async function shareLink() {
  try {
    const url = await designToLink(state.design);
    const copied = await copyText(url, 'Link');
    if (copied && url.length > LONG_LINK) {
      toast(`Link copied - ${Math.round(url.length / 1000)} kB long; some chats and mail cut such links. A file is safer.`, { label: 'Save .json', run: saveDesign });
    }
  } catch (err) {
    toastError(`No link: ${err.message}`);
  }
}

// a class name typed in, inserted at the selection
export function insertByNameDialog() {
  const inp = h('input', {
    placeholder: 'sap.m.Wizard', spellcheck: 'false', 'aria-label': 'Class name',
    onkeydown: (e) => { if (e.key === 'Enter' && inp.value.trim()) { e.preventDefault(); $('#dlg').close(); addControlByName(inp.value.trim()); } },
  });
  dialog('Insert a UI5 control by class name', h('div', {},
    h('p', { class: 'hint', text: 'The canvas asks its UI5 for the control; properties, aggregations and events come from there. Not checked against 1.71.' }),
    inp), [
    { text: 'Cancel', action: () => true },
    { text: 'Insert', primary: true, action: () => { if (inp.value.trim()) addControlByName(inp.value.trim()); return true; } },
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
          // the dialog closes only once the view is read: a view that does
          // not parse leaves the pasted text where it is, to be fixed
          importXmlText(ta.value, () => $('#dlg').close());
        } catch (err) {
          toast(err.message);
        }
        return false; // closed above - the summary may be open now
      },
    },
  ]);
}

// `before`: runs once the text is read and before the design is replaced
// (the dialog it came from closes, so the summary can open in its place)
function importXmlText(text, before) {
  if (!text.trim()) throw new Error('Nothing to import');
  const d = fromXml(text, clone(state.design));
  if (before) before();
  replaceDesign(d);
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
      // room for a number: a name of 30 characters, or one the class
      // takes, would otherwise never become a free one
      const base = name.slice(0, 27);
      if (name.length > 30) name = base;
      let i = 1;
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
  const url = h('input', {
    placeholder: 'https://raw.githubusercontent.com/owner/repo/main/src/zcl_my_app.clas.abap', spellcheck: 'false', 'aria-label': 'URL of the class',
    onkeydown: (e) => { if (e.key === 'Enter' && url.value.trim() && !ta.value.trim()) { e.preventDefault(); $('#dlg').close(); fetchClass(url.value.trim()); } },
  });
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
          importClassText(text, () => $('#dlg').close());
        } catch (err) {
          toast(err.message);
        }
        return false; // closed above - the summary may be open now
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
    toast(`Opening ${href.split('/').pop()}…`);
    const res = await fetch(href, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`${href} answered ${res.status}`);
    const text = await res.text();
    if (!/^\s*(?:"|\*|CLASS\b)/im.test(text)) throw new Error(`${href} is not an ABAP class`);
    importClassText(text);
  } catch (err) {
    toastError(`Cannot open the class: ${err.message}`);
  }
}

function importClassText(text, before) {
  if (!text) throw new Error('Nothing to open');
  const d = fromClass(text, clone(state.design));
  if (before) before();
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
    toastError(`No playground link: ${err.message}`);
  }
}

export async function openInVscode() {
  try {
    const f = classFile();
    const href = await vscodeLink(f.name, f.source);
    location.assign(href);
    toast('Opening in VS Code - the abap2UI5 extension takes the class', { label: 'Copy link', run: () => copyText(href, 'Link') });
  } catch (err) {
    toastError(`No VS Code link: ${err.message}`);
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
      // a design is JSON - checked first: its indented lines start with a
      // quote, which would read as an ABAP comment
      if (/\.json$/i.test(f.name) || /^\s*\{/.test(text)) {
        replaceDesign(normalizeDesign(JSON.parse(text)));
        toast(`Opened ${f.name}`);
      } else if (/\.xml$/i.test(f.name) || /^\s*</.test(text)) {
        importXmlText(text);
      } else if (/\.abap$/i.test(f.name) || /^\s*(?:"|\*|CLASS\b)/im.test(text)) {
        importClassText(text);
      } else {
        throw new Error('not a design (.json), a view (.xml) or a class (.abap)');
      }
    } catch (err) {
      toastError(`Cannot open ${f.name}: ${err.message}`);
    }
  };
  inp.click();
}

export function saveDesign() {
  download(`${state.design.className.toLowerCase().replace(/\//g, '#')}.design.json`, JSON.stringify(state.design, null, 1), 'application/json');
  toast('Design saved');
}


export async function exportZip() {
  const d = state.design;
  const errors = validate(d).filter((i) => i.level === 'error');
  if (errors.length) {
    const go = await choose(`${errors.length} problem(s) - the class may not activate`, [
      h('ul', {}, errors.slice(0, 5).map((e) => h('li', { text: e.text }))),
      errors.length > 5 ? `… and ${errors.length - 5} more under Checks.` : '',
    ].filter(Boolean), [
      { text: 'Show the checks', value: 'checks' },
      { text: 'Export anyway', value: 'export', primary: true },
    ]);
    if (go === 'checks') showPanel('issues');
    if (go !== 'export') return;
  }
  const bytes = zip(classFiles(d));
  download(`${d.className.toLowerCase().replace(/\//g, '#')}.zip`, new Blob([bytes], { type: 'application/zip' }));
  toast('Exported - abapGit: New Offline, Import ZIP');
}
