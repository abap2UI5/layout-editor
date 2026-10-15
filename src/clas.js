// An abap2UI5 app class -> design (import), and the design -> that class
// again (export): the regenerated view_display chain written back into the
// class it came from, everything else - on_event branches, model_init, any
// method of the author's own - exactly as it was.
//
// The import reads the class in three places:
//   - the PUBLIC SECTION: every DATA attribute whose type the editor has
//     (string, i, p, abap_bool, d, t, a table of a structure of those) is an
//     attribute of the design; the structure types come from the TYPES
//   - the seeds: `name = literal.` and `t_rows = VALUE #( ( ... ) ).` in
//     model_init (or, without one, anywhere in the class) are the sample data
//   - the view: the z2ui5_cl_ui5_view_builder chain, read by an interpreter
//     of the builder's four calls (ele/tag/a/end) - the one-statement shape
//     the editor writes and the split shape of the samples (`DATA(page) =
//     view->ele( ... ).` then `page->tag( ... )`) alike. Every attribute
//     keeps the ABAP that produced it: `client->_bind( name )` is a binding
//     of that attribute, `client->_event( \`SAVE\` )` the event SAVE, a
//     literal (or `&&` of literals) its text. The tree is rendered as an XML
//     view and goes through fromXml( ), so an import of a class resolves
//     bindings, keeps unknown controls and reports exactly like an import of
//     a view does.
// What the editor cannot represent is never dropped silently. An attribute
// whose value is ABAP the editor has no field for (a method call, a
// variable, a template with ABAP in it), an `id` and a prefixed attribute
// (`core:require`) are kept with their control as raw ABAP
// (`design.abap.raw`, by node id) and written back into the regenerated
// chain - unless the editor sets that attribute itself, or the control is
// deleted. A public attribute of a type the data panel has no editor for
// stays in the class untouched. All of it is in the report.
//
// The export patches rather than generates: the design remembers the source
// and where its chain was (`design.abap`), the chain is written again in the
// house layout over exactly that range, attributes the editor added are
// declared at the end of the PUBLIC SECTION, and an event the editor named
// gets its WHEN branch in the CASE of on_event. A design without `abap` is
// generated as always.

import { viewChain, generateClassMap, abapGitFiles, abapType, abapString, fileName } from './abap.js';
import { fromXml, importReport, escapeXml, escapeBindingLiteral, isSetValue } from './xml.js';
import { collectEvents, tableTypes, typeName, clone, walk } from './model.js';

// ------------------------------------------------------------- scanning

// The source with its comments blanked to spaces and its literals to \x01,
// so a full stop or a parenthesis inside either counts for nothing. The
// three literal forms (' and ` with a doubled quote for one, |...| with
// backslash escapes and braces holding ABAP) and both comment forms.
export function maskSource(source) {
  const mask = source.split('');
  const blank = (from, to, fill) => { for (let i = from; i < to; i++) if (mask[i] !== '\n') mask[i] = fill; };
  let at = 0;
  while (at < source.length) {
    const ch = source[at];
    if (ch === '"' || (ch === '*' && (at === 0 || source[at - 1] === '\n'))) {
      const eol = source.indexOf('\n', at);
      const end = eol === -1 ? source.length : eol;
      blank(at, end, ' ');
      at = end;
    } else if (ch === "'" || ch === '`') {
      const end = closingQuote(source, at, ch);
      blank(at, end, '\x01');
      at = end;
    } else if (ch === '|') {
      const end = closingTemplate(source, at);
      blank(at, end, '\x01');
      at = end;
    } else {
      at += 1;
    }
  }
  return mask.join('');
}

function closingQuote(source, from, quote) {
  let at = from + 1;
  while (at < source.length) {
    if (source[at] === '\n') return at;
    if (source[at] === quote) {
      if (source[at + 1] === quote) { at += 2; continue; }
      return at + 1;
    }
    at += 1;
  }
  return source.length;
}

function closingTemplate(source, from) {
  const depths = [0];
  let at = from + 1;
  while (at < source.length) {
    const ch = source[at];
    const top = depths.length - 1;
    const depth = depths[top];
    if (ch === '\n' && depth === 0) { depths.pop(); if (!depths.length) return at; continue; }
    if (ch === '\\' && depth === 0) { at += 2; continue; }
    if (depth > 0 && (ch === "'" || ch === '`')) { at = closingQuote(source, at, ch); continue; }
    if (ch === '{') depths[top] += 1;
    else if (ch === '}') depths[top] = Math.max(0, depth - 1);
    else if (ch === '|' && depth === 0) { depths.pop(); if (!depths.length) return at + 1; } else if (ch === '|') depths.push(0);
    at += 1;
  }
  return source.length;
}

// the statements as ranges [start, end) on the mask, end past the full stop
function statementsOf(mask, from = 0, to = mask.length) {
  const out = [];
  let start = from;
  for (let at = from; at < to; at++) {
    if (mask[at] !== '.') continue;
    if (mask.slice(start, at).trim() !== '') out.push({ start, end: at + 1 });
    start = at + 1;
  }
  return out;
}

function closingParen(mask, from, to = mask.length) {
  let depth = 0;
  for (let at = from; at < to; at++) {
    if (mask[at] === '(') depth += 1;
    else if (mask[at] === ')') { depth -= 1; if (depth === 0) return at; }
  }
  return -1;
}

// the constants of cl_abap_char_utilities the 7.02 class joins its line
// breaks and tabs with (src/abap.js, CHAR_CONST)
const CHAR_UTILITIES = {
  'cl_abap_char_utilities=>cr_lf': '\r\n',
  'cl_abap_char_utilities=>newline': '\n',
  'cl_abap_char_utilities=>cr_lf(1)': '\r',
  'cl_abap_char_utilities=>horizontal_tab': '\t',
};
const TEMPLATE_ESCAPES = { n: '\n', r: '\r', t: '\t', '\\': '\\', '|': '|', '{': '{', '}': '}' };

