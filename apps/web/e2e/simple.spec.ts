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

test('search the parts list, then add a note on the part', async ({ page }) => {
  await openNightStand(page);
  await page.getByTestId('part-search').fill('profil datar');
  await expect(page.getByTestId('outliner')).toContainText('1 found');
  await page.getByTestId('part-search').press('Enter');
  await expect(page.getByTestId('part-props')).toContainText('frame profil datar atas - bwh');
  await page.getByTestId('note-input').fill('Check the cutting length against the leg gap');
  await page.getByTestId('note-post').click();
  await expect(page.getByTestId('part-notes')).toContainText('Check the cutting length against the leg gap');
  await expect(page.getByTestId('note-pin').first()).toBeVisible();
});

test('detail drawing: part sheet with corners, an AutoCAD DXF attached, assembly sheets', async ({ page }) => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'dxf-'));
  const P = (...pairs: (string | number)[][]) => pairs.map(([c, v]) => `${c}\n${v}`).join('\n');
  const dxf = [P([0, 'SECTION'], [2, 'HEADER'], [9, '$INSUNITS'], [70, 4], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']), P([0, 'CIRCLE'], [8, 'OUTLINE'], [10, 0], [20, 0], [40, 15]), P([0, 'TEXT'], [8, 'TEXT'], [10, -15], [20, 20], [40, 4], [1, 'KNOP']), P([0, 'ENDSEC'], [0, 'EOF'])].join('\n') + '\n';
  writeFileSync(join(dir, 'knob.dxf'), dxf);
  await openNightStand(page, 'u_margono');
  await page.getByTestId('part-search').fill('profil datar');
  await page.getByTestId('part-search').press('Enter');
  await page.getByTestId('view-detail').click();
  await expect(page.getByTestId('part-sheet')).toContainText('18 × 55 × 489');
  await expect(page.getByTestId('corner-A')).toContainText('frame kaki depan');
  page.once('dialog', (d) => d.dismiss());
  await page.getByTestId('drawing-file').setInputFiles(join(dir, 'knob.dxf'));
  await expect(page.getByTestId('dxf-svg')).toBeVisible();
  await expect(page.getByTestId('drawing-card')).toContainText('knob.dxf');
  await shot(page, '14-detail');
  await page.getByTestId('detail-assembly').click();
  await expect(page.getByTestId('assembly-table')).toBeVisible();
  const label = page.locator('.asm-nav strong');
  const first = await label.innerText();
  await page.getByTestId('asm-next').click();
  await expect(label).not.toHaveText(first);
  await shot(page, '15-assembly');
});

test('follow someone: their product, view, take-apart and selection', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const a = await ctx.newPage();
  await openNightStand(a, 'u_margono');
  const b = await ctx.newPage();
  await b.goto(a.url());
  await expect(b.locator('[data-testid="focus-view"] canvas')).toBeVisible({ timeout: 60_000 });
  await b.getByLabel('Language').selectOption('en');
  await b.locator('[data-testid^="follow-u_"]').first().click();
  await expect(b.getByTestId('follow-banner')).toBeVisible();
  // A takes the model apart, picks a part and opens the parts list: B follows.
  await a.getByTestId('take-apart').fill('0.6');
  await expect(b.getByTestId('take-apart')).toHaveValue('0.6');
  await a.getByTestId('part-search').fill('panel top');
  await a.getByTestId('part-search').press('Enter');
  await expect(b.getByTestId('part-props')).toContainText('Panel Top');
  await a.getByTestId('view-parts').click();
  await expect(b.getByTestId('view-parts')).toHaveAttribute('aria-selected', 'true');
  await b.getByTestId('follow-stop').click();
  await expect(b.getByTestId('follow-banner')).toHaveCount(0);
  await ctx.close();
});
