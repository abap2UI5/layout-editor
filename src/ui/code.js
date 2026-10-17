// The code pane: the class or the XML view, highlighted, each line linked
// to the design node that writes it; and the layout / code switches.
import { state, savePrefs } from './store.js';
import { $, toast } from './dom.js';
import { fileName } from '../abap.js';
import { classSource } from '../clas.js';
import { toXml } from '../xml.js';
import { diffHunks } from '../diff.js';


const ABAP_KW = /\b(CLASS|DEFINITION|PUBLIC|PROTECTED|PRIVATE|SECTION|INTERFACES|TYPES|BEGIN|OF|END|TYPE|DATA|STANDARD|TABLE|WITH|EMPTY|KEY|REF|TO|METHODS|ENDCLASS|IMPLEMENTATION|METHOD|ENDMETHOD|IF|ELSEIF|ELSE|ENDIF|CASE|WHEN|ENDCASE|VALUE|LENGTH|DECIMALS|ME)\b/g;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function highlightAbapLine(line) {
  if (/^\s*"/.test(line) || /^\*/.test(line)) return `<span class="cmt">${esc(line)}</span>`;
  const parts = line.split(/(`(?:[^`]|``)*`|'[^']*'|\|(?:[^|\\]|\\.)*\|)/);
  return parts.map((p, i) => (i % 2 ? `<span class="str">${esc(p)}</span>` : esc(p).replace(ABAP_KW, '<span class="kw">$1</span>'))).join('');
}

function highlightXmlLine(line) {
  return esc(line).replace(/(&lt;\/?)([\w:.]+)/g, '$1<span class="tag">$2</span>').replace(/(="[^"]*")/g, '<span class="str">$1</span>');
}

let codeCache = { key: null };

export function renderCode() {
  const d = state.design;
  const pre = $('#code');
  // Changes exist for a class that was opened, and only for it
  const opened = !!(d.abap && d.abap.source);
  $('#btnDiff').hidden = !opened;
  if (state.code === 'diff' && !opened) { setCode('abap'); return; }
  const key = `${state.code}:${state.rev}`;
  if (codeCache.key === key) { highlightCode(false); return; }
  codeCache = { key };
  let lines;
  let nodeIds;
  if (state.code === 'diff') {
    renderDiff(pre, d);
    return;
  }
  if (state.code === 'abap') {
    const map = classSource(d);
    lines = map.source.replace(/\n$/, '').split('\n');
    nodeIds = map.nodeIds;
    const origin = d.abap ? ' · imported class, the view regenerated' : '';
    const notes = map.notes.length ? ` · ${map.notes.join(' · ')}` : '';
    $('#codeInfo').textContent = `${fileName(d.className, 'clas.abap')} · ${lines.length} lines${origin}${notes}`;
  } else {
    lines = toXml(d).split('\n');
    nodeIds = [];
    $('#codeInfo').textContent = 'what the class builds';
  }
  const hl = state.code === 'abap' ? highlightAbapLine : highlightXmlLine;
  pre.innerHTML = lines.map((l, i) => {
    const n = nodeIds[i] && nodeIds[i] !== 'root' ? ` data-node="${nodeIds[i]}"` : '';
    return `<span class="ln" data-n="${i + 1}"${n}>${hl(l) || ' '}</span>`;
  }).join('');
  highlightCode(false);
}

// the class as it was opened against the class the export writes
function renderDiff(pre, d) {
  const before = d.abap.source.replace(/\n$/, '').split('\n');
  const after = classSource(d).source.replace(/\n$/, '').split('\n');
  const h = diffHunks(before, after);
  $('#codeInfo').textContent = h.added || h.removed
    ? `+${h.added} −${h.removed} lines against the class as it was opened`
    : 'the export writes the class as it was opened';
  if (!h.added && !h.removed) {
    pre.innerHTML = '<span class="ln skip">No change - every line stays as it was.</span>';
    return;
  }
  pre.innerHTML = h.lines.map((l) => (l.op === '…'
    ? `<span class="ln skip">⋯ ${l.count} unchanged line${l.count === 1 ? '' : 's'}</span>`
    : `<span class="ln ${l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''}" data-n="${l.op === '-' ? l.a : l.b}">${highlightAbapLine(l.text) || ' '}</span>`)).join('');
}

// mark the selected control's lines, and bring the first into view
export function highlightCode(scroll) {
  const pre = $('#code');
  for (const el of pre.querySelectorAll('.ln.hi, .ln.hi-also')) el.classList.remove('hi', 'hi-also');
  for (const id of state.also) for (const el of pre.querySelectorAll(`.ln[data-node="${CSS.escape(id)}"]`)) el.classList.add('hi-also');
  const lines = pre.querySelectorAll(`.ln[data-node="${CSS.escape(state.selected)}"]`);
  lines.forEach((el) => el.classList.add('hi'));
  if (scroll && lines[0] && state.view !== 'canvas') {
    const top = lines[0].offsetTop - pre.clientHeight / 3;
    if (lines[0].offsetTop < pre.scrollTop || lines[0].offsetTop > pre.scrollTop + pre.clientHeight - 30) pre.scrollTo({ top, behavior: 'smooth' });
  }
}

export function setCode(code) {
  state.code = code;
  for (const b of document.querySelectorAll('[data-code]')) b.classList.toggle('active', b.dataset.code === code);
  renderCode();
}

export function setView(view) {
  state.view = view;
  state.prefs.view = view;
  savePrefs();
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
  $('#stageBody').className = `stage-body view-${view}`;
  // the class is not built while it is hidden - it is now
  if (view !== 'canvas') renderCode();
  highlightCode(true);
}

// true when the text is in the clipboard
export async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
    return true;
  } catch {
    // clipboard refused (no permission, not a secure context): show the
    // code and select it, so Ctrl+C works
    setCode(what === 'XML' ? 'xml' : 'abap');
    if (state.view === 'canvas') setView('split');
    const range = document.createRange();
    range.selectNodeContents($('#code'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    toast('Press Ctrl+C to copy the selection');
    return false;
  }
}
