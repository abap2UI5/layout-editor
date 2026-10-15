import { test, expect, waitRendered, abapOf } from './fixtures.mjs';

const preview = (page) => page.frameLocator('#preview');
const nodeIds = (page, type) => page.evaluate((t) => {
  const out = [];
  const walk = (n) => { if (n.type === t) out.push(n.id); for (const l of Object.values(n.aggs || {})) l.forEach(walk); };
  walk(window.designer.state.design.root);
  return out;
}, type);
const selectedType = (page) => page.locator('#inspector .insp-title b');
const prop = (page, name) => page.locator(`#inspector .prop[data-prop="${name}"]`);

test('starts with a design that renders and a class that is ready', async ({ designer: page }) => {
  await expect(preview(page).getByText('Customer data')).toBeVisible();
  await expect(page.locator('#code')).toContainText('CLASS zcl_my_form DEFINITION PUBLIC.');
  await expect(page.locator('#issueCount')).toBeHidden();
  await expect(page.locator('#fileMenu')).toBeHidden();
  await expect(page.locator('#exportMenu')).toBeHidden();
});

test('a control dragged from the controls onto the canvas lands in the view', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Button')).length;
  const pageId = (await nodeIds(page, 'Page'))[0];
  await page.locator('.ins-item[data-type="Button"]').dragTo(preview(page).locator(`[id$="--${pageId}-cont"]`));
  await expect.poll(async () => (await nodeIds(page, 'Button')).length).toBe(before + 1);
  await expect(selectedType(page)).toHaveText('Button');
  await waitRendered(page);
});

test('a control dragged onto the outline goes where it is dropped', async ({ designer: page }) => {
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.getByRole('tab', { name: 'Controls' }).click();
  // drag from the controls tab needs the outline visible: drop through a programmatic event instead
  const formId = (await nodeIds(page, 'form:SimpleForm'))[0];
  await page.evaluate((id) => window.designer.handleDrop('dsg:new:CheckBox', id), formId);
  await page.getByRole('tab', { name: 'Outline' }).click();
  const checkbox = page.locator('#layers .lrow', { hasText: 'CheckBox' });
  await expect(checkbox).toBeVisible();
  // and moved by drag within the outline: onto the Page
  await checkbox.dragTo(page.locator('#layers .lrow', { hasText: /^▾?Page/ }).first());
  const parent = await page.evaluate(() => {
    let hit = null;
    const walk = (n) => { for (const l of Object.values(n.aggs || {})) for (const c of l) { if (c.type === 'CheckBox') hit = n.type; walk(c); } };
    walk(window.designer.state.design.root);
    return hit;
  });
  expect(parent).toBe('Page');
});

test('clicking a control on the canvas selects it in the outline and in the code', async ({ designer: page }) => {
  await preview(page).getByText('City', { exact: true }).click();
  await expect(selectedType(page)).toHaveText('Label');
  await expect(page.locator('#code .ln.hi').first()).toContainText('tag( `Label`');
  await expect(page.locator('#crumbs .cur')).toHaveText('Label');
});

test('clicking a line of the class selects its control', async ({ designer: page }) => {
  await page.locator('#code .ln', { hasText: 'n = `SimpleForm` ns = `form`' }).click();
  await expect(selectedType(page)).toHaveText('SimpleForm');
  await expect(page.locator('#crumbs .cur')).toHaveText('SimpleForm');
});

test('the toolbar on the selected control deletes it', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Switch')).length;
  await preview(page).locator('[id*="--n"][role="switch"]').first().click();
  await expect(selectedType(page)).toHaveText('Switch');
  await preview(page).locator('#dsg-tools [data-action="del"]').click();
  await expect.poll(async () => (await nodeIds(page, 'Switch')).length).toBe(before - 1);
});

test('a property edited in the properties shows on the canvas and in the class', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  const text = prop(page, 'text').locator('.val input');
  await text.fill('Approve order');
  await expect(preview(page).getByText('Approve order')).toBeVisible();
  await expect(page.locator('#code')).toContainText('v = `Approve order`');
  await expect(text).toBeFocused();
});

