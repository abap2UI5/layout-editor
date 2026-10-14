// Design -> abap2UI5 app class.
//
// The class follows the canonical template of abap2UI5's app guide
// (docs/agents/building-apps.md in abap2UI5/abap2UI5): one class
// implementing z2ui5_if_app, main( ) as the ONE IF/ELSEIF dispatcher,
// bound data in the PUBLIC SECTION, view_display / on_event / model_init
// in call order and the last two only when the app has events / data.
// The view is one z2ui5_cl_ui5_view_builder chain in the house layout
// (the view-chain-layout rules): one call per line, four spaces per tree
// level, end( ) in the column of the ele( ) it closes, the v = column
// aligned across an attribute block.

import { NAMESPACES, splitType } from './catalog.js';
import { aggNames, collectEvents, typeName, isDirectAgg } from './model.js';
import { usedNamespaces, namespaceUri } from './xml.js';

const MAX_LINE = 255;

// ------------------------------------------------------------- literals

export function abapString(s) {
  const str = String(s ?? '');
  if (/[\n\r\t]/.test(str)) {
    return `|${str.replace(/[\\|{}]/g, '\\$&').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}|`;
  }
  return '`' + str.replace(/`/g, '``') + '`';
}

// a long literal split into pieces joined with &&, so no line passes 255
function abapStringPieces(s, width) {
  const str = String(s ?? '');
  if (str.length <= width || /[\n\r\t]/.test(str)) return [abapString(str)];
  const parts = [];
  for (let i = 0; i < str.length; i += width) parts.push(abapString(str.slice(i, i + width)));
  return parts;
}

export function abapType(type) {
  switch (type) {
    case 'string': return 'string';
    case 'int': return 'i';
    case 'decimal': return 'p LENGTH 16 DECIMALS 2';
    case 'bool': return 'abap_bool';
    case 'date': return 'd';
    case 'time': return 't';
    default: throw new Error(`no ABAP type for ${type}`);
  }
}

// a seed value as an ABAP operand, or null when it is the initial value
export function abapValue(type, v) {
  if (v === undefined || v === null || v === '') return null;
  switch (type) {
    case 'string': return abapString(v);
    case 'int': {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n !== 0 ? String(n) : null;
    }
    case 'decimal': {
      const t = String(v).trim();
      if (!/^-?\d+(\.\d+)?$/.test(t) || Number(t) === 0) return null;
      return `'${t}'`;
    }
    case 'bool': return v === true || v === 'true' || v === 'X' ? 'abap_true' : null;
    case 'date': {
      const d = String(v).replace(/-/g, '');
      return /^\d{8}$/.test(d) && d !== '00000000' ? `'${d}'` : null;
    }
    case 'time': {
      const t = String(v).replace(/:/g, '');
      return /^\d{6}$/.test(t) && t !== '000000' ? `'${t}'` : /^\d{4}$/.test(t) ? `'${t}00'` : null;
    }
    default: return null;
  }
}

export function fileName(className, ext) {
  return `${className.toLowerCase().replace(/\//g, '#')}.${ext}`;
}

// ------------------------------------------------------------- the view

function attrExpr(value) {
  switch (value.m) {
    case 's': {
      const s = String(value.v ?? '');
      return { p: /[{}\\]/.test(s) ? 't' : 'v', pieces: abapStringPieces(s, 120) };
    }
    case 'b': return { p: 'v', pieces: [`client->_bind( ${value.v} )`] };
    case 'f': return { p: 'v', pieces: [abapString(`{${value.v}}`)] };
    case 'x': return { p: 'v', pieces: abapStringPieces(value.v, 120) };
    default: throw new Error(`unknown value mode ${value.m}`);
  }
}

function eleCall(verb, name, ns) {
  return ns ? `${verb}( n = ${abapString(name)} ns = ${abapString(ns)}` : `${verb}( ${abapString(name)}`;
}

// The view_display body: the chain lines, without the method frame
export function viewChain(design, indent = 4) {
  const out = []; // { text, kind: 'ele'|'tag'|'a'|'end'|'start', blank }
  const base = indent + 4;
  out.push({ text: `${' '.repeat(indent)}DATA(view) = z2ui5_cl_ui5_view_builder=>factory(`, kind: 'start' });

  // the mvc:View root with its namespace declarations
  const viewAttrs = usedNamespaces(design).map((ns) => [ns ? `xmlns:${ns}` : 'xmlns', attrExpr({ m: 's', v: namespaceUri(design, ns) })]);
  viewAttrs.push(['displayBlock', attrExpr({ m: 's', v: 'true' })], ['height', attrExpr({ m: 's', v: '100%' })]);
  out.push({ text: `${' '.repeat(base)})->${eleCall('ele', 'View', 'mvc')}`, kind: 'ele' });
  pushAttrs(viewAttrs, base + 4);
  emitChildren([['content', design.root.aggs.content || [], true]], base, true);

  // a trailing end( ) can go: stringify( ) renders from the root anyway
  while (out.length && out[out.length - 1].kind === 'end') out.pop();
  const lines = [];
  for (const seg of out) {
    if (seg.blank) lines.push('');
    lines.push(seg.text);
  }
  lines[lines.length - 1] += ' ).';
  return lines;

  function pushAttrs(attrs, col) {
    if (!attrs.length) return;
    const width = Math.max(...attrs.map(([n]) => abapString(n).length));
    for (const [n, expr] of attrs) {
      const head = `${' '.repeat(col)})->a( n = ${abapString(n).padEnd(width)} ${expr.p} = `;
      const [first, ...rest] = expr.pieces;
      out.push({ text: head + first, kind: 'a' });
      for (const piece of rest) out.push({ text: `${' '.repeat(head.length - 3)}&& ${piece}`, kind: 'a' });
    }
  }

  function nodeAttrs(node) {
    const attrs = [];
    for (const [name, value] of Object.entries(node.props || {})) {
      if (!value || (value.m === 's' && (value.v === '' || value.v == null))) continue;
      if ((value.m === 'b' || value.m === 'f' || value.m === 'x') && !value.v) continue;
      attrs.push([name, attrExpr(value)]);
    }
    for (const [ev, name] of Object.entries(node.events || {})) {
      if (name) attrs.push([ev, { p: 'v', pieces: [`client->_event( ${abapString(name)} )`] }]);
    }
    return attrs;
  }

  function hasChildren(node) {
    return aggNames(node).some((a) => (node.aggs[a] || []).length);
  }

  // groups: [aggName, children, direct][]; col: the column of the parent
  function emitChildren(groups, parentCol, parentHasAttrs) {
    let prev = null;
    for (const [agg, children, direct, parentNs] of groups) {
      if (!children.length) continue;
      if (direct) {
        for (const ch of children) prev = emitNode(ch, parentCol + 4, prev, parentHasAttrs);
      } else {
        const col = parentCol + 4;
        out.push({ text: `${' '.repeat(col)})->${eleCall('ele', agg, parentNs)}`, kind: 'ele', blank: blankBeforeEle(prev, parentHasAttrs) });
        let p2 = null;
        for (const ch of children) p2 = emitNode(ch, col + 4, p2, false);
        pushEnd(col);
        prev = 'ele';
      }
    }
  }

  function emitNode(node, col, prev, parentHasAttrs) {
    const { ns, name } = splitType(node.type);
    const attrs = nodeAttrs(node);
    if (!hasChildren(node)) {
      out.push({ text: `${' '.repeat(col)})->${eleCall('tag', name, ns)}`, kind: 'tag', blank: prev !== 'tag' });
      pushAttrs(attrs, col + 4);
      return 'tag';
    }
    out.push({ text: `${' '.repeat(col)})->${eleCall('ele', name, ns)}`, kind: 'ele', blank: blankBeforeEle(prev, parentHasAttrs) });
    pushAttrs(attrs, col + 4);
    const groups = aggNames(node).map((a) => [a, node.aggs[a] || [], isDirectAgg(node, a), ns]);
    emitChildren(groups, col, attrs.length > 0);
    pushEnd(col);
    return 'ele';
  }

  function blankBeforeEle(prev, parentHasAttrs) {
    return (prev === null && parentHasAttrs) || prev === 'tag';
  }

  function pushEnd(col) {
    const last = out[out.length - 1];
    out.push({ text: `${' '.repeat(col)})->end(`, kind: 'end', blank: last.kind !== 'end' });
  }
}

// ------------------------------------------------------------- the class

function aligned(rows, indent) {
  // rows: [left, right] -> `left<pad> right`
  const w = Math.max(...rows.map(([l]) => l.length));
  return rows.map(([l, r]) => `${' '.repeat(indent)}${l.padEnd(w)} ${r}`);
}

const INITIAL = { string: '``', int: '0', decimal: '0', bool: 'abap_false', date: `'00000000'`, time: `'000000'` };

function seedTable(attr) {
  // a field that is set in any row is written in every row (its initial
  // value where a row leaves it empty), so all rows share one shape and the
  // columns line up; a field no row sets is left out
  const used = attr.fields.filter((f) => (attr.rows || []).some((r) => abapValue(f.type, r[f.name]) !== null));
  const rows = (attr.rows || []).map((r) => used.map((f) => [f.name.toLowerCase(), abapValue(f.type, r[f.name]) ?? INITIAL[f.type]]));
  const nonEmpty = rows.filter((r) => r.length);
  if (!nonEmpty.length) return [];
  const sameShape = nonEmpty.every((r) => r.map(([n]) => n).join() === nonEmpty[0].map(([n]) => n).join());
  const cellText = (n, v) => `${n} = ${v}`;
  let rendered;
  if (sameShape && nonEmpty.length > 1) {
    const cols = nonEmpty[0].length;
    const widths = [];
    for (let i = 0; i < cols; i++) widths[i] = Math.max(...nonEmpty.map((r) => cellText(...r[i]).length));
    rendered = nonEmpty.map((r) => `( ${r.map((cell, i) => (i < cols - 1 ? cellText(...cell).padEnd(widths[i]) : cellText(...cell))).join(' ')} )`);
  } else {
    rendered = nonEmpty.map((r) => `( ${r.map((cell) => cellText(...cell)).join(' ')} )`);
  }
  const head = `    ${attr.name} = VALUE #(`;
  if (rendered.length === 1 && head.length + rendered[0].length + 4 <= MAX_LINE) return [`${head} ${rendered[0]} ).`];
  const lines = [head];
  rendered.forEach((row, i) => {
    const tail = i === rendered.length - 1 ? ' ).' : '';
    if (8 + row.length + tail.length <= MAX_LINE) {
      lines.push(`        ${row}${tail}`);
    } else {
      // too wide for one line: one field per line, names aligned
      const cells = nonEmpty[i];
      const w = Math.max(...cells.map(([n]) => n.length));
      cells.forEach(([n, v], j) => {
        const pre = j === 0 ? '( ' : '  ';
        const post = j === cells.length - 1 ? ` )${tail}` : '';
        lines.push(`        ${pre}${n.padEnd(w)} = ${v}${post}`);
      });
    }
  });
  return lines;
}

export function generateClass(design) {
  const cls = design.className.toLowerCase();
  const events = collectEvents(design);
  const tables = design.attributes.filter((a) => a.type === 'table');
  const scalars = design.attributes.filter((a) => a.type !== 'table');

  const seed = [];
  for (const a of scalars) {
    const v = abapValue(a.type, a.value);
    if (v !== null) seed.push(`    ${a.name} = ${v}.`);
  }
  for (const t of tables) seed.push(...seedTable(t));
  const hasInit = seed.length > 0;
  const hasEvents = events.length > 0;

  const L = [];
  L.push(`CLASS ${cls} DEFINITION PUBLIC.`);
  L.push('');
  L.push('  PUBLIC SECTION.');
  L.push('    INTERFACES z2ui5_if_app.');
  if (design.attributes.length) L.push('');
  for (const t of tables) {
    L.push('    TYPES:');
    L.push(`      BEGIN OF ${typeName(t)},`);
    L.push(...aligned(t.fields.map((f) => [f.name.toLowerCase(), `TYPE ${abapType(f.type)},`]), 8));
    L.push(`      END OF ${typeName(t)}.`);
  }
  const dataRows = [
    ...tables.map((t) => [`DATA ${t.name}`, `TYPE STANDARD TABLE OF ${typeName(t)} WITH EMPTY KEY.`]),
    ...scalars.map((a) => [`DATA ${a.name}`, `TYPE ${abapType(a.type)}.`]),
  ];
  if (dataRows.length) L.push(...aligned(dataRows, 4));
  L.push('');
  L.push('  PROTECTED SECTION.');
  L.push('    DATA client TYPE REF TO z2ui5_if_client.');
  L.push('    METHODS view_display.');
  if (hasEvents) L.push('    METHODS on_event.');
  if (hasInit) L.push('    METHODS model_init.');
  L.push('');
  L.push('  PRIVATE SECTION.');
  L.push('ENDCLASS.');
  L.push('');
  L.push('');
  L.push(`CLASS ${cls} IMPLEMENTATION.`);
  L.push('');
  L.push('  METHOD z2ui5_if_app~main.');
  L.push('');
  L.push('    me->client = client.');
  if (hasInit) {
    L.push('    IF client->check_on_init( ).');
    L.push('      model_init( ).');
    L.push('      view_display( ).');
    L.push('    ELSEIF client->check_on_navigated( ).');
  } else {
    L.push('    IF client->check_on_navigated( ).');
  }
  L.push('      view_display( ).');
  if (hasEvents) {
    L.push('    ELSEIF client->check_on_event( ).');
    L.push('      on_event( ).');
  }
  L.push('    ENDIF.');
  L.push('');
  L.push('  ENDMETHOD.');
  L.push('');
  L.push('  METHOD view_display.');
  L.push('');
  L.push(...viewChain(design, 4));
  L.push('');
  L.push('    client->view_display( view->stringify( ) ).');
  L.push('');
  L.push('  ENDMETHOD.');
  if (hasEvents) {
    L.push('');
    L.push('  METHOD on_event.');
    L.push('');
    L.push('    CASE client->get_event( ).');
    for (const ev of events) {
      L.push(`      WHEN ${abapString(ev)}.`);
      L.push(`        client->message_toast_display( ${abapString(`${ev} - implement me in on_event`)} ).`);
    }
    L.push('    ENDCASE.');
    L.push('');
    L.push('  ENDMETHOD.');
  }
  if (hasInit) {
    L.push('');
    L.push('  METHOD model_init.');
    L.push('');
    L.push(...seed);
    L.push('');
    L.push('  ENDMETHOD.');
  }
  L.push('');
  L.push('ENDCLASS.');
  return L.map((l) => l.replace(/\s+$/, '')).join('\n') + '\n';
}

// ------------------------------------------------------------- abapGit files

function xmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
}

