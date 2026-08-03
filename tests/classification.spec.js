// @ts-check
const { test, expect } = require('@playwright/test');

const HUBLINK_IDEA = `Hublink is a specialized scientific data management platform designed to
automatically sync data from local device memory cards directly to the cloud. Instead of
relying on complex event-based syncing, it simplifies the process by transferring SD card
files with minimal battery drain and device disruption. Developed at WashU's Neurotech Hub,
it provides researchers across various experimental domains with a seamless, hassle-free way
to capture and store behavioral and experimental data.`;

const AMR_IDEA = `A novel beta-lactam/beta-lactamase inhibitor combination targeting
carbapenem-resistant Klebsiella pneumoniae (CRE) in hospitalized patients with limited
treatment options.`;

test.describe('Product classification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app.html');
  });

  test('Hublink classifies as Life Sciences Research, not clinical', async ({ page }) => {
    // Fill idea textarea
    await page.fill('#idea', HUBLINK_IDEA);
    await page.click('#run-btn');

    // Classification card should appear
    await expect(page.locator('.classification-card, [data-testid="cls-card"], #cls-card'))
      .toBeVisible({ timeout: 30_000 });

    // Domain should show LIFE_SCIENCES_RESEARCH variant
    const cardText = await page.locator('#clarify-panel').textContent({ timeout: 30_000 });
    expect(cardText).toMatch(/Life Sciences Research|Non-Clinical Research Tool/i);
    expect(cardText).not.toMatch(/Small Molecule|Clinical Drug|Life Sciences Clinical/i);
  });

  test('Hublink questions are AI-generated and relevant to research software', async ({ page }) => {
    await page.fill('#idea', HUBLINK_IDEA);
    await page.click('#run-btn');

    // Wait for question form to render (loading bar completes)
    await expect(page.locator('#clarify-panel .q-submit-btn, #clarify-panel button[type="button"]'))
      .toBeVisible({ timeout: 45_000 });

    const panelText = await page.locator('#clarify-panel').textContent();

    // Questions should NOT contain drug/clinical terminology
    expect(panelText).not.toMatch(/patient subset|treatment pathway|line of therapy|phase 1|phase 2|MIC\/IC50|approved drug/i);

    // Questions SHOULD relate to research software context
    expect(panelText).toMatch(/buyer|PI|lab|pricing|cost|institution|purchaser|researcher/i);
  });

  test('AMR drug classifies as Life Sciences Clinical', async ({ page }) => {
    await page.fill('#idea', AMR_IDEA);
    await page.click('#run-btn');

    const cardText = await page.locator('#clarify-panel').textContent({ timeout: 30_000 });
    expect(cardText).toMatch(/Life Sciences Clinical|Small Molecule|Drug/i);
  });

  test('classification card shows confidence and TRL', async ({ page }) => {
    await page.fill('#idea', HUBLINK_IDEA);
    await page.click('#run-btn');

    await expect(page.locator('#clarify-panel')).toBeVisible({ timeout: 15_000 });
    const text = await page.locator('#clarify-panel').textContent({ timeout: 30_000 });

    // Confidence percentage should appear
    expect(text).toMatch(/\d+%\s*confidence|confidence/i);
    // TRL should appear
    expect(text).toMatch(/TRL\s*\d/i);
  });
});
