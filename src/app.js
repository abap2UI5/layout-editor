// The layout editor UI, after the pattern of the SAP Web IDE layout editor
// and styled after SAP Fiori Horizon. One idea of its own shapes it: the
// class is the product, so the code is never hidden - canvas and class sit
// side by side, a control and its lines in the chain are selected together.
//
// Left: controls, outline, data and checks as tabs. Middle: the canvas (real
// UI5 in a frame) and the class. Right: the properties. All state is the
// design document (model.js) in src/ui/store.js; every edit goes through
// commit( ), which records undo, saves to localStorage and tells this
// module, which renders the panels (src/ui/*.js).
import { validate, checkClassName } from './model.js';
import { generateClass, fileName } from './abap.js';
import { generateClassSource } from './clas.js';
import { toXml } from './xml.js';
import { state, on, loadPrefs, savePrefs, loadDesign, designFromLink, replaceDesign, commit, undo, redo, select, showPanel, labelOfSelection } from './ui/store.js';
import { $, toast, download } from './ui/dom.js';
import { renderInsert, renderInsertTarget } from './ui/insert.js';
import { renderLayers, onLayersKey, clearDropMarks, renderCrumbs } from './ui/layers.js';
import { renderInspector } from './ui/inspector.js';
import { renderData, renderIssues } from './ui/data.js';
import { renderCode, highlightCode, setCode, setView, copyText } from './ui/code.js';
import { loadPreview, postPreview, sendPreview } from './ui/preview.js';
import { handleDrop, copySelection, pasteSelection, addControlByName } from './ui/edit.js';
import { openPalette } from './ui/palette.js';
import { newDialog, importDialog, openClassDialog, openClassFromUrl, recentDialog, shareLink, openFile, saveDesign, exportZip, openInPlayground, openInVscode } from './ui/files.js';
import { onKey } from './ui/keys.js';


// every menu closes the others when it opens - and says so to a screen reader
const menus = [];
function wireMenu(button, menu) {
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  menus.push(close);
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    for (const c of menus) c();
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', close);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  // Escape closes the menu and gives the focus back to its button
  const onEscape = (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); close(); button.focus(); } };
  menu.addEventListener('keydown', onEscape);
  button.addEventListener('keydown', onEscape);
}


function applyWidths() {
  const ws = $('.workspace');
  for (const [key, prop] of [['drawerW', '--drawer-w'], ['inspectorW', '--inspector-w']]) {
    if (state.prefs[key]) ws.style.setProperty(prop, `${state.prefs[key]}px`); else ws.style.removeProperty(prop);
  }
}

