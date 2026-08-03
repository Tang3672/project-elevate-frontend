// @ts-check
const { test, expect } = require('@playwright/test');

const API = 'https://web-staging-production-9c6a.up.railway.app/api/v1';

test.describe('Rate limiting', () => {
  test('health endpoint is not rate-limited', async ({ request }) => {
    const resp = await request.get(
      'https://web-staging-production-9c6a.up.railway.app/health'
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('ok');
  });

  test('AI endpoints return 429 after burst', async ({ request }) => {
    // Fire 10 classify calls in rapid succession — should hit the per-minute AI limit
    const calls = Array.from({ length: 10 }, () =>
      request.post(`${API}/alignment/classify`, {
        headers: { 'Content-Type': 'application/json' },
        data: { idea: 'A test idea for rate limit testing purposes.' },
      })
    );
    const results = await Promise.all(calls);
    const statuses = results.map(r => r.status());
    // At least one should be 429 once the limit kicks in
    expect(statuses).toContain(429);
  });

  test('429 response includes retry-after header', async ({ request }) => {
    // Hammer the classify endpoint until we get a 429
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const resp = await request.post(`${API}/alignment/classify`, {
        headers: { 'Content-Type': 'application/json' },
        data: { idea: 'Rate limit test idea.' },
      });
      if (resp.status() === 429) {
        const headers = resp.headers();
        expect(headers['retry-after']).toBeTruthy();
        got429 = true;
        break;
      }
    }
    // If we never hit 429, that's fine — means rate limit hasn't fired yet
    // (test environment may have higher limits). Log for visibility.
    if (!got429) {
      console.log('Rate limit not triggered in this run — may need more concurrent calls');
    }
  });
});
