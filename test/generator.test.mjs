// The generated class, checked without an SAP system: its file format (what
// abapGit and the 255-character limit need), its shape (the app guide's
// template), and - through a JS model of z2ui5_cl_ui5_view_builder - that
// its chain builds exactly the view the designer shows. tools/verify-abap.mjs
// does the last part for real, on the transpiled abap2UI5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { allDesigns, allDesigns702, kitchenSink } from './fixtures.mjs';
import { generateClass, generateClassXml, abapGitFiles, viewChain, abapString, releaseOf } from '../src/abap.js';
import { toXml, fromXml, escapeBindingLiteral } from '../src/xml.js';
import { validate, clone, walk, createDesign, createNode, insertNode } from '../src/model.js';
import { zip, crc32 } from '../src/zip.js';
import { builderXml } from './builder.mjs';

const flat = (xml) => xml.replace(/>\s+</g, '><');

for (const [id, design] of [...allDesigns(), ...allDesigns702()]) {
  test(`${id}: the design has no problems`, () => {
    assert.deepEqual(validate(design).filter((i) => i.level !== 'info'), []);
  });

  test(`${id}: the class is a clean abapGit source file`, () => {
    const src = generateClass(design);
    assert.ok(!src.startsWith('﻿'), 'an .abap file carries no BOM');
    assert.ok(!src.includes('\r'), 'LF line ends only');
    assert.ok(!src.includes('\t'), 'no tabs');
    assert.ok(src.endsWith('\n') && !src.endsWith('\n\n'), 'one final newline');
    src.split('\n').forEach((line, i) => {
      assert.ok(line.length <= 255, `line ${i + 1} is ${line.length} characters long`);
      assert.ok(!/\s$/.test(line), `line ${i + 1} ends in whitespace`);
    });
  });

  test(`${id}: the class follows the app template`, () => {
    const src = generateClass(design);
    const cls = design.className.toLowerCase();
    assert.match(src, new RegExp(`^CLASS ${cls} DEFINITION PUBLIC\\.\\n`));
    assert.match(src, /INTERFACES z2ui5_if_app\./);
    assert.match(src, /DATA client TYPE REF TO z2ui5_if_client\./);
    assert.match(src, releaseOf(design) === '702'
      ? /me->client = client\.\n {4}IF client->check_on_(init|navigated)\( \) = abap_true\./
      : /me->client = client\.\n {4}IF client->check_on_(init|navigated)\( \)\./);
    assert.match(src, /client->view_display\( view->stringify\( \) \)\./);
    const hasEvents = JSON.stringify(design.root).includes('"events":{"');
    assert.equal(/METHOD on_event\./.test(src), hasEvents, 'on_event exactly when the view raises events');
    // every bound attribute is public
    const pub = src.split('PROTECTED SECTION.')[0];
    for (const a of design.attributes) assert.match(pub, new RegExp(`DATA ${a.name} +TYPE `), `${a.name} is a public attribute`);
  });

  test(`${id}: the chain builds the designer's view`, () => {
    const chain = viewChain(design).join('\n');
    assert.equal(builderXml(chain), flat(toXml(design)));
  });

  test(`${id}: the chain keeps the house layout`, () => {
    const lines = viewChain(design);
    const segs = lines.filter((l) => l.includes(')->'));
    let depth = 0;
    const stack = [];
    for (const l of segs) {
      const col = l.indexOf(')->');
      assert.equal(col % 4, 0, `four spaces per level: ${l}`);
      const verb = /\)->(ele|tag|a|end)\(/.exec(l)[1];
      if (verb === 'end') {
        assert.equal(col, stack.pop(), `end( ) stands in the column of its ele( ): ${l}`);
      } else if (verb === 'ele') {
        stack.push(col);
      }
      depth = stack.length;
    }
    assert.ok(depth >= 0);
    assert.ok(lines[lines.length - 1].endsWith(' ).'), 'the chain ends in a single ).');
    assert.ok(!lines.some((l) => /^\s*\)\s*$/.test(l)), 'no ) alone on a line');
  });

  test(`${id}: an imported view comes back as the same view`, () => {
    const xml = toXml(design);
    const back = fromXml(xml, clone(design));
    const strip = (x) => x.replace(/ (\w+)="\.onEvent\('[A-Z0-9_]+'\)"/g, '');
    assert.equal(strip(toXml(back)), strip(xml));
  });
}

