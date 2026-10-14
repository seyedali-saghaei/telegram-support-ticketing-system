import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('health endpoint exposes generic service name', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), {}, { waitUntil() {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, 'telegram-support-ticketing-system');
});

test('webhook rejects requests without configuration', async () => {
  const response = await worker.fetch(new Request('https://example.test/telegram', { method: 'POST' }), {}, { waitUntil() {} });
  assert.equal(response.status, 503);
});

test('unknown paths return 404', async () => {
  const response = await worker.fetch(new Request('https://example.test/unknown'), {}, { waitUntil() {} });
  assert.equal(response.status, 404);
});

test('webhook rejects invalid secret', async () => {
  const env = { DB: {}, BOT_TOKEN: 'placeholder', TELEGRAM_WEBHOOK_SECRET: 'secret', BOARD_CHAT_ID: '-123', ADMIN_USER_IDS: '456' };
  const response = await worker.fetch(new Request('https://example.test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' } }), env, { waitUntil() {} });
  assert.equal(response.status, 403);
});