function wireResizer(handle, pane, min, max) {
  if (!handle) return;
  const key = `${pane}W`;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const start = e.clientX;
    const from = state.prefs[key] || (pane === 'drawer' ? 280 : 320);
    const move = (ev) => {
      const delta = pane === 'drawer' ? ev.clientX - start : start - ev.clientX;
      state.prefs[key] = Math.round(Math.max(min, Math.min(max, from + delta)));
      applyWidths();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      savePrefs();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('dblclick', () => { delete state.prefs[key]; applyWidths(); savePrefs(); });
}


// Every change renders once per frame: a burst of edits (a paste of many
// nodes, typing) is one pass over the panels; the focus is kept only when
// every edit of the burst asked for it
let pendingRender = null;
function scheduleRender(opts = {}) {
  if (pendingRender) { pendingRender.keepFocus = pendingRender.keepFocus && !!opts.keepFocus; return; }
  pendingRender = { keepFocus: !!opts.keepFocus };
  requestAnimationFrame(() => { const o = pendingRender; pendingRender = null; renderAll(o); });
}

function renderAll(opts = {}) {
  const d = state.design;
  const cn = $('#className');
  if (document.activeElement !== cn) cn.value = d.className;
  cn.classList.toggle('invalid', !!checkClassName(d.className));
  if (document.activeElement !== $('#description')) $('#description').value = d.description || '';
  $('#abapRelease').value = d.release || '';
  renderLayers();
  // keep the input being typed into: re-rendering its panel would drop it
  if (!opts.keepFocus || !$('#inspector').contains(document.activeElement)) renderInspector();
  if (!opts.keepFocus || !$('#dataPanel').contains(document.activeElement)) renderData();
  renderIssues();
  renderCrumbs();
  renderInsertTarget();
  renderCode();
  sendPreview();
  $('#btnUndo').disabled = !state.undo.length;
  $('#btnRedo').disabled = !state.redo.length;
}


// a UI5 of your own for the canvas: the folder that holds resources/
const isUi5Url = (v) => /^(https?:\/\/|\.{0,2}\/)[^"'<>\s]*$/.test(v);

function wire() {
  $('#insertSearch').addEventListener('input', renderInsert);
  $('#className').addEventListener('input', (e) => {
    const v = e.target.value.toUpperCase().replace(/\s/g, '');
    // the field shows the name the class gets, the caret stays in place
    if (e.target.value !== v) {
      const at = Math.max(0, e.target.selectionStart - (e.target.value.length - v.length));
      e.target.value = v;
      e.target.setSelectionRange(at, at);
    }
    commit((d) => { d.className = v; }, { mergeKey: 'className', keepFocus: true });
  });
  $('#description').addEventListener('input', (e) => commit((d) => { d.description = e.target.value; }, { mergeKey: 'description', keepFocus: true }));
  $('#abapRelease').addEventListener('change', (e) => commit((d) => { if (e.target.value) d.release = e.target.value; else delete d.release; }));
  wireMenu($('#btnFile'), $('#fileMenu'));
  wireMenu($('#btnExport'), $('#exportMenu'));
  $('#btnNew').onclick = newDialog;
  $('#btnOpen').onclick = () => openFile('.json,.xml,.abap');
  $('#btnOpenClass').onclick = openClassDialog;
  $('#btnPlayground').onclick = openInPlayground;
  $('#btnVscode').onclick = openInVscode;
  $('#btnSave').onclick = saveDesign;
  $('#btnImport').onclick = importDialog;
  $('#btnRecent').onclick = recentDialog;
  $('#btnShare').onclick = shareLink;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#btnCmd').onclick = openPalette;
  $('#btnZip').onclick = exportZip;
  $('#btnZip2').onclick = exportZip;
  $('#btnCopy').onclick = () => copyText(generateClassSource(state.design), 'ABAP');
  $('#btnCopyXml').onclick = () => copyText(toXml(state.design), 'XML');
  $('#btnDownloadAbap').onclick = () => download(fileName(state.design.className, 'clas.abap'), generateClassSource(state.design), 'text/plain');
  for (const b of document.querySelectorAll('.rail-btn')) b.onclick = () => showPanel(b.dataset.panel);
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  for (const b of document.querySelectorAll('[data-code]')) b.onclick = () => setCode(b.dataset.code);
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.onclick = () => {
      state.mode = b.dataset.mode;
      for (const x of document.querySelectorAll('[data-mode]')) x.classList.toggle('active', x === b);
      postPreview({ type: 'mode', mode: state.mode });
    };
  }
  // a click on a line of the class selects the control it writes
  $('#code').addEventListener('click', (e) => {
    const ln = e.target.closest('.ln[data-node]');
    if (ln && !getSelection().toString()) select(ln.dataset.node, { fromCode: true });
  });
  const setDevice = (w) => {
    state.prefs.device = w;
    $('#deviceFrame').style.width = w;
    for (const b of document.querySelectorAll('[data-device]')) b.classList.toggle('active', b.dataset.device === w);
  };
  setDevice(state.prefs.device);
  for (const b of document.querySelectorAll('[data-device]')) b.onclick = () => { setDevice(b.dataset.device); savePrefs(); };
  const theme = $('#theme');
  theme.value = state.prefs.theme;
  theme.onchange = () => { state.prefs.theme = theme.value; savePrefs(); loadPreview(); };
  const ver = $('#ui5version');
  ver.value = state.prefs.ui5 && !state.prefs.ui5.startsWith('local') ? state.prefs.ui5 : '';
  ver.onchange = () => {
    const v = ver.value.trim();
    if (v && !/^\d+\.\d+\.\d+$/.test(v) && !isUi5Url(v)) { ver.classList.add('invalid'); toast('A version like 1.71.80, the URL of a UI5 of your own, or empty for the latest'); return; }
    ver.classList.remove('invalid');
    state.prefs.ui5 = v;
    const minor = /^1\.(\d+)\./.exec(v);
    if (minor && Number(minor[1]) < 102 && state.prefs.theme === 'sap_horizon') { state.prefs.theme = 'sap_fiori_3'; theme.value = 'sap_fiori_3'; }
    savePrefs();
    loadPreview();
  };
  document.addEventListener('keydown', onKey);

  // the drawer and the properties can be dragged wider or narrower
  wireResizer($('#resizeDrawer'), 'drawer', 200, 480);
  wireResizer($('#resizeInspector'), 'inspector', 240, 560);
  applyWidths();

  // the canvas around the frame takes drops too
  const pane = $('#canvasPane');
  pane.addEventListener('dragover', (e) => e.preventDefault());
  pane.addEventListener('drop', (e) => { e.preventDefault(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
  $('#layers').addEventListener('keydown', onLayersKey);
  $('#layers').addEventListener('dragover', (e) => e.preventDefault());
  $('#layers').addEventListener('drop', (e) => { e.preventDefault(); clearDropMarks(); handleDrop(e.dataTransfer.getData('text/plain'), 'root'); });
}

// ------------------------------------------------------------- start

on('change', scheduleRender);
on('select', (opts) => {
  renderLayers();
  renderInspector();
  renderCrumbs();
  renderInsertTarget();
  highlightCode(!opts.fromCode);
  postPreview({ type: 'select', selected: state.selected, label: labelOfSelection() });
});

loadPrefs();
state.design = loadDesign();
state.selected = state.design.root.aggs.content && state.design.root.aggs.content[0] ? state.design.root.aggs.content[0].id : 'root';
wire();
setView(state.view);
renderInsert();
renderAll();
loadPreview();

// a class to open: ?src=<raw GitHub URL> (the playground's parameter) or
// ?class=<name>&repo=<owner/repo>[&ref=<branch>][&path=<folder>]
openClassFromUrl(new URLSearchParams(location.search));
if (state.refusedUi5) toast(`The link named a UI5 on another host (${state.refusedUi5}); it is not loaded from a link. Type it into the UI5 field to use it.`);

// a shared link: its design replaces the current one (Recent keeps that) -
// on load, and when a link is pasted into the address of an open editor
function openLinkedDesign() {
  if (!location.hash.startsWith('#d=')) return;
  designFromLink(location.hash).then((d) => {
    if (d) { replaceDesign(d); toast(`Opened ${d.className} from the link`); }
  }).catch((err) => toast(`The link holds no design: ${err.message}`))
    .finally(() => history.replaceState(null, '', location.pathname + location.search));
}
openLinkedDesign();
window.addEventListener('hashchange', openLinkedDesign);

// for the browser tests and the curious: the state and the generators
window.designer = { state, generateClass, generateClassSource, toXml, validate, select, commit, handleDrop, openPalette, copySelection, pasteSelection, addControlByName };
