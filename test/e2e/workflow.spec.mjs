// Browser tests of the editor's working aids: undo that keeps the
// selection, quick fixes from the Checks, several controls at once, the
// outline filter, the data tab's order and pasted rows, the defaults of
// the canvas's UI5, the events of Preview mode, the designs of this browser.
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
const selected = (page) => page.evaluate(() => window.designer.state.selected);

test('undo brings back the control that was selected, redo the one after', async ({ designer: page }) => {
  const sw = (await nodeIds(page, 'Switch'))[0];
  await page.evaluate((id) => window.designer.select(id), sw);
  await page.keyboard.press('Delete');
  await expect.poll(() => nodeIds(page, 'Switch')).toEqual([]);
  expect(await selected(page)).not.toBe(sw);
  await page.keyboard.press('Control+Z');
  await expect.poll(() => selected(page)).toBe(sw);
  await expect(selectedType(page)).toHaveText('Switch');
});

test('Ctrl+arrow moves the selection among its siblings, also from the outline', async ({ designer: page }) => {
  const order = () => page.evaluate(() => {
    const form = window.designer.state.design.root.aggs.content[0].aggs.content.find((n) => n.type === 'form:SimpleForm');
    return form.aggs.content.map((n) => n.id);
  });
  const before = await order();
  await page.evaluate((id) => window.designer.select(id), before[0]);
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.locator('#layers .lrow.sel').focus();
  await page.keyboard.press('Control+ArrowDown');
  const after = await order();
  expect(after[1]).toBe(before[0]);
  expect(await selected(page)).toBe(before[0]);
});

test('the tabs of the drawer go by arrow key', async ({ designer: page }) => {
  await page.getByRole('tab', { name: 'Controls' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Outline' })).toBeFocused();
  await expect(page.locator('#panel-layers')).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.locator('#panel-issues')).toBeVisible();
});

test('a check with a fix: one click creates the attribute a binding names', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit((d) => {
    const input = d.root.aggs.content[0].aggs.content.find((n) => n.type === 'form:SimpleForm').aggs.content.find((n) => n.type === 'Input');
    input.props.value = { m: 'b', v: 'customer_city' };
  }));
  await page.getByRole('tab', { name: 'Checks' }).click();
  const line = page.locator('#issuesPanel .issue', { hasText: 'customer_city, which is not an attribute' });
  await expect(line).toBeVisible();
  // a click on the line shows the property it is about
  await line.locator('.itext').click();
  await expect(selectedType(page)).toHaveText('Input');
  await expect(prop(page, 'value').locator('select').first()).toBeFocused();
  await line.getByRole('button', { name: 'Create customer_city' }).click();
  await expect(line).toBeHidden();
  expect(await abapOf(page)).toMatch(/DATA customer_city +TYPE string\./);
});

test('an export with errors asks in the editor, and can show the checks instead', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit((d) => { d.className = '1BAD'; }));
  await page.locator('#btnZip').click();
  const dlg = page.locator('#dlg');
  await expect(dlg).toContainText('the class may not activate');
  await dlg.getByRole('button', { name: 'Show the checks' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.locator('#panel-issues')).toBeVisible();
});

test('an edit that fails says so until it is closed', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit(() => { throw new Error('Nothing works today'); }));
  const t = page.locator('#toast.error');
  await expect(t).toContainText('Nothing works today');
  await page.waitForTimeout(3000);
  await expect(t).toBeVisible();
  await t.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#toast')).not.toHaveClass(/show/);
});

test('an event name the design has already is offered again', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  await page.locator('#inspector .event input').first().fill('SAVE_ALL');
  await page.locator('.ins-item[data-type="Button"]').click();
  await expect(page.locator('#inspector datalist#eventNames option[value="SAVE_ALL"]')).toBeAttached();
  await expect(page.locator('#inspector .event input').first()).toHaveAttribute('list', 'eventNames');
});

test('the properties show the default of the canvas\'s UI5', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  await expect(prop(page, 'type').locator('.val select option').first()).toHaveText('— default (Default) —');
  await expect(prop(page, 'enabled').locator('.val select option').first()).toHaveText('— default (true) —');
});