test('binding a property to a new attribute and naming an event reach the class', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Input"]').click();
  await prop(page, 'value').locator('select.kind').selectOption('b');
  await prop(page, 'value').getByRole('button', { name: 'New attribute' }).click();
  await page.locator('#inspector .event', { has: page.locator('label', { hasText: /^submit$/ }) }).locator('input').fill('check_input');
  const abap = await abapOf(page);
  expect(abap).toMatch(/DATA input_value +TYPE string\./);
  expect(abap).toContain('v = client->_bind( input_value )');
  expect(abap).toContain('v = client->_event( `CHECK_INPUT` )');
  expect(abap).toContain('WHEN `CHECK_INPUT`.');
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.locator('#dataPanel .aname').last()).toHaveValue('input_value');
});

test('a list bound to a new table repeats its template per row', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="List"]').click();
  await page.locator('#inspector').getByRole('button', { name: '+ Table' }).click();
  await expect(preview(page).getByText('Second')).toBeVisible();
  expect(await abapOf(page)).toContain('v = client->_bind( t_items )');
});

test('a building block goes where it belongs', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit((d) => { const p = d.root.aggs.content[0]; delete p.aggs.footer; }));
  await page.locator('.ins-item[data-pattern="actions"]').click();
  const footer = await page.evaluate(() => (window.designer.state.design.root.aggs.content[0].aggs.footer || []).map((n) => n.type));
  expect(footer).toEqual(['OverflowToolbar']);
});

test('the command palette inserts a control', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'RatingIndicator')).length;
  await page.keyboard.press('Control+K');
  await page.locator('#cmdkInput').fill('insert rating');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await nodeIds(page, 'RatingIndicator')).length).toBe(before + 1);
});

test('undo and redo', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Title')).length;
  await page.locator('.ins-item[data-type="Title"]').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before + 1);
  await page.locator('#btnUndo').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before);
  await page.locator('#btnRedo').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before + 1);
});

test('the abapGit ZIP downloads with the class in it', async ({ designer: page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnZip').click()]);
  expect(download.suggestedFilename()).toBe('zcl_my_form.zip');
  const chunks = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(chunks).toString('latin1');
  for (const f of ['.abapgit.xml', 'src/package.devc.xml', 'src/zcl_my_form.clas.abap', 'src/zcl_my_form.clas.xml']) expect(text).toContain(f);
  expect(text).toContain('CLASS zcl_my_form DEFINITION PUBLIC.');
});

test('a UI5 XML view imports into an editable design', async ({ designer: page }) => {
  await page.locator('#btnFile').click();
  await page.locator('#btnImport').click();
  await page.locator('#dlg textarea').fill(`<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core">
    <Page title="Imported">
      <Button text="Go" press=".onGo"/>
      <Text text="{/SOME/PATH}"/>
      <core:Icon src="sap-icon://accept"/>
    </Page>
  </mvc:View>`);
  await page.locator('#dlg').getByRole('button', { name: 'Import' }).click();
  // the summary: what was dropped
  await expect(page.locator('#dlg')).toContainText('1 event handler(s) dropped');
  await page.locator('#dlg').getByRole('button', { name: 'OK' }).click();
  await expect(preview(page).getByText('Go')).toBeVisible();
  const abap = await abapOf(page);
  expect(abap).toContain(')->tag( `Button`');
  expect(abap).toContain('v = `{/SOME/PATH}`');
  expect(abap).not.toContain('onGo');
});

test('an imported binding without an attribute can become one', async ({ designer: page }) => {
  await page.locator('#btnFile').click();
  await page.locator('#btnImport').click();
  await page.locator('#dlg textarea').fill(`<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc">
    <Page title="Imported"><Input value="{/NAME}"/><Input value="{/STREET}"/><List items="{/T_ORDERS}"/></Page>
  </mvc:View>`);
  await page.locator('#dlg').getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('#dlg')).toContainText('{/STREET}, {/T_ORDERS}');
  await page.locator('#dlg').getByRole('button', { name: /Create 2 attribute/ }).click();
  const abap = await abapOf(page);
  expect(abap).toContain('v = client->_bind( name )');
  expect(abap).toContain('v = client->_bind( street )');
  expect(abap).toContain('v = client->_bind( t_orders )');
  expect(abap).toMatch(/DATA t_orders +TYPE STANDARD TABLE OF ty_s_orders/);
  await expect(page.locator('#panel-data')).toBeVisible();
});

