// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Authentication & authorization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app.html');
  });

  test('unauthenticated user cannot generate a report', async ({ page }) => {
    await page.fill('#idea', 'A novel beta-lactam for MRSA treatment in outpatients.');
    await page.click('#run-btn');

    // Either redirects to login modal or shows an auth error — never starts a report
    const authModal = page.locator('#auth-modal, .auth-modal, [id*="auth"]');
    const loginPrompt = page.locator('text=/sign in|log in|session expired/i');
    await expect(authModal.or(loginPrompt)).toBeVisible({ timeout: 20_000 });
  });

  test('login modal opens and shows email/password fields', async ({ page }) => {
    // Find sign-in button
    const signInBtn = page.locator('#sign-in-btn, button:has-text("Sign In")').first();
    await signInBtn.click();

    await expect(page.locator('#login-email')).toBeVisible({ timeout: 5_000 });
  });

  test('invalid credentials show error message', async ({ page }) => {
    const signInBtn = page.locator('#sign-in-btn, button:has-text("Sign In")').first();
    await signInBtn.click();

    await page.fill('#login-email', 'notreal@example.com');
    // Find the password field (may be #login-password or similar)
    const pwField = page.locator('input[type="password"]').first();
    await pwField.fill('wrongpassword123');

    const submitBtn = page.locator('button:has-text("Sign In"), button[onclick*="submitLogin"]').first();
    await submitBtn.click();

    // Should show an error, not navigate away
    const errorMsg = page.locator('text=/invalid|incorrect|wrong|error/i, .error, [style*="dc2626"]');
    await expect(errorMsg).toBeVisible({ timeout: 10_000 });
  });

  test('report status endpoint returns 403 for wrong user', async ({ page, request }) => {
    // Directly call the API with a random job_id that belongs to no one
    const resp = await request.get(
      'https://web-staging-production-9c6a.up.railway.app/api/v1/alignment/pi-report/status/deadbeef12345678'
    );
    // Should be 404 (not found) or 403 (forbidden) — never 200 with another user's data
    expect([403, 404]).toContain(resp.status());
  });
});