test('the outline filter shows the matches and the way to them', async ({ designer: page }) => {
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.locator('#layersFilter').fill('switch');
  await expect(page.locator('#layers .lrow[data-id]', { hasText: 'Switch' })).toHaveCount((await nodeIds(page, 'Switch')).length);
  await expect(page.locator('#layers .lrow[data-id]', { hasText: /^.?Label/ })).toHaveCount(0);
  await expect(page.locator('#layers .lrow[data-id]', { hasText: 'Page' }).first()).toBeVisible();
  await page.locator('#layersFilter').fill('nothing-is-called-so');
  await expect(page.locator('#layers')).toContainText('No control matches.');
});

test('several controls: Ctrl+click in the outline, wrap them, delete them', async ({ designer: page }) => {
  const labels = await page.evaluate(() => {
    const form = window.designer.state.design.root.aggs.content[0].aggs.content.find((n) => n.type === 'form:SimpleForm');
    return form.aggs.content.slice(0, 2).map((n) => n.id);
  });
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.locator(`#layers .lrow[data-id="${labels[0]}"]`).click();
  await page.locator(`#layers .lrow[data-id="${labels[1]}"]`).click({ modifiers: ['Control'] });
  await expect(page.locator('#layers .lrow.sel')).toHaveCount(2);
  await expect(page.locator('#inspector .multi-bar')).toContainText('2 controls selected');
  await expect(preview(page).locator('.dsg-also')).toHaveCount(1);
  await page.locator('#inspector .multi-bar select').selectOption('HBox');
  const box = await page.evaluate(() => {
    const hit = window.designer.state.design;
    const walk = (n) => { if (n.type === 'HBox') return n; for (const l of Object.values(n.aggs || {})) for (const c of l) { const r = walk(c); if (r) return r; } return null; };
    const b = walk(hit.root);
    return b && b.aggs.items.map((n) => n.id);
  });
  expect(box).toEqual(labels);
  await waitRendered(page);
  // and two again, deleted with one key
  await page.locator(`#layers .lrow[data-id="${labels[0]}"]`).click();
  await page.locator(`#layers .lrow[data-id="${labels[1]}"]`).click({ modifiers: ['Shift'] });
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate((ids) => ids.filter((id) => document.querySelector(`#layers .lrow[data-id="${id}"]`)).length, labels)).toBe(0);
});

test('several controls copied go into the clipboard together', async ({ designer: page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sw = await nodeIds(page, 'Switch');
  const before = (await nodeIds(page, 'Label')).length;
  const ids = await page.evaluate(() => {
    const form = window.designer.state.design.root.aggs.content[0].aggs.content.find((n) => n.type === 'form:SimpleForm');
    return form.aggs.content.filter((n) => n.type === 'Label').slice(0, 2).map((n) => n.id);
  });
  await page.evaluate((x) => { window.designer.select(x[0]); window.designer.select(x[1], { extend: true }); }, ids);
  await page.locator('body').click({ position: { x: 5, y: 300 } }).catch(() => {});
  await page.evaluate(() => window.designer.copySelection(false));
  await page.evaluate(() => window.designer.pasteSelection());
  await expect.poll(async () => (await nodeIds(page, 'Label')).length).toBe(before + 2);
  expect((await nodeIds(page, 'Switch')).length).toBe(sw.length);
});

test('attributes change their order, rows come pasted from a spreadsheet', async ({ designer: page }) => {
  await page.getByRole('tab', { name: 'Data' }).click();
  await page.locator('#dataPanel').getByRole('button', { name: '+ Table' }).click();
  const card = page.locator('#dataPanel .attr').last();
  const name = await card.locator('.aname').inputValue();
  await card.getByRole('button', { name: 'Move attribute up' }).click();
  await expect(page.locator('#dataPanel .attr').nth(-2).locator('.aname')).toHaveValue(name);
  await page.locator('#dataPanel .attr').nth(-2).getByRole('button', { name: 'Paste rows…' }).click();
  await page.locator('#dlg textarea').fill('Text\tCity\nAnna\tBerlin\nBen\tParis');
  await page.locator('#dlg').getByRole('button', { name: 'Paste' }).click();
  const at = await page.evaluate((n) => window.designer.state.design.attributes.find((a) => a.name === n), name);
  expect(at.fields.map((f) => f.name)).toEqual(['TEXT', 'CITY']);
  expect(at.rows).toEqual([{ TEXT: 'Anna', CITY: 'Berlin' }, { TEXT: 'Ben', CITY: 'Paris' }]);
});

test('Preview mode lists the events and what the user changed', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  await page.locator('#inspector .event input').first().fill('GO');
  await waitRendered(page);
  await page.locator('[data-mode="interact"]').click();
  await preview(page).getByRole('button', { name: 'Button' }).last().click();
  await expect(page.locator('#eventLog')).toBeVisible();
  await expect(page.locator('#eventLog')).toContainText('GO');
  await page.locator('[data-mode="design"]').click();
  await expect(page.locator('#eventLog')).toBeHidden();
});