// the text of a literal token ('...', `...`), of a string template with
// no embedded expression (|a\nb|, the way 7.40 writes a line break), or of
// a char constant of cl_abap_char_utilities - undefined for anything else
function literalText(token) {
  const t = token.trim();
  const constant = CHAR_UTILITIES[t.toLowerCase()];
  if (constant !== undefined) return constant;
  const q = t[0];
  if (t.length < 2 || t[t.length - 1] !== q) return undefined;
  if (q === '|') return plainTemplateText(t.slice(1, -1));
  if (q !== "'" && q !== '`') return undefined;
  // one literal only: a lone quote inside means two literals and
  // what stands between them (`a` && `b`), which concatText( ) reads
  const inner = t.slice(1, -1).split(q + q);
  if (inner.some((part) => part.includes(q))) return undefined;
  return inner.join(q);
}

// the body of a string template as text, or undefined when it embeds an
// expression ({ ... }) or holds an escape the generator does not write
function plainTemplateText(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '}' || ch === '|') return undefined;
    if (ch !== '\\') { out += ch; continue; }
    const esc = TEMPLATE_ESCAPES[body[i + 1]];
    if (esc === undefined) return undefined;
    out += esc;
    i += 1;
  }
  return out;
}

// an ABAP operand on one line: every run of blanks outside a literal (and
// a comment, which the mask blanks) one space - what a raw attribute is
// written back as, inside the one-call-per-line chain
function oneLine(abap) {
  const t = abap.trim();
  const mask = maskSource(t);
  let out = '';
  for (let i = 0; i < t.length; i++) {
    if (/\s/.test(mask[i]) && mask[i] !== '\x01') { if (!out.endsWith(' ')) out += ' '; } else out += t[i];
  }
  return out.trim();
}

// a literal, or literals joined with && (the way a long text is written),
// as one string - undefined for anything else
function concatText(mask, source, from, to) {
  const parts = [];
  let at = from;
  while (at < to) {
    const seg = mask.indexOf('&&', at);
    const end = seg < 0 || seg >= to ? to : seg;
    const text = literalText(source.slice(at, end));
    if (text === undefined) return undefined;
    parts.push(text);
    at = end + 2;
  }
  return parts.join('');
}

// ------------------------------------------------------------- the view chain

const FACTORY = 'z2ui5_cl_ui5_view_builder=>factory';

