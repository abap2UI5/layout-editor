// DOM helpers the panels share: elements from a tag and attributes, the
// toast, a download, the modal dialog, and the labels of a design node.
import { splitType } from '../catalog.js';

export const $ = (sel) => document.querySelector(sel);


export function h(tag, attrs, ...children) {
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

export function options(values, selected, labels = {}) {
  return values.map((v) => h('option', { value: v, selected: v === selected ? 'selected' : null, text: labels[v] ?? v }));
}

let toastTimer = null;

export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


export function dialog(title, body, buttons) {
  const dlg = $('#dlg');
  dlg.replaceChildren(h('header', { text: title }), h('div', { class: 'body' }, body),
    h('footer', {}, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => { if (b.action() !== false) dlg.close(); } }, b.text))));
  dlg.showModal();
}

export function rememberFocus(box) {
  const a = document.activeElement;
  if (!a || !box.contains(a) || !a.dataset.focus) return null;
  return { key: a.dataset.focus, start: a.selectionStart, end: a.selectionEnd };
}

export function restoreFocus(box, f) {
  if (!f) return;
  const el = box.querySelector(`[data-focus="${CSS.escape(f.key)}"]`);
  if (!el) return;
  el.focus();
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch { /* number/date inputs */ }
}

export function displayType(type) {
  return splitType(type).name;
}

export function nodeLabel(node) {
  const p = node.props || {};
  const show = p.text || p.title || p.headerText || p.placeholder || p.value || p.key;
  if (!show || show.v === undefined || show.v === '') return '';
  if (show.m === 's') return show.v;
  if (show.m === 'b') return `@${show.v}`;
  if (show.m === 'f') return `#${show.v}`;
  return show.v;
}
