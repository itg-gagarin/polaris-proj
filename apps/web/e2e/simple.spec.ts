import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The default (simple) layout: Home → one product, big tools, plain words. */
async function openNightStand(page: Page, userId = 'u_sari') {
  await page.addInitScript(() => localStorage.setItem('bom.prefs.v1', JSON.stringify({ mode: 'simple' })));
  await page.goto('/login');
  await page.getByTestId(`login-${userId}`).click();
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Language').selectOption('en');
  await page.getByTestId('product-HH-CC-NIGHT-STAND').click();
  await expect(page.locator('[data-testid="focus-view"] canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Language').selectOption('en');
}

test('home lists the products and opens one in the 3D model view', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openNightStand(page);
  await expect(page.getByTestId('title-card')).toContainText('Night Stand');
  await expect(page.getByTestId('guide')).toContainText('Getting started');
  // Simple layout: no board, no command line.
  await expect(page.getByTestId('view-board')).toHaveCount(0);
  await expect(page.getByTestId('command-line')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await shot(page, '10-simple-model');
  expect(errors).toEqual([]);
});

test('pick a part, type a new length, undo it', async ({ page }) => {
  await openNightStand(page);
  await page.locator('.dock.left .tree-node').filter({ hasText: 'Panel Top' }).nth(1).click();
  const props = page.getByTestId('part-props');
  await expect(props).toContainText('Panel Top');
  const L = props.locator('input[aria-label="L size"]');
  await L.fill('725');
  await L.press('Enter');
  await expect(L).toHaveValue('725');
  await expect(page.getByTestId('guide-edit')).toHaveClass(/done/);
  await page.getByTestId('undo').click();
  await expect(L).not.toHaveValue('725');
});

test('zoom: buttons, Ctrl + and Shift+1', async ({ page }) => {
  await openNightStand(page);
  const value = page.getByTestId('zoom-value');
  await expect(value).toHaveText('100%');
  await page.getByTestId('zoom-in').click();
  await expect(value).toHaveText('125%');
  await page.locator('[data-testid="focus-view"] canvas').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('Control+Equal');
  await expect(value).toHaveText('156%');
  await page.keyboard.press('Shift+Digit1');
  await expect(value).toHaveText('100%');
  // Parts list zooms too.
  await page.getByTestId('view-parts').click();
  await page.getByTestId('zoom-out').click();
  await expect(value).toHaveText('80%');
});

test('screws & bolts: suggested positions with counts from the BOM', async ({ page }) => {
  await openNightStand(page);
  await page.getByTestId('toggle-fasteners').click();
  const legend = page.getByTestId('fastener-legend');
  await expect(legend).toContainText('sekrup');
  await expect(legend).toContainText('60 of 60 shown');
  await expect(legend).toContainText('mur nanas');
  await page.waitForTimeout(800);
  await shot(page, '11-fasteners');
  await page.getByTestId('toggle-fasteners').click();
});

test('add hardware: a knob on every drawer', async ({ page }) => {
  await openNightStand(page, 'u_margono');
  await page.getByTestId('add-menu').click();
  await page.getByTestId('add-hardware').click();
  const dlg = page.getByTestId('add-hardware-dialog');
  await dlg.getByTestId('hw-knob').click();
  await expect(dlg).toContainText('× 2 to the BOM');
  await shot(page, '12-add-hardware');
  await dlg.getByTestId('hw-add').click();
  await expect(page.getByTestId('part-props')).toContainText('handle knop');
  await expect(page.getByTestId('part-props').locator('input[inputmode="numeric"]')).toHaveValue('2');
  await page.getByTestId('undo').click();
});

test('views: drawing, parts list, checks', async ({ page }) => {
  await openNightStand(page);
  await page.getByTestId('view-drawing').click();
  await expect(page.locator('[data-testid="focus-view"] svg').first()).toBeVisible();
  await page.getByTestId('view-parts').click();
  await expect(page.getByTestId('bom-table')).toBeVisible();
  await page.getByTestId('view-checks').click();
  await expect(page.getByTestId('findings')).toContainText('Gap in the front frame');
  await expect(page.getByTestId('guide-checks')).toHaveClass(/done/);
});

test('settings: bigger text and the advanced layout', async ({ page }) => {
  await openNightStand(page);
  await page.getByTestId('open-settings').click();
  const s = page.getByTestId('settings');
  await s.getByText('Extra large').click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom').trim())).toBe('1.3');
  await shot(page, '13-settings');
  await s.getByText('Advanced — board, command line, all tools').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('view-board')).toBeVisible();
  await expect(page.getByTestId('command-line')).toBeVisible();
  await page.getByTestId('open-help').click();
  await expect(page.getByTestId('help')).toContainText('Keyboard shortcuts');
});