test('an imported property the palette does not know shows in the properties and can go', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit((d) => { d.root.aggs.content[0].aggs.content[0].props.class = { m: 's', v: 'sapUiSmallMargin' }; }));
  const formId = (await nodeIds(page, 'form:SimpleForm'))[0];
  await page.evaluate((id) => window.designer.select(id), formId);
  const row = prop(page, 'class');
  await expect(row.locator('.val input')).toHaveValue('sapUiSmallMargin');
  expect(await abapOf(page)).toContain('n = `class`');
  await page.locator('#inspector').getByRole('button', { name: 'Remove class' }).click();
  expect(await abapOf(page)).not.toContain('n = `class`');
});

test('a new design from a template', async ({ designer: page }) => {
  await page.locator('#btnFile').click();
  await page.locator('#btnNew').click();
  await page.locator('#dlg .starter', { hasText: 'Table with search' }).click();
  await waitRendered(page);
  await expect(preview(page).getByText('Notebook')).toBeVisible();
  expect(await abapOf(page)).toContain('CLASS zcl_my_table DEFINITION PUBLIC.');
});

test('a drop on the canvas lands before, into or after the control under the pointer', async ({ designer: page }) => {
  const formId = (await nodeIds(page, 'form:SimpleForm'))[0];
  const order = () => page.evaluate(() => window.designer.state.design.root.aggs.content[0].aggs.content.map((n) => n.type));
  await page.evaluate((id) => window.designer.handleDrop('dsg:new:Button', id, null, 'before'), formId);
  expect(await order()).toEqual(['Button', 'form:SimpleForm']);
  await page.evaluate((id) => window.designer.handleDrop('dsg:new:Title', id, null, 'after'), formId);
  expect(await order()).toEqual(['Button', 'form:SimpleForm', 'Title']);
  await page.evaluate((id) => window.designer.handleDrop('dsg:new:Text', id, null, 'inside'), formId);
  expect(await order()).toEqual(['Button', 'form:SimpleForm', 'Title']);
  const inForm = await page.evaluate((id) => { let hit; const walk = (n) => { if (n.id === id) hit = n; Object.values(n.aggs).flat().forEach(walk); }; walk(window.designer.state.design.root); return hit.aggs.content.at(-1).type; }, formId);
  expect(inForm).toBe('Text');
});

test('copy and paste, by key and across the outline', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Switch')).length;
  await preview(page).locator('[id*="--n"][role="switch"]').first().click();
  await expect(selectedType(page)).toHaveText('Switch');
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await nodeIds(page, 'Switch')).length).toBe(before + 1);
  await page.keyboard.press('Control+X');
  await expect.poll(async () => (await nodeIds(page, 'Switch')).length).toBe(before);
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.locator('#layers .lrow.sel').focus();
  await page.keyboard.press('ArrowUp');
  await expect(selectedType(page)).not.toHaveText('Switch');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+V');
  await expect.poll(async () => (await nodeIds(page, 'Switch')).length).toBe(before + 1);
});

test('a shared link carries the design, Recent brings the replaced one back', async ({ designer: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => window.designer.commit((d) => { d.className = 'ZCL_SHARED'; }));
  await page.locator('#btnExport').click();
  await page.locator('#btnShare').click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('#d=');
  await page.evaluate(() => window.designer.commit((d) => { d.className = 'ZCL_BEFORE'; }));
  // a second tab opens the link: it finds ZCL_BEFORE in the browser store,
  // the link replaces it, Recent brings it back
  const tab = await context.newPage();
  await tab.goto(url);
  await expect(tab.locator('#className')).toHaveValue('ZCL_SHARED');
  expect(tab.url()).not.toContain('#d=');
  await tab.locator('#btnFile').click();
  await tab.locator('#btnRecent').click();
  await tab.locator('#dlg .starter', { hasText: 'ZCL_BEFORE' }).click();
  await expect(tab.locator('#className')).toHaveValue('ZCL_BEFORE');
  await tab.close();
});