// The .clas.xml abapGit writes: with the BOM, LF line ends and a final
// newline - anything else comes back as a diff on the first pull
export function generateClassXml(design) {
  const desc = (design.description || design.className).slice(0, 60);
  return '﻿' + [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">',
    ' <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">',
    '  <asx:values>',
    '   <VSEOCLASS>',
    `    <CLSNAME>${xmlText(design.className)}</CLSNAME>`,
    '    <LANGU>E</LANGU>',
    `    <DESCRIPT>${xmlText(desc)}</DESCRIPT>`,
    '    <STATE>1</STATE>',
    '    <CLSCCINCL>X</CLSCCINCL>',
    '    <FIXPT>X</FIXPT>',
    '    <UNICODE>X</UNICODE>',
    '   </VSEOCLASS>',
    '  </asx:values>',
    ' </asx:abap>',
    '</abapGit>',
  ].join('\n') + '\n';
}

export function generateAbapGitXml() {
  return '﻿' + [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">',
    ' <asx:values>',
    '  <DATA>',
    '   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>',
    '   <STARTING_FOLDER>/src/</STARTING_FOLDER>',
    '   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>',
    '  </DATA>',
    ' </asx:values>',
    '</asx:abap>',
  ].join('\n') + '\n';
}

export function generatePackageXml(text) {
  return '﻿' + [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">',
    ' <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">',
    '  <asx:values>',
    '   <DEVC>',
    `    <CTEXT>${xmlText(String(text).slice(0, 60))}</CTEXT>`,
    '   </DEVC>',
    '  </asx:values>',
    ' </asx:abap>',
    '</abapGit>',
  ].join('\n') + '\n';
}

// Everything an abapGit offline repository needs for the class, by path
export function abapGitFiles(design) {
  return {
    '.abapgit.xml': generateAbapGitXml(),
    'src/package.devc.xml': generatePackageXml(design.description || design.className),
    [`src/${fileName(design.className, 'clas.abap')}`]: generateClass(design),
    [`src/${fileName(design.className, 'clas.xml')}`]: generateClassXml(design),
  };
}

export { NAMESPACES };