// The chain of a class as a tree of { name, ns, attrs: [{ name, raw, key }],
// children } with the range of the source it occupies. `{ ok: false, why }`
// when there is none, or when it is more than the four builder calls.
export function readViewChain(source) {
  const mask = maskSource(source);
  const statements = statementsOf(mask);
  const buildsView = (s) => mask.slice(s.start, s.end).toLowerCase().includes(FACTORY);
  const first = statements.findIndex(buildsView);
  if (first < 0) return { ok: false, why: 'Nothing here builds a view with z2ui5_cl_ui5_view_builder.' };
  if (statements.some((s, i) => i > first && buildsView(s))) return { ok: false, why: 'This class builds more than one view - the editor edits one.' };

  const root = { name: '', ns: '', attrs: [], children: [], parent: null };
  const vars = new Map();
  let regionStart = null;
  let regionEnd = null;
  let variable = null;
  let indent = 0;
  for (let i = first; i < statements.length; i++) {
    const st = statements[i];
    const text = mask.slice(st.start, st.end);
    if (i > first && /\bstringify\s*\(/i.test(text)) break;
    const m = /^(\s*)((?:DATA\(\s*(\w+)\s*\)|(\w+))\s*=\s*)?(z2ui5_cl_ui5_view_builder=>factory|[a-z_]\w*)\s*(?=\(|->)/i.exec(text);
    if (!m) {
      if (i === first) return { ok: false, why: 'The chain does not start with a plain assignment.' };
      break;
    }
    const target = m[5].toLowerCase();
    const isFactory = target === FACTORY;
    if (!isFactory && !vars.has(target)) {
      if (i === first) return { ok: false, why: 'The chain does not start with the factory.' };
      break;
    }
    const declared = (m[3] || m[4] || '').toLowerCase();
    if (i === first) {
      regionStart = st.start + m[1].length;
      variable = declared || null;
      const lineStart = source.lastIndexOf('\n', regionStart - 1) + 1;
      if (source.slice(lineStart, regionStart).trim() === '') { indent = regionStart - lineStart; regionStart = lineStart; }
    }
    let cursor = isFactory ? root : vars.get(target);
    let at = st.start + m[0].length;
    const to = st.end - 1;
    const skip = () => { while (at < to && /\s/.test(mask[at])) at += 1; };
    skip();
    if (isFactory) {
      if (mask[at] !== '(') return { ok: false, why: 'factory( ) is called without parentheses.' };
      const close = closingParen(mask, at, st.end);
      if (close < 0) return { ok: false, why: 'A parenthesis in the chain is never closed.' };
      if (mask.slice(at + 1, close).trim() !== '') return { ok: false, why: 'factory( ) takes no arguments.' };
      at = close + 1;
    }
    for (;;) {
      skip();
      if (at >= to) break;
      const call = /^->\s*(\w+)\s*(?=\()/.exec(mask.slice(at, to + 1));
      if (!call) return { ok: false, why: `The chain has a call this cannot read: ${source.slice(at, Math.min(to, at + 30)).trim()}` };
      at += call[0].length;
      const close = closingParen(mask, at, st.end);
      if (close < 0) return { ok: false, why: 'A parenthesis in the chain is never closed.' };
      const applied = apply(cursor, call[1].toLowerCase(), readArgs(mask, source, at + 1, close));
      if (!applied.ok) return applied;
      cursor = applied.cursor;
      at = close + 1;
    }
    if (declared) vars.set(declared, cursor);
    regionEnd = st.end;
  }
  if (root.children.length !== 1) return { ok: false, why: 'The chain does not build exactly one root element.' };
  return { ok: true, root: root.children[0], start: regionStart, end: regionEnd, indent, variable: variable || 'view' };
}

// the named arguments (n, ns, v, b, t) of one call, or the positional one
function readArgs(mask, source, from, to) {
  const marks = [];
  let depth = 0;
  for (let at = from; at < to; at++) {
    const ch = mask[at];
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (depth === 0) {
      const m = /^(ns|n|v|b|t)\s*=(?!=)/i.exec(mask.slice(at, to));
      if (m && (at === from || /[\s(]/.test(mask[at - 1]))) {
        marks.push({ key: m[1].toLowerCase(), from: at, valueAt: at + m[0].length });
        at += m[0].length - 1;
      }
    }
  }
  const args = {};
  const value = (a, b) => {
    const masked = mask.slice(a, b);
    const s = a + (masked.length - masked.trimStart().length);
    const e = a + masked.trimEnd().length;
    return { raw: source.slice(s, e), text: concatText(mask, source, s, e) };
  };
  if (!marks.length) {
    if (mask.slice(from, to).trim() !== '') args.positional = value(from, to);
    return args;
  }
  marks.forEach((mark, i) => { args[mark.key] = value(mark.valueAt, i + 1 < marks.length ? marks[i + 1].from : to); });
  return args;
}

// One builder call against the tree, the class's own semantics: a( ) lands
// on the last child when there is one, else on the node itself
function apply(cursor, method, args) {
  if (method === 'ele' || method === 'tag') {
    const name = (args.n || args.positional || {}).text;
    if (name === undefined) return { ok: false, why: 'An element is added under a name that is not a literal.' };
    if (args.ns && args.ns.text === undefined) return { ok: false, why: 'A namespace prefix is not a literal.' };
    const node = { name, ns: args.ns ? args.ns.text : '', attrs: [], children: [], parent: cursor };
    cursor.children.push(node);
    return { ok: true, cursor: method === 'ele' ? node : cursor };
  }
  if (method === 'a') {
    const target = cursor.children.length ? cursor.children[cursor.children.length - 1] : cursor;
    if (target.name === '') return { ok: false, why: 'An attribute is set before any element was added.' };
    const name = args.n && args.n.text;
    if (name === undefined) return { ok: false, why: 'An attribute is set under a name that is not a literal.' };
    const key = args.v ? 'v' : args.b ? 'b' : args.t ? 't' : null;
    if (!key) return { ok: false, why: `\`${name}\` is set without a value.` };
    target.attrs.push({ name, key, raw: args[key].raw, text: args[key].text });
    return { ok: true, cursor };
  }
  if (method === 'end') {
    if (!cursor.parent) return { ok: false, why: 'The chain ascends past its own root.' };
    return { ok: true, cursor: cursor.parent };
  }
  return { ok: false, why: `${method}( ) is not one of the builder's calls.` };
}

// ------------------------------------------------------------- attribute values

// What one attribute of the chain means in the view, from the ABAP that
// produced it: { xml } for a value the XML view can carry (bindings in the
// shape abap2UI5 writes, so fromXml( ) resolves them), { event } for a
// client->_event( ), null when the ABAP is beyond the editor
function attrValue(attr) {
  const raw = attr.raw.trim();
  if (attr.key === 'b') {
    if (/^abap_true$/i.test(raw)) return { xml: 'true' };
    if (/^(abap_false|space|' ?'|` ?`)$/i.test(raw)) return { xml: 'false' };
    return null;
  }
  if (attr.text !== undefined) return { xml: attr.key === 't' ? escapeBindingLiteral(attr.text) : attr.text };
  const ev = /^client->_event\(\s*(?:val\s*=\s*)?([`'][A-Za-z0-9_]+[`'])\s*\)$/.exec(raw);
  if (ev) return { event: literalText(ev[1]) };
  const bind = bindPath(raw);
  if (bind) return { xml: `{${bind}}` };
  if (raw[0] === '|' && raw[raw.length - 1] === '|') return templateText(raw.slice(1, -1));
  return concatBindText(raw);
}

// the 7.02 form of the tree binding: literals and bare bind paths joined
// with && (`{path:'` && client->_bind( ... ) && `',...}`) as the text it
// renders to; null when a piece is anything else
function concatBindText(raw) {
  const mask = maskSource(raw);
  if (mask.indexOf('&&') < 0) return null;
  let out = '';
  let at = 0;
  while (at <= raw.length) {
    const seg = mask.indexOf('&&', at);
    const end = seg < 0 ? raw.length : seg;
    const piece = raw.slice(at, end).trim();
    const text = literalText(piece);
    if (text !== undefined) out += text;
    else {
      const p = bindPath(piece, true);
      if (!p) return null;
      out += p;
    }
    if (seg < 0) break;
    at = seg + 2;
  }
  return { xml: out };
}

// A string template whose embedded expressions are all bare bind paths -
// the tree binding the editor writes - as the text it renders to; null
// when an expression is anything else
function templateText(body) {
  let out = '';
  let at = 0;
  while (at < body.length) {
    const ch = body[at];
    if (ch === '\\') { out += body[at + 1] === 'n' ? '\n' : body[at + 1] === 't' ? '\t' : body[at + 1] === 'r' ? '\r' : body[at + 1]; at += 2; continue; }
    if (ch === '{') {
      let depth = 1;
      let end = at + 1;
      while (end < body.length && depth) { if (body[end] === '{') depth += 1; else if (body[end] === '}') depth -= 1; end += 1; }
      const p = bindPath(body.slice(at + 1, end - 1).trim(), true);
      if (!p) return null;
      out += p;
      at = end;
      continue;
    }
    out += ch;
    at += 1;
  }
  return { xml: out };
}

// client->_bind( name ) -> /NAME, client->_bind( val = s-f path = abap_true )
// -> /S/F when `bare` is allowed; null for every other call
function bindPath(expr, bare = false) {
  const m = /^client->_bind(?:_edit)?\(\s*(.*?)\s*\)$/s.exec(expr);
  if (!m) return null;
  const inner = m[1];
  let name = null;
  let isBare = false;
  if (/^(me->)?\w+(-\w+)*$/.test(inner)) name = inner;
  else {
    const named = /^val\s*=\s*((?:me->)?\w+(?:-\w+)*)(\s+path\s*=\s*abap_true)?$/i.exec(inner);
    if (!named) return null;
    name = named[1];
    isBare = !!named[2];
  }
  if (isBare !== bare) return null;
  return '/' + name.replace(/^me->/i, '').toUpperCase().replace(/-/g, '/');
}

// the attributes of the View element the generator writes itself
const VIEW_OWN = /^(xmlns(:\w+)?|displayBlock|height)$/;
const VIEW_FIXED = { displayBlock: 'true', height: '100%' };

// the chain as an XML view: literals escaped, bindings as abap2UI5 writes
// them, events as the preview flavour of toXml( ) writes them (so the same
// reader takes both). What has no XML is collected in `raw` - one entry
// per element that has some, its index in a RAW_MARK attribute fromXml( )
// skips - and, on the View itself, which the generator writes alone, in
// `dropped`
const RAW_MARK = 'le:raw';

function chainToXml(root, raw, dropped) {
  const lines = [];
  emit(root, 0, '');
  return lines.join('\n');

  function emit(node, depth, path) {
    const tag = node.ns ? `${node.ns}:${node.name}` : node.name;
    const here = `${path}/${tag}`;
    const attrs = [];
    const kept = [];
    for (const a of node.attrs) {
      if (depth === 0) {
        // the View: its namespaces are what fromXml( ) needs, the rest is the generator's
        const own = VIEW_OWN.test(a.name) && a.text !== undefined && (VIEW_FIXED[a.name] === undefined || VIEW_FIXED[a.name] === a.text);
        if (own) attrs.push(`${a.name}="${escapeXml(a.text)}"`);
        else dropped.push({ control: tag, attr: a.name, abap: oneLine(a.raw) });
        continue;
      }
      const v = attrValue(a);
      if (!v || a.name === 'id' || a.name.includes(':')) { kept.push({ name: a.name, key: a.key, abap: oneLine(a.raw) }); continue; }
      if (v.event !== undefined) attrs.push(`${a.name}=".onEvent('${v.event}')"`);
      else attrs.push(`${a.name}="${escapeXml(v.xml)}"`);
    }
    if (kept.length) { attrs.push(`${RAW_MARK}="${raw.length}"`); raw.push({ control: tag, attrs: kept }); }
    const pad = '  '.repeat(depth);
    const open = `${pad}<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`;
    if (!node.children.length) { lines.push(`${open}/>`); return; }
    lines.push(`${open}>`);
    for (const ch of node.children) emit(ch, depth + 1, here);
    lines.push(`${pad}</${tag}>`);
  }
}

// ------------------------------------------------------------- the data

const SCALAR = [
  [/^string$/i, 'string'], [/^c(\s+LENGTH\s+\d+)?$/i, 'string'], [/^n(\s+LENGTH\s+\d+)?$/i, 'string'],
  [/^i$/i, 'int'], [/^int[48]$/i, 'int'],
  [/^p(\s+LENGTH\s+\d+)?(\s+DECIMALS\s+\d+)?$/i, 'decimal'], [/^f$/i, 'decimal'], [/^decfloat(16|34)$/i, 'decimal'],
  [/^(abap_bool|abap_boolean|xsdboolean|xsd_boolean)$/i, 'bool'],
  [/^d$/i, 'date'], [/^t$/i, 'time'],
];

function scalarType(abap) {
  const t = abap.trim();
  for (const [re, type] of SCALAR) if (re.test(t)) return type;
  return null;
}

// the elements of `DATA a TYPE x.` and `DATA: a TYPE x, b TYPE y.` alike
function elementsOf(text, keyword) {
  const m = new RegExp(`^\\s*${keyword}\\s*:?\\s*([\\s\\S]*)\\.$`, 'i').exec(text);
  if (!m) return null;
  return m[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// The attributes of the PUBLIC SECTION, with the structures the TYPES
// declare; what the editor cannot type is listed in `skipped`
export function readPublicSection(source) {
  const mask = maskSource(source);
  const def = /\bCLASS\s+(\S+)\s+DEFINITION\b[\s\S]*?\.\s*/i.exec(mask);
  if (!def) return null;
  const pub = /\bPUBLIC\s+SECTION\s*\./i.exec(mask.slice(def.index));
  if (!pub) return null;
  const from = def.index + pub.index + pub[0].length;
  const rest = mask.slice(from);
  const endRe = /\b(PROTECTED\s+SECTION|PRIVATE\s+SECTION|ENDCLASS)\b/i;
  const endM = endRe.exec(rest);
  const to = endM ? from + endM.index : mask.length;
  // where a new declaration goes: the start of the line that ends the section
  const insertAt = source.lastIndexOf('\n', to - 1) + 1;

  const structures = new Map(); // NAME -> [{ name, type }] (type: abap text)
  const tableTypesByName = new Map(); // NAME -> row type name
  const attributes = [];
  const declared = [];
  const skipped = [];
  let open = null;
  for (const st of statementsOf(mask, from, to)) {
    // the statement without its comments (blank on the mask), literals kept
    let text = '';
    for (let i = st.start; i < st.end; i++) text += mask[i] === ' ' ? ' ' : source[i];
    text = text.replace(/\s+/g, ' ').trim();
    const types = elementsOf(text, 'TYPES');
    if (types) {
      for (const el of types) {
        const begin = /^BEGIN OF (\w+)$/i.exec(el);
        const end = /^END OF (\w+)$/i.exec(el);
        if (begin) { open = { name: begin[1].toUpperCase(), fields: [] }; continue; }
        if (end) { if (open) structures.set(open.name, open.fields); open = null; continue; }
        const comp = /^(\w+) TYPE (.+)$/i.exec(el);
        if (!comp) continue;
        if (open) open.fields.push({ name: comp[1], type: comp[2] });
        else {
          const tab = /^(?:STANDARD |SORTED |HASHED )?TABLE OF (\w+)/i.exec(comp[2]);
          if (tab) tableTypesByName.set(comp[1].toUpperCase(), tab[1].toUpperCase());
        }
      }
      continue;
    }
    const data = elementsOf(text, 'DATA');
    if (!data) continue;
    for (const el of data) {
      const m = /^(\w+) TYPE (.+?)(?: VALUE (.+))?(?: READ-ONLY)?$/i.exec(el);
      if (!m) continue;
      const name = m[1].toLowerCase();
      declared.push(name);
      const attr = attributeOf(name, m[2]);
      if (attr) {
        if (m[3] && attr.type !== 'table') attr.value = seedValue(attr.type, m[3]) ?? '';
        attributes.push(attr);
      } else skipped.push({ name, type: m[2] });
    }
  }
  return { attributes, declared, skipped, insertAt };

  function attributeOf(name, type) {
    const scalar = scalarType(type);
    if (scalar) return { name, type: scalar, value: '' };
    let row = null;
    const tab = /^(?:STANDARD |SORTED |HASHED )?TABLE OF (\w+)(?:\s+WITH\b.*)?$/i.exec(type.trim());
    if (tab) row = tab[1].toUpperCase();
    else if (tableTypesByName.has(type.trim().toUpperCase())) row = tableTypesByName.get(type.trim().toUpperCase());
    if (!row) return null;
    const fields = fieldsOf(row, new Set());
    if (!fields) return null;
    return { name, type: 'table', fields, rows: [] };
  }

  function fieldsOf(structName, seen) {
    const comps = structures.get(structName);
    if (!comps || seen.has(structName)) return null;
    seen.add(structName);
    const fields = [];
    for (const c of comps) {
      const scalar = scalarType(c.type);
      if (scalar) { fields.push({ name: c.name.toUpperCase(), type: scalar }); continue; }
      const tab = /^(?:STANDARD |SORTED |HASHED )?TABLE OF (\w+)(?:\s+WITH\b.*)?$/i.exec(c.type.trim());
      const sub = tab ? fieldsOf(tab[1].toUpperCase(), seen) : null;
      if (!sub) return null;
      fields.push({ name: c.name.toUpperCase(), type: 'table', fields: sub });
    }
    return fields;
  }
}

// an ABAP operand as the data panel's value of that type, or undefined
function seedValue(type, operand) {
  const op = operand.trim();
  // one literal, or the pieces a long text or a line break is written in
  const lit = literalText(op) ?? concatText(maskSource(op), op, 0, op.length);
  switch (type) {
    case 'string': return lit;
    case 'int': return /^-?\d+$/.test(op) ? op : lit !== undefined && /^-?\d+$/.test(lit) ? lit : undefined;
    case 'decimal': {
      const t = lit !== undefined ? lit : op;
      return /^-?\d+(\.\d+)?$/.test(t) ? t : undefined;
    }
    case 'bool':
      if (/^abap_true$/i.test(op) || lit === 'X') return true;
      if (/^(abap_false|space)$/i.test(op) || lit === '' || lit === ' ') return false;
      return undefined;
    case 'date': return lit !== undefined && /^\d{8}$/.test(lit) ? `${lit.slice(0, 4)}-${lit.slice(4, 6)}-${lit.slice(6)}` : undefined;
    case 'time': return lit !== undefined && /^\d{6}$/.test(lit) ? `${lit.slice(0, 2)}:${lit.slice(2, 4)}:${lit.slice(4)}` : undefined;
    default: return undefined;
  }
}

// The seeds of the attributes: `name = operand.` for a scalar, `name =
// VALUE #( ( f = v ... ) ... ).` for a table - read from model_init when
// the class has one, else from the whole implementation
export function readSeeds(source, attributes) {
  const mask = maskSource(source);
  const impl = /\bCLASS\s+\S+\s+IMPLEMENTATION\s*\./i.exec(mask);
  let from = impl ? impl.index : 0;
  let to = mask.length;
  const init = /\bMETHOD\s+model_init\s*\./i.exec(mask.slice(from));
  if (init) {
    from += init.index + init[0].length;
    const end = /\bENDMETHOD\s*\./i.exec(mask.slice(from));
    if (end) to = from + end.index;
  }
  const byName = new Map(attributes.map((a) => [a.name, a]));
  const notes = [];
  // the 7.02 form of the rows: fields set on a work area, the work area
  // APPENDed to the table (or to a table field of an outer work area),
  // CLEARed for the next row - kept as operands until the APPEND to the
  // attribute says which fields, and so which types, they are
  const work = new Map();
  const workArea = (name) => { if (!work.has(name)) work.set(name, {}); return work.get(name); };
  for (const st of statementsOf(mask, from, to)) {
    const text = mask.slice(st.start, st.end);
    const field = /^\s*(\w+)-(\w+)\s*=(?!=)/.exec(text);
    if (field && !byName.has(field[1].toLowerCase())) {
      workArea(field[1].toLowerCase())[field[2].toUpperCase()] = source.slice(st.start + field[0].length, st.end - 1);
      continue;
    }
    const append = /^\s*APPEND\s+(\w+)\s+TO\s+(?:me->)?(\w+)(?:-(\w+))?\s*\.$/i.exec(text);
    if (append) {
      const row = workArea(append[1].toLowerCase());
      const target = append[2].toLowerCase();
      const attr = byName.get(target);
      if (attr && !append[3] && attr.type === 'table') {
        if (!attr.appended) { attr.rows = []; attr.appended = true; }
        attr.rows.push(workRow(row, attr.fields, attr.name, notes));
      } else if (!attr && append[3]) {
        const outer = workArea(target);
        const key = append[3].toUpperCase();
        if (!Array.isArray(outer[key])) outer[key] = [];
        outer[key].push(row);
      }
      work.set(append[1].toLowerCase(), {});
      continue;
    }
    const clear = /^\s*CLEAR\s+(\w+)\s*\.$/i.exec(text);
    if (clear && !byName.has(clear[1].toLowerCase())) { work.set(clear[1].toLowerCase(), {}); continue; }
    const m = /^\s*(?:me->)?(\w+)\s*=(?!=)/.exec(text);
    if (!m) continue;
    const attr = byName.get(m[1].toLowerCase());
    if (!attr || attr.seeded) continue;
    const valueAt = st.start + m[0].length;
    const valueEnd = st.end - 1;
    if (attr.type !== 'table') {
      const v = seedValue(attr.type, source.slice(valueAt, valueEnd));
      if (v === undefined) notes.push(`${attr.name}: its value is not a literal, the sample value stays empty`);
      else attr.value = v;
    } else {
      const rows = valueRows(mask, source, valueAt, valueEnd, attr.fields, attr.name, notes);
      if (rows) attr.rows = rows;
    }
    attr.seeded = true;
  }
  for (const a of attributes) { delete a.seeded; delete a.appended; }
  return notes;
}

// a work area of the 7.02 form (field -> operand, or -> the work areas
// APPENDed to that table field) as a row of the data panel
function workRow(area, fields, where, notes) {
  const row = {};
  for (const [name, value] of Object.entries(area)) {
    const field = (fields || []).find((f) => f.name === name);
    if (!field) { notes.push(`${where}-${name}: no such field`); continue; }
    if (Array.isArray(value)) {
      if (field.type === 'table') row[name] = value.map((sub) => workRow(sub, field.fields, `${where}-${name}`, notes));
      else notes.push(`${where}-${name}: not a table field, its value is left out`);
      continue;
    }
    if (field.type === 'table') { notes.push(`${where}-${name}: a table field set to a value, left out`); continue; }
    const v = seedValue(field.type, value);
    if (v === undefined) notes.push(`${where}-${name}: not a literal, left empty`);
    else row[name] = v;
  }
  return row;
}

// VALUE #( ( a = 1 b = `x` ) ( ... ) ) -> rows; a field that is itself a
// VALUE #( ) is a nested table
function valueRows(mask, source, from, to, fields, where, notes) {
  const head = /^\s*VALUE\s+(?:#|\w+)\s*\(/i.exec(mask.slice(from, to));
  if (!head) { notes.push(`${where}: its rows are not a VALUE #( ) of literals, the sample rows stay empty`); return null; }
  const open = from + head[0].length - 1;
  const close = closingParen(mask, open, to + 1);
  if (close < 0) return null;
  const rows = [];
  let at = open + 1;
  while (at < close) {
    if (mask[at] === '(') {
      const rc = closingParen(mask, at, close);
      if (rc < 0) break;
      rows.push(rowOf(at + 1, rc));
      at = rc + 1;
    } else if (/\s/.test(mask[at])) at += 1;
    else {
      // `LET`, `BASE`, a `FOR` - not a row
      notes.push(`${where}: the VALUE #( ) has more than rows of literals, that part is left out`);
      break;
    }
  }
  return rows;

  function rowOf(a, b) {
    const row = {};
    let p = a;
    while (p < b) {
      const m = /^\s*(\w+)\s*=(?!=)\s*/.exec(mask.slice(p, b));
      if (!m) break;
      const fieldName = m[1].toUpperCase();
      p += m[0].length;
      const field = fields.find((f) => f.name === fieldName);
      let end;
      if (/^VALUE\s+(?:#|\w+)\s*\(/i.test(mask.slice(p, b))) {
        const o = mask.indexOf('(', p);
        end = closingParen(mask, o, b) + 1;
        if (field && field.type === 'table') row[fieldName] = valueRows(mask, source, p, end, field.fields || [], `${where}-${fieldName}`, notes) || [];
        else notes.push(`${where}-${fieldName}: not a table field, its value is left out`);
      } else {
        // the operand runs up to the next `name =` at this level or the end
        const next = /\s\w+\s*=(?!=)/.exec(mask.slice(p, b));
        end = next ? p + next.index : b;
        if (field && field.type !== 'table') {
          const v = seedValue(field.type, source.slice(p, end));
          if (v === undefined) notes.push(`${where}-${fieldName}: not a literal, left empty`);
          else row[fieldName] = v;
        } else if (!field) notes.push(`${where}-${fieldName}: no such field`);
      }
      p = end;
    }
    return row;
  }
}

// ------------------------------------------------------------- the import

// The design an app class describes, and what the import could not take
// along. `base` is the design the result starts from (its className is
// replaced, its description emptied, its attributes are those of the class).
export function fromClass(source, base) {
  const src = String(source).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const chain = readViewChain(src);
  if (!chain.ok) throw new Error(chain.why);
  if (chain.root.name !== 'View' || chain.root.ns !== 'mvc') throw new Error(`The chain builds ${chain.root.ns ? `${chain.root.ns}:` : ''}${chain.root.name}, not an mvc:View - the editor edits views (a popup or fragment is not one).`);
  const pub = readPublicSection(src);
  if (!pub) throw new Error('No class definition with a PUBLIC SECTION in this source.');
  const nameM = /\bCLASS\s+(\S+)\s+DEFINITION\b/i.exec(maskSource(src));
  const design = base;
  design.className = nameM[1].toUpperCase();
  // the description is the abapGit sidecar's, which a .clas.abap does not carry
  design.description = '';
  design.attributes = pub.attributes;
  // a class without inline declarations that declares its builder is
  // the 7.02 form (src/abap.js) - and stays 7.02 when it is generated anew
  const masked = maskSource(src);
  design.release = /\bDATA\s+view\s+TYPE\s+REF\s+TO\s+z2ui5_cl_ui5_view_builder\b/i.test(masked) && !/\bDATA\s*\(/i.test(masked) ? '702' : '';
  const seedNotes = readSeeds(src, design.attributes);
  const dropped = [];
  const raws = [];
  const xml = chainToXml(chain.root, raws, dropped);
  const rawById = {};
  fromXml(xml, design, {
    events: true,
    onNode: (el, node) => { if (el.attrs[RAW_MARK] !== undefined) rawById[node.id] = raws[Number(el.attrs[RAW_MARK])].attrs; },
  });
  const kept = raws.flatMap((r) => r.attrs.map((a) => ({ control: r.control, attr: a.name, abap: a.abap })));
  const report = { ...importReport(), kept, dropped, seeds: seedNotes, skipped: pub.skipped };
  design.abap = {
    source: src,
    chain: { start: chain.start, end: chain.end, indent: chain.indent, variable: chain.variable },
    declared: pub.declared,
    insertAt: pub.insertAt,
    raw: rawById,
  };
  lastClassReport = report;
  return design;
}

let lastClassReport = null;

// What the last fromClass( ) left out: the view's report (fromXml) plus
//   kept:    [{ control, attr, abap }]   attributes the editor cannot edit, kept as raw ABAP and written back
//   dropped: [{ control, attr, abap }]   attributes of the View the generator writes on its own - not written back
//   skipped: [{ name, type }]            public attributes of a type the data panel has not
//   seeds:   [text]                      sample values that were not literals
export function classReport() {
  return lastClassReport;
}

// ------------------------------------------------------------- the export

// where a new attribute's declaration goes and what it says
function declarations(attrs) {
  const L = [];
  for (const t of attrs.filter((a) => a.type === 'table')) {
    for (const ty of tableTypes(t)) {
      L.push('    TYPES:');
      L.push(`      BEGIN OF ${ty.name},`);
      const w = Math.max(...ty.fields.map((f) => f.name.length));
      for (const f of ty.fields) L.push(`        ${f.name.toLowerCase().padEnd(w)} TYPE ${f.type === 'table' ? `STANDARD TABLE OF ${typeName(t, [...ty.path, f.name])} WITH EMPTY KEY` : abapType(f.type)},`);
      L.push(`      END OF ${ty.name}.`);
    }
    L.push(`    DATA ${t.name} TYPE STANDARD TABLE OF ${typeName(t)} WITH EMPTY KEY.`);
  }
  for (const a of attrs.filter((a) => a.type !== 'table')) L.push(`    DATA ${a.name} TYPE ${abapType(a.type)}.`);
  return L;
}

// the WHEN branch for an event the class does not handle yet, placed in the
// CASE client->get_event( ) before WHEN OTHERS, else before ENDCASE
function placeEvents(source, events) {
  const mask = maskSource(source);
  const caseM = /\bCASE\s+client->get_event\(\s*\)\s*\./i.exec(mask);
  if (!caseM) return { source, unplaced: events };
  const endM = /\bENDCASE\s*\./i.exec(mask.slice(caseM.index));
  if (!endM) return { source, unplaced: events };
  const region = source.slice(caseM.index, caseM.index + endM.index);
  const whenM = /\n([ \t]*)WHEN\s+OTHERS\b/i.exec(region);
  const whens = [...region.matchAll(/\n([ \t]*)WHEN\b/gi)];
  const indent = whenM ? whenM[1] : whens.length ? whens[0][1] : ' '.repeat((/\n(\s*)$/.exec(source.slice(0, caseM.index)) || ['', ''])[1].length + 2);
  // the start of the line of WHEN OTHERS / ENDCASE, so its indentation stays its own
  const at = whenM ? caseM.index + whenM.index + 1 : source.lastIndexOf('\n', caseM.index + endM.index - 1) + 1;
  const lines = events.flatMap((ev) => [`${indent}WHEN ${abapString(ev)}.`, `${indent}  client->message_toast_display( ${abapString(`${ev} - implement me in on_event`)} ).`]);
  return { source: source.slice(0, at) + lines.join('\n') + '\n' + source.slice(at), unplaced: [] };
}

// The class of a design: generated when the design was drawn here, the
// imported class with the regenerated chain when it came from one. With
// nodeIds per line (the code view's link to the canvas) and `notes` on what
// the patch could not place
export function classSource(design) {
  if (!design.abap || !design.abap.source) return { ...generateClassMap(design), notes: [] };
  const { source: orig, chain, declared, insertAt } = design.abap;
  const notes = [];
  // 1. the chain, in the house layout, over the range the old one occupied -
  // the raw attributes generated as placeholder literals, then swapped for
  // their ABAP (the `v =` column depends on the names only)
  const { design: withRaw, swaps } = rawPlaceholders(design);
  const lines = viewChain(withRaw, chain.indent);
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/\bv = `__le_raw_(\d+)__`/g, (m, n) => `${swaps[n].key} = ${swaps[n].abap}`);
  }
  if (chain.variable && chain.variable !== 'view') lines[0] = lines[0].replace(/^(\s*)DATA\(view\)/, `$1DATA(${chain.variable})`);
  const chainText = lines.join('\n');
  let out = orig.slice(0, chain.start) + chainText + orig.slice(chain.end);
  let chainLine = orig.slice(0, chain.start).split('\n').length - 1;
  // 2. attributes the editor added, declared at the end of the PUBLIC SECTION
  const known = new Set((declared || []).map((n) => n.toLowerCase()));
  const added = design.attributes.filter((a) => !known.has(a.name.toLowerCase()));
  if (added.length && insertAt != null && insertAt <= chain.start) {
    const decl = declarations(added);
    const before = out.slice(0, insertAt);
    const blankBefore = /\n\n$/.test(before) || before === '';
    const text = (blankBefore ? '' : '\n') + decl.join('\n') + '\n\n';
    out = before + text + out.slice(insertAt);
    chainLine += text.split('\n').length - 1;
  } else if (added.length) {
    notes.push(`${added.length} attribute(s) could not be declared - add them to the PUBLIC SECTION by hand: ${added.map((a) => a.name).join(', ')}`);
  }
  // 3. events without a WHEN branch
  const handled = new Set();
  const mask = maskSource(orig);
  for (const m of orig.matchAll(/\bWHEN\s+([`'])([A-Za-z0-9_]+)\1/gi)) if (mask[m.index] === 'W') handled.add(m[2]);
  for (const m of orig.matchAll(/check_on_event\(\s*([`'])([A-Za-z0-9_]+)\1\s*\)/gi)) handled.add(m[2]);
  const newEvents = collectEvents(design).filter((e) => !handled.has(e));
  if (newEvents.length) {
    const placed = placeEvents(out, newEvents);
    if (placed.unplaced.length) notes.push(`${placed.unplaced.length} event(s) have no on_event branch - the class has no CASE client->get_event( ) to put one in: ${placed.unplaced.join(', ')}`);
    else {
      const chainOffset = out.split('\n').slice(0, chainLine).join('\n').length;
      const insertedBefore = placed.source.length !== out.length && placed.source.slice(0, chainOffset) !== out.slice(0, chainOffset);
      if (insertedBefore) chainLine += placed.source.split('\n').length - out.split('\n').length;
    }
    out = placed.source;
  }
  if (!out.endsWith('\n')) out += '\n';
  const total = out.split('\n').length;
  const nodeIds = new Array(total).fill(null);
  lines.nodeIds.forEach((id, i) => { nodeIds[chainLine + i] = id; });
  return { source: out, nodeIds, notes };
}

// The design with each kept raw attribute as an expression the generator
// writes as a literal `__le_raw_N__` - on the node it was read with, when
// that node is still there and the editor does not set the attribute itself
function rawPlaceholders(design) {
  const raw = (design.abap && design.abap.raw) || {};
  const swaps = [];
  if (!Object.keys(raw).length) return { design, swaps };
  const copy = clone(design);
  walk(copy.root, (n) => {
    for (const a of raw[n.id] || []) {
      if (isSetValue(n.props[a.name]) || (n.events && n.events[a.name])) continue;
      n.props[a.name] = { m: 'x', v: `__le_raw_${swaps.length}__` };
      swaps.push(a);
    }
    return true;
  });
  return { design: copy, swaps };
}

export function generateClassSource(design) {
  return classSource(design).source;
}

// the abapGit files, with the imported class where the design came from one
export function classFiles(design) {
  const files = abapGitFiles(design);
  files[`src/${fileName(design.className, 'clas.abap')}`] = generateClassSource(design);
  return files;
}

// ------------------------------------------------------------- where a class comes from

const RAW_HOSTS = ['raw.githubusercontent.com', 'gist.githubusercontent.com'];

// The URL a class may be fetched from: this site, or GitHub's raw hosts; a
// github.com page URL (blob/raw) is translated to the raw host. Throws for
// anything else - the editor fetches on behalf of whoever opened the link
export function sourceUrl(raw, origin) {
  let url;
  try { url = new URL(raw, origin); } catch { throw new Error(`${raw} is not a URL`); }
  if (url.username || url.password) throw new Error('A link to a class carries no user name or password');
  if (url.hostname === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(url.pathname);
    if (m) url = new URL(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`);
  }
  if (origin && url.origin === new URL(origin).origin) return url.href;
  if (url.protocol === 'https:' && RAW_HOSTS.includes(url.hostname)) return url.href;
  throw new Error(`Classes are opened from ${RAW_HOSTS.join(' or ')} or from this site - not from ${url.hostname || url.protocol}`);
}

// ?class=zcl_my_app&repo=owner/repo[&ref=main][&path=src] -> the raw URL
export function repoClassUrl(className, repo, ref = 'main', path = 'src') {
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(String(repo || '').trim());
  if (!m) throw new Error(`${repo} is not owner/repo`);
  if (!/^[A-Za-z0-9_/]+$/.test(className || '')) throw new Error(`${className} is not a class name`);
  const dir = String(path || '').replace(/^\/+|\/+$/g, '');
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${encodeURIComponent(ref)}/${dir ? `${dir}/` : ''}${fileName(className, 'clas.abap')}`;
}