test('any UI5 control by class name: the canvas describes it, the properties know its types', async ({ designer: page }) => {
  await page.locator('#insertByName').fill('sap.m.Avatar');
  await page.locator('#insertByName').press('Enter');
  await expect(selectedType(page)).toHaveText('Avatar');
  await expect(page.locator('#inspector .insp-desc')).toContainText('sap.m.Avatar - from the UI5 runtime');
  // an enum from the runtime is a dropdown
  await expect(prop(page, 'displaySize').locator('.val select')).toBeVisible();
  await prop(page, 'displaySize').locator('.val select').selectOption('L');
  await prop(page, 'initials').locator('.val input').fill('AB');
  const abap = await abapOf(page);
  expect(abap).toContain(')->tag( `Avatar`');
  expect(abap).toContain('v = `AB`');
  await expect(preview(page).locator('.sapFAvatar, .sapMAvatar').first()).toBeVisible();
  // it stays in the palette for the next insert, and Checks says it is unchecked
  await expect(page.locator('.ins-item.runtime[data-type="Avatar"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Checks' }).click();
  await expect(page.locator('#issuesPanel')).toContainText('not checked against UI5 1.71');
});

test('a tree gets its nodes from a table with a table field, in one click', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Tree"]').click();
  await expect(selectedType(page)).toHaveText('Tree');
  await page.locator('#toast .toast-action', { hasText: 'Create nodes table' }).click();
  await expect(preview(page).getByText('First', { exact: true })).toBeVisible();
  const abap = await abapOf(page);
  expect(abap).toContain("parameters:\\{arrayNames:['NODES']\\}");
  expect(abap).toContain('nodes TYPE STANDARD TABLE OF ty_s_nodes_nodes WITH EMPTY KEY');
  expect(abap).toContain('( text = `First child` )');
  // the Data tab edits the nested rows
  await page.getByRole('tab', { name: 'Data' }).click();
  const card = page.locator('#dataPanel .attr', { has: page.locator('.subfields') });
  await expect(card.locator('input.aname')).toHaveValue('t_nodes');
  await expect(card.locator('.subfields input').first()).toHaveValue('TEXT');
  await card.locator('button', { hasText: '+ NODES row' }).first().click();
  await card.locator('.nested-rows input[type=text]').nth(2).fill('Third child');
  expect(await abapOf(page)).toContain('( text = `Third child` )');
  await page.getByRole('tab', { name: 'Checks' }).click();
  await expect(page.locator('#issuesPanel')).not.toContainText('✕');
});

test('a list inside a bound list repeats a table field of the row', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Tree"]').click();
  await page.locator('#toast .toast-action').click();
  // a list bound to t_nodes, a list in its row bound to NODES
  await page.locator('.ins-item[data-type="List"]').click();
  await page.locator('#inspector').getByRole('combobox', { name: 'Bind items to a table' }).selectOption('t_nodes');
  const listId = (await nodeIds(page, 'List')).at(-1);
  await page.evaluate((id) => window.designer.commit((d) => {
    const walk = (n) => { if (n.id === id) { n.aggs.items = [{ id: 'nx1', type: 'CustomListItem', props: {}, events: {}, aggs: { content: [{ id: 'nx2', type: 'List', props: {}, events: {}, aggs: {} }] } }]; } Object.values(n.aggs).flat().forEach(walk); };
    walk(d.root);
  }), listId);
  await page.evaluate(() => window.designer.select('nx2'));
  const rows = page.locator('#inspector').getByRole('combobox', { name: 'Bind items to a table' });
  await expect(rows.locator('optgroup')).toHaveAttribute('label', /table fields of the row/);
  await rows.selectOption('#NODES');
  const abap = await abapOf(page);
  expect(abap).toMatch(/n = `items` +v = `\{NODES\}`/);
  await expect(preview(page).getByText('Second child')).toBeVisible();
});

