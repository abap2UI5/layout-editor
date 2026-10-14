// The code pane: the class or the XML view, highlighted, each line linked
// to the design node that writes it; and the layout / code switches.
import { state, savePrefs } from './store.js';
import { $, toast } from './dom.js';
import { generateClassMap, fileName } from '../abap.js';
import { toXml } from '../xml.js';


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
  const key = `${state.code}:${state.rev}`;
  if (codeCache.key === key) { highlightCode(false); return; }
  codeCache = { key };
  let lines;
  let nodeIds;
  if (state.code === 'abap') {
    const map = generateClassMap(d);
    lines = map.source.replace(/\n$/, '').split('\n');
    nodeIds = map.nodeIds;
    $('#codeInfo').textContent = `${fileName(d.className, 'clas.abap')} · ${lines.length} lines`;
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

// mark the selected control's lines, and bring the first into view
export function highlightCode(scroll) {
  const pre = $('#code');
  for (const el of pre.querySelectorAll('.ln.hi')) el.classList.remove('hi');
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
  highlightCode(true);
}

export async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
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
  }
}
