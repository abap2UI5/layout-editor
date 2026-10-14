import { test as base, expect } from '@playwright/test';

// `ui5`: the version the preview boots (project option, see the config)
export const test = base.extend({
  ui5: ['', { option: true }],
  designer: async ({ page, ui5 }, use) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* fresh context */ } });
    await page.goto(`/index.html?ui5=${encodeURIComponent(ui5)}`);
    await waitRendered(page);
    await use(page);
  },
});

// the preview reports every render; a design is shown once its controls are in the frame
export async function waitRendered(page) {
  await expect(page.frameLocator('#preview').locator('[id^="dsg"][id*="--n"]').first()).toBeAttached({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => document.body.dataset.previewError || '')).toBe('');
}

export async function abapOf(page) {
  return page.evaluate(() => window.designer.generateClass(window.designer.state.design));
}

export { expect };