test('a view UI5 cannot render says why on the canvas, and the next edit renders again', async ({ designer: page }) => {
  const before = await page.evaluate(() => Number(document.body.dataset.renders || 0));
  await page.evaluate(() => window.designer.commit((d) => {
    d.root.aggs.content[0].aggs.content.push({ id: 'nbroken1', type: 'NoSuchControl', props: {}, events: {}, aggs: {} });
  }));
  await expect(page.locator('#previewStatus')).toContainText('does not render');
  await expect(page.locator('#previewStatus')).toContainText('NoSuchControl');
  await expect(page.locator('#previewStatus')).toHaveClass(/error/);
  // the way back: undo, and the canvas renders again - no render stays stuck
  await page.locator('#btnUndo').click();
  await expect.poll(() => page.evaluate(() => Number(document.body.dataset.renders || 0))).toBeGreaterThan(before + 1);
  await expect(page.locator('#previewStatus')).toBeHidden();
  await expect(preview(page).getByText('Customer data')).toBeVisible();
});

test('an abap2UI5 class opens as a design and exports as the same class', async ({ designer: page }) => {
  const original = await abapOf(page);
  await page.locator('#btnFile').click();
  await page.locator('#btnOpenClass').click();
  await page.locator('#dlg textarea').fill(original);
  await page.locator('#dlg').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('#dlg')).toContainText('Opened ZCL_MY_FORM');
  await page.locator('#dlg').getByRole('button', { name: 'OK' }).click();
  await expect(preview(page).getByText('Customer data')).toBeVisible();
  await expect(page.locator('#codeInfo')).toContainText('imported class');
  const back = await page.evaluate(() => window.designer.generateClassSource(window.designer.state.design));
  expect(back).toBe(original);
  await waitRendered(page);
});

test('?src= opens a class from a URL, with a report of what the editor keeps as ABAP', async ({ page, ui5 }) => {
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* fresh context */ } });
  await page.goto(`/index.html?ui5=${encodeURIComponent(ui5)}&src=/test/fixtures/z2ui5_cl_smp_app_493.clas.abap`);
  await expect(page.locator('#dlg')).toContainText('Opened Z2UI5_CL_SMP_APP_493');
  await expect(page.locator('#dlg')).toContainText('Kept as ABAP');
  await expect(page.locator('#dlg')).toContainText('Page.navButtonPress = client->_event_nav_app_leave( )');
  await page.locator('#dlg').getByRole('button', { name: 'OK' }).click();
  await waitRendered(page);
  await expect(preview(page).getByRole('heading', { name: 'Hello World', exact: true })).toBeVisible();
  expect(page.url()).not.toContain('src=');
  const abap = await page.evaluate(() => window.designer.generateClassSource(window.designer.state.design));
  expect(abap).toContain('" @keywords hello world');
  expect(abap).toContain(')->a( n = `navButtonPress` v = client->_event_nav_app_leave( )');
  expect(abap).toContain('      client->view_display( view->stringify( ) ).');
});

test('Open in Playground opens the playground with the class in the link', async ({ designer: page }) => {
  const original = await page.evaluate(() => window.designer.generateClassSource(window.designer.state.design));
  // the playground itself is not part of this test: its page is answered here
  await page.context().route('https://abap2ui5.github.io/playground/**', (route) => route.fulfill({ body: '<!doctype html><title>playground</title>', contentType: 'text/html' }));
  await page.locator('#btnExport').click();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#btnPlayground').click()]);
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(`${url.origin}${url.pathname}`).toBe('https://abap2ui5.github.io/playground/');
  const files = await popup.evaluate(async (fragment) => {
    const bytes = Uint8Array.from(atob(fragment.slice(1).replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));
    const text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    return JSON.parse(text);
  }, url.hash.slice(1));
  expect(files).toEqual([{ name: 'zcl_my_form.clas.abap', source: original }]);
});
