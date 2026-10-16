import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** These tests drive the advanced layout (board, command line, all tools); simple.spec.ts covers the default one. */
async function login(page: Page, userId: string) {
  await page.addInitScript(() => localStorage.setItem('bom.prefs.v1', JSON.stringify({ mode: 'advanced', guideHidden: true })));
  await page.goto('/login');
  await page.getByTestId(`login-${userId}`).click();
  await expect(page.getByTestId('home')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('home-board').click();
  await page.waitForURL(/\/board\//);
  await expect(page.getByTestId('board')).toBeVisible();
  await page.getByLabel('Language').selectOption('en');
  await expect(page.getByTestId('bom-table').first()).toBeVisible();
}

test('editor loads the Hollan board: 3D, sheet, BOM, checks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'u_margono');
  await expect(page.locator('[data-type="viewport"] canvas').first()).toBeVisible();
  await expect(page.locator('[data-type="sheet"] svg').first()).toBeVisible();
  await expect(page.getByTestId('findings').first()).toContainText('fail');
  await page.waitForTimeout(1500);
  await shot(page, '01-board');
  expect(errors).toEqual([]);
});

test('select a BOM row, edit a size with the command line, undo it', async ({ page }) => {
  await login(page, 'u_margono');
  const row = page.locator('[data-testid="bom-table"] tr[data-part]').filter({ hasText: /front/i }).first();
  await row.click();
  await expect(row).toHaveClass(/selected/);
  await page.getByTestId('tab-properties').click();
  await expect(page.getByTestId('properties')).toContainText(/front/i);
  const cmd = page.getByTestId('command-line');
  await cmd.fill('SET L 401.5');
  await cmd.press('Enter');
  await expect(page.getByTestId('command-result')).toContainText('L = 401.5');
  await expect(page.getByTestId('properties').locator('input[aria-label="L size"]')).toHaveValue('401.5');
  await shot(page, '02-edit');
  await cmd.fill('UNDO');
  await cmd.press('Enter');
  await expect(page.getByTestId('properties').locator('input[aria-label="L size"]')).not.toHaveValue('401.5');
});

test('view commands reach the 3D frame after working in the BOM table', async ({ page }) => {
  await login(page, 'u_margono');
  await page.locator('[data-testid="bom-table"] tr[data-part]').first().click();
  const cmd = page.getByTestId('command-line');
  await cmd.fill('LENS PAINTING');
  await cmd.press('Enter');
  await cmd.fill('SECTION X 300');
  await cmd.press('Enter');
  const vp = page.locator('[data-frame="fr_ns_3d"]');
  await expect(vp).toHaveAttribute('data-lens', 'painting');
  await expect(vp).toHaveAttribute('data-section', 'x:300');
  await page.waitForTimeout(800);
  await shot(page, '02b-lens-section');
});

test('AI optimize: suggestion with per-change review, compare frame, accept', async ({ page }) => {
  await login(page, 'u_margono');
  await page.locator('[data-type="viewport"]').first().click({ position: { x: 200, y: 160 } });
  await page.getByTestId('ai-optimize').click();
  await expect(page.getByTestId('ai-panel')).toContainText('After all accepted', { timeout: 30_000 });
  await expect(page.getByTestId('compare')).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, '03-ai');
  await page.getByTestId('ai-accept').click();
  await expect(page.locator('.toast').filter({ hasText: 'AI optimize, accepted by Margono' })).toBeVisible();
});

test('review lanes, meeting setup and markup note', async ({ page }) => {
  await login(page, 'u_margono');
  await page.locator('[data-type="viewport"]').first().click({ position: { x: 200, y: 160 } });
  await page.getByTestId('tab-review').click();
  await expect(page.getByTestId('review')).toContainText('Packing');
  await shot(page, '04-review');
  await page.getByTestId('tab-meeting').click();
  await expect(page.locator('.dock.right')).toContainText('product meeting');
  await page.getByTestId('join-mtg_ns_r5').click();
  await expect(page.getByTestId('meeting-panel')).toContainText('Agenda');
  await shot(page, '05-meeting');
  // Sticky note on empty board space (left of the frames, once the left panel is folded away).
  await page.getByLabel('Collapse panel').first().click();
  await page.getByTestId('tool-note').click();
  const board = page.getByTestId('board');
  const box = (await board.boundingBox())!;
  await page.mouse.click(box.x + 120, box.y + 300);
  await expect(page.getByPlaceholder('Note…')).toBeFocused();
  await page.keyboard.type('Check the reveal gap on the top drawer');
  await page.mouse.click(box.x + 120, box.y + box.height - 160);
  await expect(page.getByText('Check the reveal gap on the top drawer')).toBeVisible();
  await shot(page, '06-note');
});

test('external buyer sees only shared products', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-u_buyer').click();
  await page.waitForURL(/\/shared/);
  await expect(page.locator('h1')).toContainText('Shared with');
});

test('two tabs co-edit live (BroadcastChannel sync) and see each other', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const a = await ctx.newPage();
  await login(a, 'u_margono');
  const b = await ctx.newPage();
  await b.goto(a.url());
  await expect(b.getByTestId('bom-table').first()).toBeVisible();
  await b.getByLabel('Language').selectOption('en');
  // Presence: the other tab appears as a second person here.
  await expect(a.getByText('2 here')).toBeVisible();
  const rowA = a.locator('[data-testid="bom-table"] tr[data-part]').filter({ hasText: 'Panel Top' }).first();
  await rowA.click();
  const cmd = a.getByTestId('command-line');
  await cmd.fill('SET W 433.5');
  await cmd.press('Enter');
  const rowB = b.locator('[data-testid="bom-table"] tr[data-part]').filter({ hasText: 'Panel Top' }).first();
  await expect(rowB.locator('input[aria-label="Panel Top W"]')).toHaveValue('433.5', { timeout: 5000 });
  await ctx.close();
});

test('import a workbook through the match preview', async ({ page }) => {
  await login(page, 'u_sari');
  await page.locator('.more-menu > summary').click();
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles(new URL('../../../fixtures/products/hollan-house-curated-craftsman.xlsx', import.meta.url).pathname);
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-dialog')).toContainText('HH-CC-NIGHT-STAND', { timeout: 30_000 });
  await shot(page, '07-import');
  await page.getByTestId('import-commit').click();
  await expect(page.locator('.toast').filter({ hasText: 'Imported 11 product(s)' })).toBeVisible({ timeout: 30_000 });
});

test('password-protected original workbook imports (local only)', async ({ page }) => {
  const file = new URL('../../../fixtures/private/hollan-house-rev5.encrypted.xlsx', import.meta.url).pathname;
  const { existsSync } = await import('node:fs');
  test.skip(!process.env.HOLLAN_PASSWORD || !existsSync(file), 'needs the private workbook and HOLLAN_PASSWORD');
  await login(page, 'u_sari');
  await page.locator('.more-menu > summary').click();
  await page.getByTestId('open-import').click();
  await page.getByTestId('import-file').setInputFiles(file);
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-dialog')).toContainText(/password/i, { timeout: 30_000 });
  await page.locator('input[type="password"]').fill(process.env.HOLLAN_PASSWORD!);
  await page.getByTestId('import-preview').click();
  await expect(page.getByTestId('import-dialog')).toContainText('legacy', { timeout: 60_000 });
});
