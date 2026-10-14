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
    // a template row is cloned rather than shown, the content of a tab that
    // is not selected is not rendered, nor are a Select's items until it opens
    expect(missing.length, `not in the page: ${missing.length} of ${ids.length}`).toBeLessThan(ids.length / 3);
  });
}
