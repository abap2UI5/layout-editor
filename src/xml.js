// Design -> UI5 XML view, and UI5 XML view -> design.
//
// The XML is what the generated ABAP class builds at runtime, with one
// difference the class cannot avoid: abap2UI5 decides the binding paths
// (client->_bind( ) returns them), so the view here binds `{/NAME}` against
// a model of upper-case keys, the shape abap2UI5 sends. The preview flavour
// adds an id per control (to find a clicked control in the design) and
// routes every event to one handler that shows the event name.

import { NAMESPACES, CONTROLS, getControl, splitType } from './catalog.js';
import { aggNames, newId, walk, isDirectAgg } from './model.js';

export function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// literal text must not be read as a binding: UI5 parses `{` in every
// attribute, the view's escape for a literal brace is a backslash
export function escapeBindingLiteral(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

export function valueToXml(value, opts) {
  if (!value) return null;
  switch (value.m) {
    case 's': return escapeBindingLiteral(value.v ?? '');
    case 'b': return `{/${String(value.v).toUpperCase()}}`;
    case 'f': return `{${value.v}}`;
    case 'x': return String(value.v ?? '');
    default: return opts && opts.strict ? (() => { throw new Error(`unknown value mode ${value.m}`); })() : null;
  }
}

// every prefix the design uses, so the View declares exactly those
export function usedNamespaces(design) {
  const used = new Set(['', 'mvc']);
  walk(design.root, (n) => { used.add(splitType(n.type).ns); });
  return [...used].filter((ns) => ns in NAMESPACES || (design.namespaces && ns in design.namespaces));
}

export function namespaceUri(design, ns) {
  return NAMESPACES[ns] || (design.namespaces && design.namespaces[ns]);
}

export function toXml(design, options = {}) {
  const preview = !!options.preview;
  const lines = [];
  const nsAttrs = usedNamespaces(design).map((ns) => (ns ? `xmlns:${ns}="${namespaceUri(design, ns)}"` : `xmlns="${NAMESPACES['']}"`));
  const viewAttrs = [...nsAttrs, 'displayBlock="true"', 'height="100%"'];
  lines.push(`<mvc:View ${viewAttrs.join(' ')}>`);
  for (const child of design.root.aggs.content || []) emit(child, 1);
  lines.push('</mvc:View>');
  return lines.join('\n');

  function emit(node, depth) {
    const pad = '  '.repeat(depth);
    const { ns } = splitType(node.type);
    const attrs = [];
    if (preview) attrs.push(`id="${node.id}"`);
    for (const [name, value] of Object.entries(node.props || {})) {
      const v = valueToXml(value);
      if (v === null || (value.m === 's' && value.v === '')) continue;
      attrs.push(`${name}="${escapeXml(v)}"`);
    }
    for (const [ev, name] of Object.entries(node.events || {})) {
      if (!name) continue;
      attrs.push(preview ? `${ev}=".onEvent('${name}')"` : `${ev}="${escapeXml(`.onEvent('${name}')`)}"`);
    }
    const open = `${pad}<${node.type}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    const aggs = aggNames(node).filter((a) => (node.aggs[a] || []).length);
    if (!aggs.length) { lines.push(`${open}/>`); return; }
    lines.push(`${open}>`);
    for (const a of aggs) {
      if (isDirectAgg(node, a)) {
        for (const ch of node.aggs[a]) emit(ch, depth + 1);
      } else {
        const tag = ns ? `${ns}:${a}` : a;
        lines.push(`${pad}  <${tag}>`);
        for (const ch of node.aggs[a]) emit(ch, depth + 2);
        lines.push(`${pad}  </${tag}>`);
      }
    }
    lines.push(`${pad}</${node.type}>`);
  }
}

// ------------------------------------------------------------- import

// A small XML reader: elements, attributes, self-closing tags, comments,
// processing instructions, CDATA and text (text is dropped - a UI5 view
// carries none that matters here). Enough for a view, and the same in the
// browser and in node, which DOMParser is not.
export function parseXml(src) {
  let i = 0;
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const decode = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (m, e) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e[1] === 'x') return String.fromCodePoint(parseInt(e.slice(2), 16));
    return String.fromCodePoint(parseInt(e.slice(1), 10));
  });
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    if (src.startsWith('<!--', lt)) { i = end(src.indexOf('-->', lt), 3); continue; }
    if (src.startsWith('<![CDATA[', lt)) { i = end(src.indexOf(']]>', lt), 3); continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { i = end(src.indexOf('>', lt), 1); continue; }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      const name = src.slice(lt + 2, gt).trim();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`XML: </${name}> does not close <${top ? top.name : '?'}>`);
      i = gt + 1;
      continue;
    }
    const m = /^<([A-Za-z_][\w.:-]*)/.exec(src.slice(lt, lt + 200));
    if (!m) throw new Error(`XML: unexpected "<" at ${lt}`);
    const el = { name: m[1], attrs: {}, children: [] };
    let j = lt + m[0].length;
    const attrRe = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?)>/y;
    for (;;) {
      attrRe.lastIndex = j;
      const a = attrRe.exec(src);
      if (!a) throw new Error(`XML: malformed tag <${el.name}> at ${lt}`);
      j = attrRe.lastIndex;
      if (a[1]) { el.attrs[a[1]] = decode(a[3] !== undefined ? a[3] : a[4]); continue; }
      stack[stack.length - 1].children.push(el);
      if (a[5] !== '/') stack.push(el);
      break;
    }
    i = j;
  }
  if (stack.length !== 1) throw new Error(`XML: <${stack[stack.length - 1].name}> is not closed`);
  return root.children[0];

  function end(pos, len) {
    if (pos < 0) throw new Error('XML: unterminated markup');
    return pos + len;
  }
}

// UI5 XML view -> design. Controls the catalogue knows become ordinary
// nodes; anything else is kept as it is (its namespace is remembered), so
// an import never drops part of a view. Bindings become raw expressions,
// event handlers are dropped - they name controller methods abap2UI5 does
// not have.
export function fromXml(src, base) {
  const doc = parseXml(src);
  if (!doc) throw new Error('XML: empty document');
  const uriToPrefix = {};
  for (const [p, uri] of Object.entries(NAMESPACES)) uriToPrefix[uri] = p;
  const extraNs = {};

  const design = base;
  design.root = { id: 'root', type: 'mvc:View', props: {}, events: {}, aggs: { content: [] } };
  design.namespaces = {};

  const scope0 = nsScope({}, doc);
  const [, viewName] = qname(doc.name, scope0);
  if (viewName !== 'View') throw new Error(`XML: the root element is ${doc.name}, not an mvc:View`);
  for (const ch of doc.children) {
    const node = convert(ch, scope0);
    if (node) design.root.aggs.content.push(node);
  }
  design.namespaces = extraNs;
  return design;

  function nsScope(parent, el) {
    const scope = { ...parent };
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k === 'xmlns') scope[''] = v;
      else if (k.startsWith('xmlns:')) scope[k.slice(6)] = v;
    }
    return scope;
  }

  // element name -> [canonical prefix, local name]
  function qname(name, scope) {
    const i = name.indexOf(':');
    const p = i < 0 ? '' : name.slice(0, i);
    const local = i < 0 ? name : name.slice(i + 1);
    const uri = scope[p];
    if (uri === undefined) throw new Error(`XML: prefix "${p}" of <${name}> is not declared`);
    let canon = uriToPrefix[uri];
    if (canon === undefined) {
      canon = p || uri.split('.').pop();
      while (canon in NAMESPACES || (extraNs[canon] && extraNs[canon] !== uri)) canon += '_';
      extraNs[canon] = uri;
      uriToPrefix[uri] = canon;
    }
    return [canon, local];
  }

  function convert(el, parentScope) {
    const scope = nsScope(parentScope, el);
    const [ns, local] = qname(el.name, scope);
    const type = ns ? `${ns}:${local}` : local;
    const c = getControl(type);
    const node = { id: newId(), type, props: {}, events: {}, aggs: {} };
    for (const [k, v] of Object.entries(el.attrs)) {
      if (k === 'xmlns' || k.startsWith('xmlns:') || k === 'id' || k.includes(':')) continue;
      if (c && c.events && c.events.includes(k)) continue;
      if (/^\s*\.[A-Za-z_$]/.test(v)) continue; // a controller handler
      node.props[k] = isBinding(v) ? { m: 'x', v } : { m: 's', v: unescapeBindingLiteral(v) };
    }
    for (const ch of el.children) {
      const chScope = nsScope(scope, ch);
      const [chNs, chLocal] = qname(ch.name, chScope);
      const isAgg = /^[a-z]/.test(chLocal) && chNs === ns;
      if (isAgg) {
        for (const g of ch.children) {
          const sub = convert(g, chScope);
          if (sub) (node.aggs[chLocal] = node.aggs[chLocal] || []).push(sub);
        }
      } else {
        const sub = convert(ch, scope);
        const agg = (c && c.defaultAgg) || '';
        (node.aggs[agg] = node.aggs[agg] || []).push(sub);
      }
    }
    return node;
  }
}

function isBinding(v) {
  // a brace that is not escaped
  return /(^|[^\\])\{/.test(v);
}

function unescapeBindingLiteral(s) {
  return s.replace(/\\([\\{}])/g, '$1');
}

export function knownTypes() {
  return Object.keys(CONTROLS);
}