test('a design saved in this browser opens again from the list', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.commit((d) => { d.className = 'ZCL_KEPT'; }));
  await page.locator('#btnFile').click();
  await page.locator('#btnSaveBrowser').click();
  await page.evaluate(() => window.designer.commit((d) => { d.className = 'ZCL_OTHER'; }));
  await page.locator('#btnFile').click();
  await page.locator('#btnRecent').click();
  await page.locator('#dlg .starter', { hasText: 'ZCL_KEPT' }).click();
  await expect(page.locator('#className')).toHaveValue('ZCL_KEPT');
});

test('the context menu of the outline wraps, the one of the canvas deletes', async ({ designer: page }) => {
  const sw = (await nodeIds(page, 'Switch'))[0];
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.evaluate((id) => window.designer.select(id), sw);
  await page.locator(`#layers .lrow[data-id="${sw}"]`).click({ button: 'right' });
  const menu = page.locator('.menu.ctx');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Panel' }).click();
  await expect(menu).toBeHidden();
  expect(await page.evaluate((id) => {
    const walk = (n, parent) => { if (n.id === id) return parent && parent.type; for (const l of Object.values(n.aggs || {})) for (const c of l) { const r = walk(c, n); if (r) return r; } return null; };
    return walk(window.designer.state.design.root, null);
  }, sw)).toBe('Panel');
  await waitRendered(page);
  await preview(page).locator('[id*="--n"][role="switch"]').first().click({ button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await expect.poll(() => nodeIds(page, 'Switch')).toEqual([]);
  // and by key: Shift+F10 opens it at the selection, Escape closes it
  await page.locator('#layers .lrow.sel').focus();
  await page.keyboard.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('selected rows of the outline drag together', async ({ designer: page }) => {
  const ids = await page.evaluate(() => {
    const form = window.designer.state.design.root.aggs.content[0].aggs.content.find((n) => n.type === 'form:SimpleForm');
    return form.aggs.content.slice(0, 2).map((n) => n.id);
  });
  await page.evaluate(() => window.designer.addControl('VBox', 'root'));
  const box = (await nodeIds(page, 'VBox')).at(-1);
  await page.getByRole('tab', { name: 'Outline' }).click();
  await page.evaluate((x) => { window.designer.select(x[0]); window.designer.select(x[1], { extend: true }); }, ids);
  await page.locator(`#layers .lrow[data-id="${ids[1]}"]`).dragTo(page.locator(`#layers .lrow[data-id="${box}"]`));
  await expect.poll(() => page.evaluate((id) => {
    const walk = (n) => { if (n.id === id) return n; for (const l of Object.values(n.aggs || {})) for (const c of l) { const r = walk(c); if (r) return r; } return null; };
    return (walk(window.designer.state.design.root).aggs.items || []).map((n) => n.id);
  }, box)).toEqual(ids);
});

test('the controls inserted last come first, the properties of one go onto another', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  await page.locator('.ins-item[data-type="Title"]').click();
  await expect(page.locator('.ins-group.recent .ins-item')).toHaveText([/Title/, /Button/]);
  // a Button with a type, its properties onto a new Button
  await page.locator('.ins-group.recent [data-recent="Button"]').click();
  await prop(page, 'type').locator('.val select').selectOption('Emphasized');
  await page.keyboard.press('Control+K');
  await page.locator('#cmdkInput').fill('copy properties');
  await page.keyboard.press('Enter');
  await page.locator('.ins-group.recent [data-recent="Button"]').click();
  await page.keyboard.press('Control+K');
  await page.locator('#cmdkInput').fill('paste properties');
  await page.keyboard.press('Enter');
  await expect(prop(page, 'type').locator('.val select')).toHaveValue('Emphasized');
});

test('an empty container has room on the canvas to drop into', async ({ designer: page }) => {
  await page.evaluate(() => window.designer.addControl('VBox', 'root'));
  const box = (await nodeIds(page, 'VBox')).at(-1);
  const el = preview(page).locator(`[id$="--${box}"]`);
  await expect(el).toHaveClass(/dsg-empty/);
  expect((await el.boundingBox()).height).toBeGreaterThan(30);
  await page.locator('[data-mode="interact"]').click();
  await expect(el).not.toHaveClass(/dsg-empty/);
});

test('a design saved by another tab is announced, and can be loaded', async ({ designer: page, context }) => {
  const other = await context.newPage();
  await other.goto(page.url());
  await waitRendered(other);
  await other.evaluate(() => window.designer.commit((d) => { d.className = 'ZCL_FROM_THE_OTHER_TAB'; }));
  await expect(page.locator('#toast')).toContainText('Another tab of the editor');
  await page.locator('#toast').getByRole('button', { name: 'Load theirs' }).click();
  await expect(page.locator('#className')).toHaveValue('ZCL_FROM_THE_OTHER_TAB');
  await other.close();
});

test('an opened class shows what the export changes in it', async ({ designer: page }) => {
  await expect(page.locator('#btnDiff')).toBeHidden();
  const original = await abapOf(page);
  await page.locator('#btnFile').click();
  await page.locator('#btnOpenClass').click();
  await page.locator('#dlg textarea').fill(original);
  await page.locator('#dlg').getByRole('button', { name: 'Open', exact: true }).click();
  await page.locator('#dlg').getByRole('button', { name: 'OK' }).click();
  await page.locator('#btnDiff').click();
  await expect(page.locator('#code')).toContainText('No change');
  await page.evaluate(() => window.designer.commit((d) => { d.root.aggs.content[0].props.title = { m: 's', v: 'Changed title' }; }));
  await expect(page.locator('#codeInfo')).toContainText('+1 −1');
  await expect(page.locator('#code .ln.add')).toContainText('Changed title');
  await expect(page.locator('#code .ln.del')).toHaveCount(1);
});

test('a double-click on the canvas edits the text of a control there', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="Button"]').click();
  const id = await selected(page);
  await waitRendered(page);
  await preview(page).locator(`[id$="--${id}"]`).dblclick();
  const field = page.locator('.inline-edit');
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Button');
  await field.fill('Ship it');
  await page.keyboard.press('Enter');
  await expect(field).toHaveCount(0);
  await expect(preview(page).getByText('Ship it')).toBeVisible();
  // Escape takes the edit back
  await preview(page).locator(`[id$="--${id}"]`).dblclick();
  await page.locator('.inline-edit').fill('Not this');
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate((x) => {
    const walk = (n) => { if (n.id === x) return n; for (const l of Object.values(n.aggs || {})) for (const c of l) { const r = walk(c); if (r) return r; } return null; };
    return walk(window.designer.state.design.root).props.text.v;
  }, id)).toBe('Ship it');
});

