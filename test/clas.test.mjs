// An ABAP class -> design (src/clas.js) and back: every starter's and the
// kitchen sink's class comes back as the design it was generated from -
// byte-identical whether the export patches the imported class or
// generates it anew -, a real sample from abap2UI5/samples imports with
// its view, and what the editor cannot take along is reported, never
// dropped. The abap2UI5 linter's own reconstruction of the chain is the
// independent witness for the view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareAbap } from '@abap2ui5/linter/reconstruct';
import { allDesigns, allDesigns702 } from './fixtures.mjs';
import { generateClass } from '../src/abap.js';
import { toXml } from '../src/xml.js';
import { createDesign, createNode, insertNode, validate, walk, aggNames, clone } from '../src/model.js';
import { fromClass, classReport, classSource, generateClassSource, classFiles, readViewChain, readPublicSection, readSeeds, sourceUrl, repoClassUrl } from '../src/clas.js';

const SAMPLE = new URL('./fixtures/z2ui5_cl_smp_app_493.clas.abap', import.meta.url);

// The order of the WHEN branches follows the order the design's
// aggregations were filled in (collectEvents walks them as stored); a read
// class stores them in the order the view writes them, the catalogue's.
// The same view, the same class - up to that order, so the original is
// brought to it before the two are compared
function canonical(design) {
  const d = clone(design);
  walk(d.root, (n) => {
    const sorted = {};
    for (const a of aggNames(n)) if (n.aggs[a]) sorted[a] = n.aggs[a];
    n.aggs = sorted;
    return true;
  });
  return d;
}

// the two views as the runtime sees them: the preview's handler and the
// framework's for the same event
const events = (xml) => xml.replace(/"\.eB\(\)"/g, '"EVENT"').replace(/"\.onEvent\('[A-Z0-9_]+'\)"/g, '"EVENT"');
const flat = (xml) => xml.replace(/>\s+</g, '><');

for (const [id, design] of [...allDesigns(), ...allDesigns702()]) {
  test(`${id}: generate -> import -> generate is byte-identical`, () => {
    const src = generateClass(design);
    const back = fromClass(src, createDesign());
    const r = classReport();
    assert.deepEqual(r.dropped, [], 'every attribute of the chain came through');
    assert.deepEqual(r.unresolved, [], 'every binding found its attribute');
    assert.deepEqual(r.skipped, [], 'every public attribute has an editor type');
    assert.deepEqual(r.seeds, [], 'every seed was read');
    assert.equal(back.className, design.className);
    assert.deepEqual(validate(back).filter((i) => i.level === 'error'), []);
    // the export of an imported class patches the class it came from
    assert.equal(generateClassSource(back), src, 'patched');
    assert.deepEqual(classSource(back).notes, []);
    // and the design alone, generated from nothing, is the same class
    delete back.abap;
    assert.equal(generateClass(back), generateClass(canonical(design)), 'regenerated');
  });

  test(`${id}: the imported design builds the view the linter reconstructs from the class`, () => {
    const src = generateClass(design);
    const back = fromClass(src, createDesign());
    const p = prepareAbap(src);
    assert.equal(p.unplacedTokens, 0);
    assert.equal(events(flat(toXml(back))), events(p.docs[0]));
  });
}

