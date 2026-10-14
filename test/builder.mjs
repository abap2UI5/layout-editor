// A JS model of z2ui5_cl_ui5_view_builder, reading the chain the designer
// generates as text: ele( ) descends, tag( ) stays, a( ) lands on the
// element the chain points at (the last child, or the node itself while it
// has none), end( ) ascends, and the view renders from the root. Enough of
// ABAP to evaluate what the generator writes into a( ): backtick literals
// joined with &&, string templates, client->_bind( ) and client->_event( ).
import { escapeBindingLiteral, escapeXml } from '../src/xml.js';

function evalExpr(src) {
  const s = src.trim();
  const parts = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (s.startsWith('&&', i)) { i += 2; continue; }
    if (ch === '`') {
      let j = i + 1;
      let out = '';
      for (;;) {
        if (j >= s.length) throw new Error(`unterminated literal: ${s}`);
        if (s[j] === '`' && s[j + 1] === '`') { out += '`'; j += 2; continue; }
        if (s[j] === '`') break;
        out += s[j++];
      }
      parts.push(out);
      i = j + 1;
      continue;
    }
    if (ch === '|') {
      let j = i + 1;
      let out = '';
      while (s[j] !== '|') {
        if (s[j] === '\\') { const e = s[j + 1]; out += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e; j += 2; continue; }
        if (s[j] === '{') {
          // an embedded expression: the path of a binding
          const close = s.indexOf('}', j);
          const inner = s.slice(j + 1, close).trim();
          const b = /^client->_bind\( val = (\w+) path = abap_true \)$/.exec(inner);
          if (!b) throw new Error(`embedded expression in template: ${inner}`);
          out += `/${b[1].toUpperCase()}`;
          j = close + 1;
          continue;
        }
        out += s[j++];
      }
      parts.push(out);
      i = j + 1;
      continue;
    }
    let m = /^client->_bind\( (\w+) \)/.exec(s.slice(i));
    if (m) { parts.push(`{/${m[1].toUpperCase()}}`); i += m[0].length; continue; }
    m = /^client->_event\( `([A-Z0-9_]+)` \)/.exec(s.slice(i));
    if (m) { parts.push(`.onEvent('${m[1]}')`); i += m[0].length; continue; }
    throw new Error(`cannot evaluate: ${s.slice(i)}`);
  }
  return parts.join('');
}

function parseArgs(verb, args) {
  if (verb === 'end') return {};
  if (verb === 'a') {
    const m = /^\s*n = `([^`]*)`\s+([vtb]) = ([\s\S]*)$/.exec(args);
    if (!m) throw new Error(`a( ) without n and v/t/b: ${args}`);
    let v = evalExpr(m[3]);
    if (m[2] === 't') v = escapeBindingLiteral(v);
    if (m[2] === 'b') throw new Error('b = is not generated');
    return { n: m[1], v };
  }
  let m = /^\s*`([^`]*)`\s*$/.exec(args);
  if (m) return { n: m[1], ns: '' };
  m = /^\s*n = `([^`]*)` ns = `([^`]*)`\s*$/.exec(args);
  if (m) return { n: m[1], ns: m[2] };
  throw new Error(`${verb}( ) arguments: ${args}`);
}

export function builderXml(chainSource) {
  const start = chainSource.indexOf('factory(');
  if (start < 0) throw new Error('no factory( )');
  let body = chainSource.slice(start + 'factory('.length).trim();
  if (!body.endsWith(').')) throw new Error('the chain does not end in ).');
  body = body.slice(0, -2);
  const segs = body.split(/\)->/).slice(1);
  const root = { name: '', attrs: [], children: [], parent: null };
  let cur = root;
  for (const seg of segs) {
    const m = /^(ele|tag|a|end)\(([\s\S]*)$/.exec(seg.trim());
    if (!m) throw new Error(`unknown call: ${seg}`);
    const [, verb, rawArgs] = m;
    const args = parseArgs(verb, rawArgs.replace(/\s+$/, ''));
    if (verb === 'ele' || verb === 'tag') {
      const el = { name: args.ns ? `${args.ns}:${args.n}` : args.n, attrs: [], children: [], parent: cur };
      cur.children.push(el);
      if (verb === 'ele') cur = el;
    } else if (verb === 'a') {
      const target = cur.children.length ? cur.children[cur.children.length - 1] : cur;
      target.attrs.push([args.n, args.v]);
    } else {
      if (!cur.parent) throw new Error('end( ) above the root');
      cur = cur.parent;
    }
  }
  const render = (el) => {
    const attrs = el.attrs.map(([n, v]) => ` ${n}="${escapeXml(v)}"`).join('');
    if (!el.children.length) return `<${el.name}${attrs}/>`;
    return `<${el.name}${attrs}>${el.children.map(render).join('')}</${el.name}>`;
  };
  return root.children.map(render).join('');
}
