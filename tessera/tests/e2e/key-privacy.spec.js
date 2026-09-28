// M3 acceptance: a personal API key is stored only in the browser. Every request the page
// makes is inspected: the key goes to api.anthropic.com and nowhere else, and it never
// appears in the database or in an exported world. The Anthropic API is intercepted, so
// this also exercises the vendored SDK end to end in a real browser.
import { test, expect } from '@playwright/test';
import { boot, becomePersona, waitIdle } from './helpers.js';

const KEY = 'sk-ant-e2e-SECRET-0123456789abcdefghijklmnop';

test('a contributor’s own API key is sent only to the provider and never stored by Tessera', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => requests.push({ url: r.url(), headers: r.headers(), body: r.postData() || '' }));
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
  let anthropicCalls = 0;
  await page.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    anthropicCalls++;
    const body = JSON.parse(req.postData());
    let text;
    if (/copilot/i.test(body.system)) text = 'Start by listing the terms the flyer repeats.';
    else {
      const ids = [...body.messages.at(-1).content.matchAll(/"id": "(c\d+)"/g)].map((m) => m[1]);
      text = JSON.stringify({ purpose: 'Build the glossary the translators will share.', setup: ['Open a spreadsheet.'], steps: ['List the repeated terms.', 'Translate each one.'], checklist: [...new Set(ids)].map((id) => ({ criterionId: id, text: `Criterion ${id} holds` })), pitfalls: ['Inconsistent terms.'] });
    }
    await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json', 'request-id': 'req_e2e' }, body: JSON.stringify({ id: 'msg_e2e', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 321, output_tokens: 123 } }) });
  });

  await boot(page, '?reset=1&crowd=off&fast=1&seed=e2e-keys');
  // Set up a commission with an offer to Lucía (through the API; the test is about keys).
  const tileId = await page.evaluate(async () => {
    const T = window.tessera;
    const c = await T.api.postCommission('usr_tom', { title: 'Spanish version of our library card flyer and FAQ', goal: 'Translate our one-page library card signup flyer and FAQ into plain Spanish.', budgetCents: 40000, deadline: T.clock.now() + 10 * 86400000, privacy: 'PUBLIC' });
    await T.worker.drain();
    T.api.answerScoping('usr_tom', c.id, {});
    await T.worker.drain();
    T.api.fundCommission('usr_tom', c.id);
    await T.worker.drain();
    const o = T.db.find('Offer', (x) => x.commissionId === c.id && x.response === 'PENDING' && x.contributorId === 'usr_lucia');
    return o.tileId;
  });

  await becomePersona(page, 'Lucía Hernández');
  await page.goto('#/profile');
  await page.getByRole('radio', { name: /My own API key/ }).check();
  await page.locator('#ukey').fill(KEY);
  await page.getByRole('button', { name: 'Save key' }).click();
  await page.getByRole('button', { name: 'Save profile' }).first().click();
  await waitIdle(page);

  await page.goto(`#/t/${tileId}`);
  await page.getByRole('button', { name: 'Accept and claim' }).first().click();
  await page.getByRole('button', { name: 'Write my brief' }).click();
  await expect(page.getByText(/Written by claude-sonnet-5-5 \(anthropic\)/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask the copilot' }).fill('How do I start?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Start by listing the terms the flyer repeats.')).toBeVisible();
  expect(anthropicCalls).toBe(2);

  const toAnthropic = requests.filter((r) => r.url.startsWith('https://api.anthropic.com/'));
  expect(toAnthropic.some((r) => r.headers['x-api-key'] === KEY)).toBe(true);
  expect(toAnthropic.every((r) => r.headers['anthropic-dangerous-direct-browser-access'] === 'true' || r.body === '')).toBe(true);
  const leaks = requests.filter((r) => !r.url.startsWith('https://api.anthropic.com/') && (r.url.includes(KEY) || JSON.stringify(r.headers).includes(KEY) || r.body.includes(KEY)));
  expect(leaks).toEqual([]);

  // Not in the database, not in its IndexedDB copy, not in AgentRun logs, not in an export.
  await page.evaluate(() => window.tessera.flush());
  const stored = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('tessera');
    req.onsuccess = () => { const tx = req.result.transaction('world', 'readonly'); const g = tx.objectStore('world').get('current'); g.onsuccess = () => resolve(JSON.stringify(g.result)); };
  }));
  expect(stored.length).toBeGreaterThan(1000);
  expect(stored.includes(KEY)).toBe(false);
  expect(await page.evaluate(() => JSON.stringify(window.tessera.db.snapshot()))).not.toContain(KEY);
  await page.goto('#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export world' }).click()]);
  const exported = await (await download.createReadStream()).toArray();
  expect(Buffer.concat(exported).toString('utf8')).not.toContain(KEY);
  // It is in this browser's localStorage, which is where it is meant to live.
  expect(await page.evaluate(() => Object.values(localStorage).some((v) => v.startsWith('sk-ant-e2e')))).toBe(true);
});