test('the attributes and their seeds come out of the class as the data panel holds them', () => {
  const d = allDesigns().find(([id]) => id === 'kitchen-sink-1')[1];
  const back = fromClass(generateClass(d), createDesign());
  const by = Object.fromEntries(back.attributes.map((a) => [a.name, a]));
  assert.equal(by.text.value, 'Hello `world` {not a binding}');
  assert.equal(by.count.value, '42');
  assert.equal(by.amount.value, '1234.50', 'a decimal keeps its text');
  assert.equal(by.flag.value, true);
  assert.equal(by.day.value, '2026-10-14');
  assert.equal(by.clock.value, '12:30:00');
  assert.deepEqual(by.t_rows.fields.map((f) => `${f.name}:${f.type}`), ['NAME:string', 'QTY:int', 'PRICE:decimal', 'DONE:bool', 'DUE:date', 'AT:time']);
  assert.equal(by.t_rows.rows.length, 3);
  assert.deepEqual(by.t_rows.rows[1], { NAME: 'Beta', QTY: '2', PRICE: '19.99', DONE: false, DUE: '2026-02-01', AT: '09:30:00' });
  assert.deepEqual(by.t_blank.rows, [{}, {}], 'rows that set nothing are rows');
  assert.equal(by.t_tree.fields[1].type, 'table', 'a table field is a table');
  assert.deepEqual(by.t_tree.rows[0].NODES, [{ TEXT: 'Child 1', DONE: true }, { TEXT: 'Child 2', DONE: false }]);
  assert.deepEqual(by.t_tree.rows[1].NODES, undefined, 'a row without nodes has none');
});

test('line breaks, tabs and long texts come back as they were written, in both releases', () => {
  const [, d] = allDesigns().find(([id]) => id === 'texts');
  for (const release of ['', '702']) {
    const source = generateClass(Object.assign(clone(d), { release }));
    const back = fromClass(source, createDesign());
    const by = Object.fromEntries(back.attributes.map((a) => [a.name, a]));
    const want = Object.fromEntries(d.attributes.map((a) => [a.name, a]));
    assert.equal(by.note.value, want.note.value, `a string template / char constants (${release || '7.40'})`);
    assert.equal(by.long_text.value, want.long_text.value, `pieces joined with && (${release || '7.40'})`);
    assert.equal(by.t_notes.rows[0].BODY, 'first\nsecond');
    assert.equal(by.t_notes.rows[0].LINES[1].TEXT, want.long_text.value);
    assert.deepEqual(classReport().seeds || [], [], 'every seed was read');
  }
});

test('a string template with an expression in it is not a literal', () => {
  const d = createDesign();
  d.className = 'ZCL_LE_TEMPLATE';
  d.attributes = [{ name: 'greeting', type: 'string', value: '' }];
  const source = generateClass(d).replace("greeting = ``.", 'greeting = |Hello { sy-uname }|.');
  const back = fromClass(source, createDesign());
  assert.equal(back.attributes.find((a) => a.name === 'greeting').value, '');
});

test('a real sample imports: the view, the controls the palette does not know, and a report of what it could not take', () => {
  const src = readFileSync(SAMPLE, 'utf8');
  const d = fromClass(src, createDesign());
  const r = classReport();
  assert.equal(d.className, 'Z2UI5_CL_SMP_APP_493');
  assert.deepEqual(d.attributes, []);
  const shell = d.root.aggs.content[0];
  assert.equal(shell.type, 'Shell');
  assert.deepEqual(r.unknown, ['Shell']);
  const page = shell.aggs[''][0];
  assert.equal(page.type, 'Page');
  assert.equal(page.props.title.v, 'abap2UI5 - Basics I - Hello World, the Smallest App');
  const [strip, title] = page.aggs.content;
  assert.equal(strip.type, 'MessageStrip');
  assert.ok(strip.props.text.v.startsWith('The whole app is what you see below') && strip.props.text.v.endsWith('your own app.'), 'the && pieces are one text');
  assert.deepEqual(strip.props.showIcon, { m: 's', v: 'true' }, 'b = abap_true');
  assert.equal(title.props.level.v, 'H2');
  // what no field of the editor holds is kept as ABAP and reported, by control and attribute
  assert.deepEqual(r.kept, [
    { control: 'Page', attr: 'showNavButton', abap: 'client->check_app_prev_stack( )' },
    { control: 'Page', attr: 'navButtonPress', abap: 'client->_event_nav_app_leave( )' },
  ]);
  assert.deepEqual(r.dropped, []);
  assert.deepEqual(d.abap.raw[page.id].map((a) => `${a.name} ${a.key}`), ['showNavButton b', 'navButtonPress v']);
  // the linter agrees on everything it renders
  const p = prepareAbap(src);
  const mine = flat(toXml(d)).replace(/<mvc:View[^>]*>/, '<mvc:View>');
  const theirs = p.docs[0].replace(/<mvc:View[^>]*>/, '<mvc:View>').replace(/ showNavButton="[^"]*"| navButtonPress="[^"]*"/g, '');
  assert.equal(mine, theirs);
});

