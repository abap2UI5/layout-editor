import { test, expect, waitRendered, abapOf } from './fixtures.mjs';

const preview = (page) => page.frameLocator('#preview');
const nodeIds = (page, type) => page.evaluate((t) => {
  const out = [];
  const walk = (n) => { if (n.type === t) out.push(n.id); for (const l of Object.values(n.aggs || {})) l.forEach(walk); };
  walk(window.designer.state.design.root);
  return out;
}, type);

test('starts with a design that renders and a class that is ready', async ({ designer: page }) => {
  await expect(page.locator('#outline')).toContainText('SimpleForm');
  await expect(preview(page).getByText('Customer data')).toBeVisible();
  const abap = await abapOf(page);
  expect(abap).toContain('CLASS zcl_my_form DEFINITION PUBLIC.');
  await expect(page.locator('#issueCount')).toBeHidden();
});

test('a control dragged from the palette onto the preview lands in the view', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Button')).length;
  const pageId = (await nodeIds(page, 'Page'))[0];
  await page.locator('.pal-item[data-type="Button"]').dragTo(preview(page).locator(`[id$="--${pageId}-cont"]`));
  await expect.poll(async () => (await nodeIds(page, 'Button')).length).toBe(before + 1);
  await expect(page.locator('#rpane-props .title')).toContainText('Button');
  await waitRendered(page);
});

test('a control dragged onto the outline goes where it is dropped', async ({ designer: page }) => {
  const formRow = page.locator('#outline .trow', { hasText: 'SimpleForm' });
  await page.locator('.pal-item[data-type="CheckBox"]').dragTo(formRow);
  const parent = await page.evaluate(() => {
    let hit = null;
    const walk = (n) => { for (const l of Object.values(n.aggs || {})) for (const c of l) { if (c.type === 'CheckBox') hit = n.type; walk(c); } };
    walk(window.designer.state.design.root);
    return hit;
  });
  expect(parent).toBe('form:SimpleForm');
});

test('clicking a control in the preview selects it', async ({ designer: page }) => {
  await preview(page).getByText('City', { exact: true }).click();
  await expect(page.locator('#rpane-props .title')).toContainText('Label');
  await expect(page.locator('#outline .trow.sel')).toContainText('City');
});

test('a property edited in the panel shows in the preview and the class', async ({ designer: page }) => {
  await page.locator('.pal-item[data-type="Button"]').click();
  const text = page.locator('#rpane-props .prow', { has: page.locator('label', { hasText: /^text$/ }) }).locator('.val input');
  await text.fill('Approve order');
  await expect(preview(page).getByText('Approve order')).toBeVisible();
  expect(await abapOf(page)).toContain('v = `Approve order`');
  await expect(text).toBeFocused();
});

test('binding a property to a new attribute and naming an event reach the class', async ({ designer: page }) => {
  await page.locator('.pal-item[data-type="Input"]').click();
  const row = page.locator('#rpane-props .prow', { has: page.locator('label', { hasText: /^value$/ }) });
  await row.locator('select.mode').selectOption('b');
  await row.getByRole('button', { name: 'New attribute' }).click();
  const ev = page.locator('#rpane-props .erow', { has: page.locator('label', { hasText: /^submit$/ }) }).locator('input');
  await ev.fill('check_input');
  const abap = await abapOf(page);
  expect(abap).toMatch(/DATA input_value +TYPE string\./);
  expect(abap).toContain('v = client->_bind( input_value )');
  expect(abap).toContain('v = client->_event( `CHECK_INPUT` )');
  expect(abap).toContain('WHEN `CHECK_INPUT`.');
  await page.getByRole('tab', { name: 'Data' }).click();
  await expect(page.locator('#rpane-data .aname').last()).toHaveValue('input_value');
});

test('a list bound to a new table repeats its template per row', async ({ designer: page }) => {
  await page.locator('.pal-item[data-type="List"]').click();
  await page.locator('#rpane-props').getByRole('button', { name: '+ Table' }).click();
  await expect(preview(page).getByText('Second')).toBeVisible();
  expect(await abapOf(page)).toContain("v = client->_bind( t_items )");
});

test('undo and redo', async ({ designer: page }) => {
  const before = (await nodeIds(page, 'Title')).length;
  await page.locator('.pal-item[data-type="Title"]').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before + 1);
  await page.locator('#btnUndo').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before);
  await page.locator('#btnRedo').click();
  await expect.poll(async () => (await nodeIds(page, 'Title')).length).toBe(before + 1);
});

test('the abapGit ZIP downloads with the class in it', async ({ designer: page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnZip').click()]);
  expect(download.suggestedFilename()).toBe('zcl_my_form.zip');
  const buf = Buffer.from(await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c)));
  const text = buf.toString('latin1');
  for (const f of ['.abapgit.xml', 'src/package.devc.xml', 'src/zcl_my_form.clas.abap', 'src/zcl_my_form.clas.xml']) expect(text).toContain(f);
  expect(text).toContain('CLASS zcl_my_form DEFINITION PUBLIC.');
});

test('a UI5 XML view imports into an editable design', async ({ designer: page }) => {
  await page.locator('#btnImport').click();
  await page.locator('#dlg textarea').fill(`<mvc:View xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core">
    <Page title="Imported">
      <Button text="Go" press=".onGo"/>
      <Text text="{/SOME/PATH}"/>
      <core:Icon src="sap-icon://accept"/>
    </Page>
  </mvc:View>`);
  await page.locator('#dlg').getByRole('button', { name: 'Import' }).click();
  await expect(preview(page).getByText('Go')).toBeVisible();
  await expect(page.locator('#outline')).toContainText('Imported');
  const abap = await abapOf(page);
  expect(abap).toContain(')->tag( `Button`');
  expect(abap).toContain("v = `{/SOME/PATH}`");
  expect(abap).not.toContain('onGo');
});

test('a new design from a starter', async ({ designer: page }) => {
  await page.locator('#btnNew').click();
  await page.locator('#dlg .starter', { hasText: 'Table with search' }).click();
  await waitRendered(page);
  await expect(preview(page).getByText('Notebook')).toBeVisible();
  expect(await abapOf(page)).toContain('CLASS zcl_my_table DEFINITION PUBLIC.');
});