// What 7.02 does not have - the constructs abap2UI5's own downport
// (abaplint's `downport` rule at v702) rewrites. Each is a statement or an
// expression that would not compile there; the abaplint run below is the
// authority, this list is the readable half of it.
const NOT_IN_702 = [
  [/\bDATA\(/, 'inline declaration DATA( )'],
  [/\bFIELD-SYMBOL\(/, 'inline FIELD-SYMBOL( )'],
  [/\|[^|\n]*\|/, 'string template |...|'],
  [/\b(VALUE|NEW|COND|SWITCH|CONV|REF|CORRESPONDING|EXACT|REDUCE|FILTER)\s+#?\w*\s*\(/, 'constructor expression'],
  [/\bLINE_EXISTS\(/, 'line_exists( )'],
  [/\w\[\s/, 'table expression itab[ ]'],
  [/\bFOR\s+\w+\s+IN\b/, 'FOR iteration'],
  [/\bWITH EMPTY KEY\b/, 'WITH EMPTY KEY'],
  [/\b(IF|ELSEIF)\s+\w+->\w+\(\s*\)\.$/m, 'predicative method call'],
  [/->\*/, 'dereference chain ->*'],
];

for (const [id, design] of allDesigns702()) {
  test(`${id}: the class uses no construct 7.02 lacks`, () => {
    const src = generateClass(design);
    assert.match(src, /^ {4}DATA view TYPE REF TO z2ui5_cl_ui5_view_builder\.$/m);
    assert.match(src, /^ {4}view = z2ui5_cl_ui5_view_builder=>factory\($/m);
    for (const line of src.split('\n')) {
      // a backtick literal may hold anything; what is outside it is ABAP
      const code = line.replace(/`(?:[^`]|``)*`/g, '``');
      for (const [re, what] of NOT_IN_702) assert.ok(!re.test(code), `${what} in: ${line.trim()}`);
    }
    if (design.attributes.some((a) => a.type === 'table' && (a.rows || []).length)) {
      assert.match(src, /^ {4}DATA \w+_row +TYPE ty_s_\w+\.$/m, 'a row variable per table');
      assert.match(src, /^ {4}APPEND \w+_row TO \w+\.$/m);
    }
  });
}

test('the 7.02 classes pass abaplint at v702 (abaplint-702.jsonc)', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { writeClasses } = await import('../tools/gen-classes.mjs');
  await writeClasses();
  const bin = fileURLToPath(new URL('../node_modules/@abaplint/cli/abaplint', import.meta.url));
  let out;
  try {
    out = execFileSync('node', [bin, 'abaplint-702.jsonc', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
    assert.fail(`abaplint: ${out.slice(0, 1500)}`);
  }
  // the JSON report is the list of issues: none
  const issues = JSON.parse(out.slice(out.indexOf('[')));
  assert.deepEqual(issues.map((i) => `${i.file.filename}:${i.start.row} ${i.key} ${i.description}`), []);
  const { readdirSync } = await import('node:fs');
  const written = readdirSync(`${root}.verify/abap`).filter((f) => f.endsWith('_702.clas.abap'));
  assert.equal(written.length, allDesigns702().length, 'every 7.02 class was checked');
});

test('the .clas.xml is what abapGit writes', () => {
  const d = kitchenSink();
  d.description = "Tom's <app> & more";
  const xml = generateClassXml(d);
  assert.ok(xml.startsWith('﻿<?xml version="1.0" encoding="utf-8"?>\n'), 'BOM and declaration');
  assert.ok(xml.endsWith('</abapGit>\n'));
  assert.ok(!xml.includes('\r'));
  assert.match(xml, /<CLSNAME>ZCL_DSG_KITCHEN_SINK<\/CLSNAME>/);
  assert.match(xml, /<DESCRIPT>Tom&apos;s &lt;app&gt; &amp; more<\/DESCRIPT>/);
});

test('a namespaced class gets abapGit file names', () => {
  const d = kitchenSink();
  d.className = '/ABC/CL_MY_APP';
  const files = Object.keys(abapGitFiles(d));
  assert.ok(files.includes('src/#abc#cl_my_app.clas.abap'));
  assert.ok(files.includes('src/#abc#cl_my_app.clas.xml'));
  assert.match(generateClass(d), /^CLASS \/abc\/cl_my_app DEFINITION PUBLIC\./);
});

test('literals', () => {
  assert.equal(abapString('a`b'), '`a``b`');
  assert.equal(abapString('two\nlines {x} |y|'), '|two\\nlines \\{x\\} \\|y\\||');
  assert.equal(abapString('two\nlines {x} |y|', '702'), '`two` && cl_abap_char_utilities=>newline && `lines {x} |y|`');
  assert.equal(abapString('a\r\nb\tc', '702'), '`a` && cl_abap_char_utilities=>cr_lf && `b` && cl_abap_char_utilities=>horizontal_tab && `c`');
  assert.equal(escapeBindingLiteral('a {b} \\c'), 'a \\{b\\} \\\\c');
});

test('a long text is split so no line passes 255 characters', () => {
  for (const release of ['740', '702']) {
    const d = kitchenSink();
    d.release = release;
    const long = 'x'.repeat(700);
    walk(d.root, (n) => { if (n.type === 'Title') n.props.text = { m: 's', v: `${long}\n${long}` }; });
    d.attributes.find((a) => a.name === 't_rows').rows[0].NAME = long;
    const src = generateClass(d);
    assert.ok(src.split('\n').every((l) => l.length <= 255), release);
    assert.equal(builderXml(viewChain(d).join('\n')), flat(toXml(d)), release);
  }
});

test('the zip is a zip', () => {
  const files = abapGitFiles(kitchenSink());
  const bytes = zip(files);
  const dv = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), Object.keys(files).length);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (const [path, content] of Object.entries(files)) {
    assert.equal(dv.getUint32(off, true), 0x02014b50);
    const nameLen = dv.getUint16(off + 28, true);
    assert.equal(dec.decode(bytes.slice(off + 46, off + 46 + nameLen)), path);
    const local = dv.getUint32(off + 42, true);
    const size = dv.getUint32(off + 20, true);
    const data = bytes.slice(local + 30 + nameLen, local + 30 + nameLen + size);
    assert.equal(dec.decode(data, { stream: false }).replace(/^﻿/, ''), content.replace(/^﻿/, ''));
    assert.equal(dv.getUint32(off + 16, true), crc32(new TextEncoder().encode(content)));
    off += 46 + nameLen;
  }
});

test('every chain line belongs to the node it writes', async () => {
  const { generateClassMap } = await import('../src/abap.js');
  const d = kitchenSink();
  const { source, nodeIds } = generateClassMap(d);
  const lines = source.split('\n');
  assert.equal(nodeIds.length, lines.length);
  const ids = new Set();
  walk(d.root, (n) => { ids.add(n.id); });
  lines.forEach((l, i) => {
    const m = /\)->(tag|ele)\( (?:`(\w+)`|n = `(\w+)` ns = `(\w+)`)/.exec(l);
    if (!m || nodeIds[i] === 'root') return;
    assert.ok(ids.has(nodeIds[i]), `line ${i + 1} names a node that exists`);
    const n = [...ids].includes(nodeIds[i]) && (() => { let hit; walk(d.root, (x) => { if (x.id === nodeIds[i]) hit = x; }); return hit; })();
    const name = m[2] || m[3];
    // a control line names its own type, a wrapper line its parent's aggregation
    assert.ok(n.type.endsWith(name) || Object.keys(n.aggs).includes(name), `line ${i + 1}: ${l.trim()} belongs to ${n.type}`);
  });
  assert.ok(nodeIds.filter((x) => x && x !== 'root').length > 100);
});

test('a text of backticks is cut by its written width: no line passes 255, no character is torn', () => {
  for (const release of ['', '702']) {
    for (const v of ['`'.repeat(130), `${'x'.repeat(119)}😀${'y'.repeat(130)}`]) {
      const d = createDesign();
      if (release) d.release = release;
      d.attributes = [{ name: 'txt', type: 'string', value: v }];
      const t = createNode('Text');
      t.props.text = { m: 's', v };
      insertNode(d, t, d.root.aggs.content[0].id);
      const src = generateClass(d);
      assert.ok(src.split('\n').every((l) => l.length <= 255), 'no line over 255');
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(src), 'no lone surrogate');
    }
  }
});

test('a line break in a value is a character reference in the view, as abap2UI5 writes it', () => {
  const d = createDesign();
  const t = createNode('Text');
  t.props.text = { m: 's', v: 'a\nb\tc' };
  insertNode(d, t, d.root.aggs.content[0].id);
  assert.match(toXml(d), /text="a&#xA;b&#x9;c"/);
  const back = fromXml(toXml(d), createDesign());
  assert.equal(back.root.aggs.content[0].aggs.content.at(-1).props.text.v, 'a\nb\tc');
});

test('a view of two root elements is refused', () => {
  assert.throws(() => fromXml('<mvc:View xmlns:mvc="sap.ui.core.mvc"/><mvc:View xmlns:mvc="sap.ui.core.mvc"/>', createDesign()), /more than one root/);
});

test('the namespaces are declared in the order the view writes its controls, however it was built', () => {
  const build = (order) => {
    const d = createDesign();
    const page = d.root.aggs.content[0];
    page.aggs = {};
    for (const agg of order) page.aggs[agg] = [createNode(agg === 'headerContent' ? 'core:Icon' : 'l:HorizontalLayout')];
    return generateClass(d);
  };
  assert.equal(build(['headerContent', 'content']), build(['content', 'headerContent']));
});

test('a control character is written by neither the class nor the canvas - abap2UI5 drops it', async () => {
  const { previewModel } = await import('../src/model.js');
  for (const release of ['', '702']) {
    const d = createDesign();
    if (release) d.release = release;
    d.attributes = [{ name: 's', type: 'string', value: 'a\u0001b' }];
    const t = createNode('Text');
    t.props.text = { m: 's', v: 'c\u0002d' };
    insertNode(d, t, d.root.aggs.content[0].id);
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(generateClass(d)));
    assert.deepEqual(previewModel(d), { S: 'ab' });
  }
});