test('the export of the sample keeps the class and writes the chain over the three statements it had', () => {
  const src = readFileSync(SAMPLE, 'utf8');
  const d = fromClass(src, createDesign());
  const out = generateClassSource(d);
  // the header comment, the definition, the IF around the view, the display call and the method end are untouched
  for (const kept of ['" @keywords hello world', 'CLASS z2ui5_cl_smp_app_493 DEFINITION PUBLIC.', '    IF client->check_on_navigated( ).', '      client->view_display( view->stringify( ) ).', '    ENDIF.\n\n  ENDMETHOD.\nENDCLASS.\n']) {
    assert.ok(out.includes(kept), `kept: ${kept}`);
  }
  assert.ok(!out.includes('DATA(page)'), 'the split chain is one chain now');
  assert.ok(out.includes('      DATA(view) = z2ui5_cl_ui5_view_builder=>factory(\n          )->ele( n = `View` ns = `mvc`'), 'in the column the old chain started in');
  assert.ok(out.includes("                      )->tag( `Title`\n                          )->a( n = `text`  v = `Hello World`"));
  // the attributes the editor has no field for are back, as they were written
  assert.ok(out.includes('                      )->a( n = `showNavButton`  b = client->check_app_prev_stack( )\n                      )->a( n = `navButtonPress` v = client->_event_nav_app_leave( )\n'), out);
  assert.ok(out.split('\n').every((l) => l.length <= 255));
  // the lines of the chain are linked to their controls, the rest to none
  const { nodeIds, source } = classSource(d);
  const lines = source.split('\n');
  assert.equal(nodeIds.length, lines.length);
  assert.ok(nodeIds[lines.findIndex((l) => l.includes('->tag( `Title`'))]);
  assert.equal(nodeIds[lines.findIndex((l) => l.startsWith('CLASS '))], null);
  // the linter reads the regenerated class to the same view, up to the two kept attributes
  const theirs = events(prepareAbap(out).docs[0]).replace(/<mvc:View[^>]*>/, '<mvc:View>').replace(/ showNavButton="[^"]*"| navButtonPress="[^"]*"/g, '');
  assert.equal(events(flat(toXml(d))).replace(/<mvc:View[^>]*>/, '<mvc:View>'), theirs);
  // and an import of the export is the same class again
  assert.equal(generateClassSource(fromClass(out, createDesign())), out);
});

test('an attribute and an event added in the editor are declared and handled in the imported class', () => {
  const form = allDesigns().find(([id]) => id === 'form')[1];
  const src = generateClass(form);
  const d = fromClass(src, createDesign());
  d.attributes.push({ name: 'note', type: 'string', value: '' });
  d.attributes.push({ name: 't_items', type: 'table', fields: [{ name: 'KEY', type: 'string' }, { name: 'QTY', type: 'int' }], rows: [] });
  const page = d.root.aggs.content[0];
  const input = createNode('Input');
  input.props.value = { m: 'b', v: 'note' };
  input.events.submit = 'ADD';
  insertNode(d, input, page.id);
  const out = generateClassSource(d);
  assert.ok(out.includes('    DATA is_active TYPE abap_bool.\n\n    TYPES:\n      BEGIN OF ty_s_items,\n        key TYPE string,\n        qty TYPE i,\n      END OF ty_s_items.\n    DATA t_items TYPE STANDARD TABLE OF ty_s_items WITH EMPTY KEY.\n    DATA note TYPE string.\n\n  PROTECTED SECTION.'), out);
  assert.ok(out.includes("      WHEN `CANCEL`.\n        client->message_toast_display( `CANCEL - implement me in on_event` ).\n      WHEN `ADD`.\n        client->message_toast_display( `ADD - implement me in on_event` ).\n    ENDCASE."), out);
  assert.ok(out.includes(')->a( n = `value`  v = client->_bind( note )'));
  assert.deepEqual(classSource(d).notes, []);
  // the chain lines still point at their controls after the lines above moved
  const { nodeIds, source } = classSource(d);
  const lines = source.split('\n');
  assert.equal(nodeIds[lines.findIndex((l) => l.includes('->tag( `Switch`'))], page.aggs.content[0].aggs.content[7].id);
  // the class is still what the linter reads as this view
  assert.equal(events(flat(toXml(d))), events(prepareAbap(out).docs[0]));
  // the abapGit files carry the patched class
  assert.equal(classFiles(d)['src/zcl_my_form.clas.abap'], out);
});

