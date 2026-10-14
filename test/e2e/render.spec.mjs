// Every test design renders in the preview - on the current UI5 and on 1.71
import { test, expect, waitRendered } from './fixtures.mjs';
import { allDesigns } from '../fixtures.mjs';

for (const [id, design] of allDesigns()) {
  test(`${id} renders @render`, async ({ designer: page }) => {
    // wait for the render of THIS design: the preview counts every render
    const before = await page.evaluate(() => Number(document.body.dataset.renders || 0));
    await page.evaluate((d) => window.designer.commit((cur) => { Object.keys(cur).forEach((k) => delete cur[k]); Object.assign(cur, d); }, { force: true }), design);
    await expect.poll(() => page.evaluate(() => Number(document.body.dataset.renders || 0))).toBeGreaterThan(before);
    expect(await page.evaluate(() => document.body.dataset.previewError || '')).toBe('');
    await waitRendered(page);
    // every control of the design is in the page
    const ids = [];
    const walk = (n) => { if (n.id !== 'root') ids.push(n.id); for (const l of Object.values(n.aggs || {})) l.forEach(walk); };
    walk(design.root);
    const frame = page.frameLocator('#preview');
    const missing = [];
    for (const nid of ids) {
      const n = await frame.locator(`[id$="--${nid}"], [id*="--${nid}-"]`).count();
      if (!n) missing.push(nid);
    }
    // what UI5 does not put in the page: the content of a tab that is not
    // selected, the items of a dropdown until it opens, the pages of a
    // carousel after the first, a tab container's items (their content is
    // in the page), a lazily loaded object page section - and what depends on the width of the
    // canvas: what an overflow toolbar moves into its menu, the links a
    // breadcrumb folds, a column with a minimum screen width, the content
    // of a tile that is not loaded
    const expected = hiddenByUi5(design.root);
    const where = {};
    const place = (n, path) => { where[n.id] = `${path}/${n.type}`; for (const [a, l] of Object.entries(n.aggs || {})) l.forEach((ch) => place(ch, `${path}/${n.type}.${a}`)); };
    place(design.root, '');
    const unexpected = missing.filter((id) => !expected.has(id)).map((id) => where[id]);
    expect(unexpected, `not in the page though it should be: ${unexpected.join(', ')}`).toEqual([]);
  });
}

function hiddenByUi5(root) {
  const hidden = new Set();
  const mark = (n) => { hidden.add(n.id); for (const l of Object.values(n.aggs || {})) l.forEach(mark); };
  const walk = (n) => {
    for (const [agg, list] of Object.entries(n.aggs || {})) {
      list.forEach((ch, i) => {
        if (['IconTabBar', 'Carousel', 'Wizard', 'TabContainer', 'SlideTile'].includes(n.type) && i > 0) mark(ch);
        else if (n.type === 'MenuButton' || n.type === 'MenuItem') mark(ch);
        else if (n.type === 'TabContainer') { hidden.add(ch.id); if (i > 0) mark(ch); else walk(ch); } // an item is no element, its content is
        else if (n.type === 'uxap:ObjectPageLayout' && agg === 'sections' && i > 0) mark(ch); // lazy loading in the kitchen sink
        else if (ch.type === 'core:HTML') mark(ch); // renders its content, no element of its own
        else if (n.type === 'table:Column' && agg === 'template') mark(ch); // cloned per row, shown with rows only
        else if (['Select', 'ComboBox', 'MultiComboBox'].includes(n.type) && agg === 'items') mark(ch);
        else if (n.type === 'MultiInput' && agg === 'tokens') mark(ch);
        else if (n.type === 'OverflowToolbar' || n.type === 'Breadcrumbs') mark(ch);
        else if (n.type === 'Table' && agg === 'columns' && ch.props.minScreenWidth) mark(ch);
        else if (n.type === 'GenericTile' && n.props.state && n.props.state.v !== 'Loaded') mark(ch);
        else walk(ch);
      });
    }
  };
  walk(root);
  return hidden;
}