test('the editor is light, dark or as the system, and keeps the choice', async ({ designer: page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || '');
  expect(await theme()).toBe('');
  await page.locator('#btnTheme').click();
  expect(await theme()).toBe('light');
  await page.locator('#btnTheme').click();
  expect(await theme()).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(18, 23, 28)');
  // kept with the preferences (a reload here would start from a cleared store)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('abap2ui5-designer:prefs')).appearance)).toBe('dark');
});

test('a wrap that cannot be done says why, never that it was done', async ({ designer: page }) => {
  await page.evaluate(() => { window.designer.addControl('VBox', 'root'); });
  const outer = (await nodeIds(page, 'VBox')).at(-1);
  await page.evaluate((id) => window.designer.addControl('VBox', id), outer);
  const inner = (await nodeIds(page, 'VBox')).at(-1);
  // a VBox inside another and a Switch elsewhere: not side by side
  const sw = (await nodeIds(page, 'Switch'))[0];
  await page.evaluate((x) => { window.designer.select(x[0]); window.designer.select(x[1], { extend: true }); }, [inner, sw]);
  await page.keyboard.press('Control+K');
  await page.locator('#cmdkInput').fill('wrap in panel');
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast.error')).toContainText('side by side');
  await expect(page.locator('#toast')).not.toContainText('Wrapped');
});

test('a list line without content is no empty container on the canvas', async ({ designer: page }) => {
  await page.locator('.ins-item[data-type="List"]').click();
  const list = await selected(page);
  await page.evaluate((id) => window.designer.addControl('ObjectListItem', id), list);
  const item = (await nodeIds(page, 'ObjectListItem')).at(-1);
  await waitRendered(page);
  await expect(preview(page).locator(`[id$="--${item}"]`).first()).not.toHaveClass(/dsg-empty/);
});