test('an event the class cannot take a branch for is said, not lost', () => {
  const src = readFileSync(SAMPLE, 'utf8');
  const d = fromClass(src, createDesign());
  const page = d.root.aggs.content[0].aggs[''][0];
  const b = createNode('Button', { props: { text: 'Go' } });
  b.events.press = 'GO';
  insertNode(d, b, page.id);
  const { source, notes } = classSource(d);
  assert.ok(source.includes('v = client->_event( `GO` )'));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /GO/);
  assert.ok(!source.includes('WHEN `GO`'));
});

test('a chain in a variable of another name keeps that name', () => {
  const src = generateClass(allDesigns()[0][1]).replace(/DATA\(view\)/, 'DATA(page)').replace(/view->stringify/, 'page->stringify');
  const d = fromClass(src, createDesign());
  assert.equal(generateClassSource(d), src);
});

test('a 7.02 chain in a variable of another name keeps that name', () => {
  const src = generateClass(allDesigns702()[0][1])
    .replace(/DATA view TYPE REF TO/, 'DATA page TYPE REF TO').replace(/^(\s*)view = /m, '$1page = ').replace(/view->stringify/, 'page->stringify');
  const d = fromClass(src, createDesign());
  assert.equal(generateClassSource(d), src);
});

test('a class renamed in the editor is renamed in its source', () => {
  const src = generateClass(allDesigns()[0][1]);
  const d = fromClass(src, createDesign());
  d.className = 'ZCL_RENAMED';
  const out = generateClassSource(d);
  assert.match(out, /^CLASS zcl_renamed DEFINITION PUBLIC\./m);
  assert.match(out, /^CLASS zcl_renamed IMPLEMENTATION\./m);
  assert.equal(out.split('\n').length, src.split('\n').length);
  assert.equal(out.replace(/zcl_renamed/g, allDesigns()[0][1].className.toLowerCase()), src);
});

test('a rename and a new attribute together: the declaration lands on a line of its own', () => {
  const d = fromClass(generateClass(allDesigns()[0][1]), createDesign());
  d.className = 'ZCL_A_MUCH_LONGER_NAME_NOW';
  d.attributes.push({ name: 'extra', type: 'string', value: '' });
  const out = generateClassSource(d);
  assert.match(out, /^CLASS zcl_a_much_longer_name_now DEFINITION PUBLIC\./m);
  assert.match(out, /\n {4}DATA extra TYPE string\.\n/);
  for (const line of out.split('\n')) assert.ok(!/\bTY$/.test(line), line);
  const { source, nodeIds } = classSource(d);
  const first = nodeIds.findIndex(Boolean);
  assert.match(source.split('\n')[first], /z2ui5_cl_ui5_view_builder=>factory\(/);
});

const appClass = (pub, main, onEvent = '') => `CLASS zcl_x DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
${pub}
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_x IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
${main}
  ENDMETHOD.
${onEvent}
ENDCLASS.
`;
const viewHead = `    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = \`View\` ns = \`mvc\`
            )->a( n = \`xmlns\` v = \`sap.m\`
            )->a( n = \`xmlns:mvc\` v = \`sap.ui.core.mvc\` ).`;

test('a view built on after an IF is refused, not half imported', () => {
  const src = appClass('    DATA name TYPE string.', `${viewHead}
    DATA(page) = view->ele( \`Page\` ).
    IF name IS INITIAL.
      page->tag( \`Text\` )->a( n = \`text\` v = \`empty\` ).
    ENDIF.
    page->tag( \`Button\` )->a( n = \`text\` v = \`Go\` ).
    client->view_display( view->stringify( ) ).`);
  assert.throws(() => fromClass(src, createDesign()), /page->/);
});

test('a new event goes into the CASE of the events, not into one nested in a branch, and WHEN A OR B handles both', () => {
  const onEvent = `  METHOD on_event.
    CASE client->get_event( ).
      WHEN \`SAVE\` OR \`CANCEL\`.
        CASE name.
          WHEN \`x\`.
          WHEN OTHERS.
        ENDCASE.
      WHEN OTHERS.
    ENDCASE.
  ENDMETHOD.`;
  const src = appClass('    DATA name TYPE string.', `${viewHead.replace(' ).', '')}
            )->ele( \`Page\`
                )->tag( \`Button\`
                    )->a( n = \`press\` v = client->_event( \`SAVE\` ) ).
    client->view_display( view->stringify( ) ).`, onEvent);
  const d = fromClass(src, createDesign());
  const btn = createNode('Button');
  btn.events.press = 'DELETE';
  const btn2 = createNode('Button');
  btn2.events.press = 'CANCEL';
  insertNode(d, btn, d.root.aggs.content[0].id);
  insertNode(d, btn2, d.root.aggs.content[0].id);
  const out = generateClassSource(d);
  assert.ok(!out.includes('WHEN `CANCEL`.'), 'CANCEL is handled by WHEN `SAVE` OR `CANCEL`');
  assert.match(out, /ENDCASE\.\n {6}WHEN `DELETE`\.\n.*\n {6}WHEN OTHERS\.\n {4}ENDCASE\./);
});

test('public attributes: a comma in a literal, VALUE with READ-ONLY, => in a seed row', () => {
  const pub = readPublicSection(appClass("    DATA city TYPE string VALUE `Walldorf, DE`.\n    DATA cnt TYPE i VALUE 5 READ-ONLY.", ''));
  assert.deepEqual(pub.attributes.map((a) => [a.name, a.value]), [['city', 'Walldorf, DE'], ['cnt', '5']]);
  const attrs = [{ name: 't_x', type: 'table', fields: [{ name: 'ID', type: 'string' }, { name: 'NAME', type: 'string' }], rows: [] }];
  const notes = readSeeds(appClass('', '    t_x = VALUE #( ( id = `1` name = `a` && cl_abap_char_utilities=>newline && `b` ) ).'), attrs);
  assert.deepEqual(notes, []);
  assert.deepEqual(attrs[0].rows, [{ ID: '1', NAME: 'a\nb' }]);
});

test('a 7.02 class is 7.02 whatever its builder variable is called', () => {
  const src = generateClass(allDesigns702()[0][1]).replace(/DATA view TYPE REF TO/, 'DATA lo_view TYPE REF TO')
    .replace(/^(\s*)view = /m, '$1lo_view = ').replace(/view->stringify/, 'lo_view->stringify');
  assert.equal(fromClass(src, createDesign()).release, '702');
});

test('what cannot be read is refused with a reason', () => {
  assert.throws(() => fromClass('CLASS zcl_x DEFINITION PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES z2ui5_if_app.\nENDCLASS.\nCLASS zcl_x IMPLEMENTATION.\nENDCLASS.\n', createDesign()), /Nothing here builds a view/);
  const two = generateClass(allDesigns()[0][1]);
  assert.throws(() => fromClass(two + two, createDesign()), /more than one view/);
  assert.throws(() => fromClass(two.replace('tag( `Page`', 'tag( lv_name'), createDesign()), /not a literal/);
  assert.throws(() => fromClass(two.replace("ele( n = `View` ns = `mvc`", "ele( n = `FragmentDefinition` ns = `core`"), createDesign()), /not an mvc:View/);
  const chain = readViewChain('METHOD x. DATA(v) = z2ui5_cl_ui5_view_builder=>factory( )->ele( `View` )->foo( ). ENDMETHOD.');
  assert.equal(chain.ok, false);
  assert.match(chain.why, /foo/);
});

test('the public section: the types the editor has, the rest reported, DATA: chains and VALUE', () => {
  const pub = readPublicSection(`CLASS zcl_x DEFINITION PUBLIC.
  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    TYPES: BEGIN OF ty_row,
             id    TYPE string,
             qty   TYPE i,
             price TYPE p LENGTH 16 DECIMALS 2,
             done  TYPE abap_bool,
           END OF ty_row.
    TYPES ty_t_rows TYPE STANDARD TABLE OF ty_row WITH DEFAULT KEY.
    TYPES: BEGIN OF ty_deep, name TYPE string, obj TYPE REF TO object, END OF ty_deep.
    DATA: mv_name TYPE string VALUE 'Jane', " a comment with a . in it
          mv_count TYPE i,
          mv_when TYPE d.
    DATA mt_rows TYPE ty_t_rows.
    DATA mt_rows2 TYPE TABLE OF ty_row.
    DATA mt_deep TYPE STANDARD TABLE OF ty_deep WITH EMPTY KEY.
    DATA mv_bukrs TYPE bukrs.
    DATA mo_ref TYPE REF TO zcl_other.
    DATA ms_row TYPE ty_row.
    CONSTANTS c TYPE string VALUE 'x'.
    METHODS foo.
  PROTECTED SECTION.
ENDCLASS.`);
  assert.deepEqual(pub.attributes.map((a) => [a.name, a.type, a.value]), [['mv_name', 'string', 'Jane'], ['mv_count', 'int', ''], ['mv_when', 'date', ''], ['mt_rows', 'table', undefined], ['mt_rows2', 'table', undefined]]);
  assert.deepEqual(pub.attributes[3].fields, [{ name: 'ID', type: 'string' }, { name: 'QTY', type: 'int' }, { name: 'PRICE', type: 'decimal' }, { name: 'DONE', type: 'bool' }]);
  assert.deepEqual(pub.skipped.map((s) => s.name), ['mt_deep', 'mv_bukrs', 'mo_ref', 'ms_row']);
  assert.deepEqual(pub.declared, ['mv_name', 'mv_count', 'mv_when', 'mt_rows', 'mt_rows2', 'mt_deep', 'mv_bukrs', 'mo_ref', 'ms_row']);
});

test('seeds: model_init first, literals only, the rest said', () => {
  const attrs = [{ name: 'name', type: 'string', value: '' }, { name: 'n', type: 'int', value: '' }, { name: 't_rows', type: 'table', fields: [{ name: 'A', type: 'string' }, { name: 'B', type: 'bool' }], rows: [] }];
  const notes = readSeeds(`CLASS zcl_x IMPLEMENTATION.
  METHOD z2ui5_if_app~main.
    name = \`not this one\`.
  ENDMETHOD.
  METHOD model_init.
    me->name = 'it''s'.
    n = lv_other.
    t_rows = VALUE #( ( a = \`x\` b = abap_true ) ( a = \`y\` ) ( a = lv_z ) ).
  ENDMETHOD.
ENDCLASS.`, attrs);
  assert.equal(attrs[0].value, "it's");
  assert.equal(attrs[1].value, '');
  assert.deepEqual(attrs[2].rows, [{ A: 'x', B: true }, { A: 'y' }, {}]);
  assert.deepEqual(notes, ['n: its value is not a literal, the sample value stays empty', 't_rows-A: not a literal, left empty']);
});

test('where a class may come from', () => {
  const here = 'https://abap2ui5.github.io/layout-editor/index.html';
  assert.equal(sourceUrl('https://raw.githubusercontent.com/abap2UI5/samples/main/src/z2ui5_cl_smp_app_493.clas.abap', here), 'https://raw.githubusercontent.com/abap2UI5/samples/main/src/z2ui5_cl_smp_app_493.clas.abap');
  assert.equal(sourceUrl('https://github.com/abap2UI5/samples/blob/main/src/z2ui5_cl_smp_app_493.clas.abap', here), 'https://raw.githubusercontent.com/abap2UI5/samples/main/src/z2ui5_cl_smp_app_493.clas.abap');
  assert.equal(sourceUrl('/test/fixtures/x.clas.abap', here), 'https://abap2ui5.github.io/test/fixtures/x.clas.abap');
  assert.throws(() => sourceUrl('https://example.com/x.clas.abap', here), /not from example.com/);
  assert.throws(() => sourceUrl('https://user:pw@raw.githubusercontent.com/a/b/c.clas.abap', here), /user name/);
  assert.equal(repoClassUrl('ZCL_MY_APP', 'abap2UI5/samples'), 'https://raw.githubusercontent.com/abap2UI5/samples/main/src/zcl_my_app.clas.abap');
  assert.equal(repoClassUrl('/abc/cl_app', 'o/r', 'dev', ''), 'https://raw.githubusercontent.com/o/r/dev/%23abc%23cl_app.clas.abap'.replace(/%23/g, '#'));
  assert.throws(() => repoClassUrl('ZCL_X', 'not a repo'), /owner\/repo/);
});

test('raw attributes: kept on their control, replaced by what the editor sets, gone with the control', () => {
  const src = generateClass(allDesigns().find(([id]) => id === 'form')[1])
    .replace(')->tag( `Input`\n', ')->tag( `Input`\n                                )->a( n = `id`             v = `nameInput`\n                                )->a( n = `core:require`   v = `{ Util: \'z/util\' }`\n                                )->a( n = `valueState`     v = COND #( WHEN name IS INITIAL\n                                                                THEN `Error` ELSE `None` )\n')
    .replace(')->a( n = `height`       v = `100%`', ')->a( n = `height`       v = `100%`\n            )->a( n = `controllerName` v = lv_controller');
  const d = fromClass(src, createDesign());
  const r = classReport();
  assert.deepEqual(r.kept.map((k) => `${k.control}.${k.attr} = ${k.abap}`), [
    'Input.id = `nameInput`',
    "Input.core:require = `{ Util: 'z/util' }`",
    'Input.valueState = COND #( WHEN name IS INITIAL THEN `Error` ELSE `None` )',
  ], 'a multi-line operand is one line, its literal untouched');
  assert.deepEqual(r.dropped, [{ control: 'mvc:View', attr: 'controllerName', abap: 'lv_controller' }]);
  const out = generateClassSource(d);
  assert.ok(out.includes(')->a( n = `valueState`   v = COND #( WHEN name IS INITIAL THEN `Error` ELSE `None` )'), out);
  assert.ok(out.includes(')->a( n = `core:require` v = `{ Util: \'z/util\' }`'));
  assert.ok(!out.includes('controllerName'), 'the View is the generator\'s');
  // the editor's own value wins over the kept one
  const form = d.root.aggs.content[0].aggs.content[0];
  const input = form.aggs.content[1];
  input.props.valueState = { m: 's', v: 'Warning' };
  const set = generateClassSource(d);
  assert.ok(set.includes('v = `Warning`') && !set.includes('COND #('));
  // a deleted control takes its raw attributes along
  form.aggs.content.splice(1, 1);
  assert.ok(!generateClassSource(d).includes('nameInput'));
});

test('an initial date or time in a seed row is no value, as abap2UI5 sends it', () => {
  const attrs = [{ name: 't_x', type: 'table', fields: [{ name: 'D', type: 'date' }, { name: 'T', type: 'time' }], rows: [] }];
  readSeeds(appClass('', "    t_x = VALUE #( ( d = '00000000' t = '000000' ) ( d = '20240229' t = '123000' ) )."), attrs);
  assert.deepEqual(attrs[0].rows, [{ D: '', T: '' }, { D: '2024-02-29', T: '12:30:00' }]);
});
