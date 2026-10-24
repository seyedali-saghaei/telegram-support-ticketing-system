import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/production-port.js', import.meta.url), 'utf8');

test('channel updates use configurable allowlists', () => {
  assert.match(source, /u\.channel_post/);
  assert.match(source, /env\.TEST_CHANNEL_IDS/);
  assert.match(source, /env\.PRODUCTION_CHANNEL_IDS/);
  assert.match(source, /editMessageReplyMarkup/);
  assert.match(source, /env\.SUPPORT_BOT_URL/);
});

test('conversation and sheets features are present', () => {
  assert.match(source, /ensureThreadSchema/);
  assert.match(source, /awa_thread_events/);
  assert.match(source, /message_replies/);
  assert.match(source, /syncSheets/);
});

test('no organization-specific channel identifiers are committed', () => {
  assert.doesNotMatch(source, /-100\d{8,}/);
  assert.doesNotMatch(source, /AwaSupportChatBot|VereinAwa|AWA_BUTTON|AWA_TEST_CHANNEL_POST/);
});

test('public Worker contains no Persian script', () => {
  assert.doesNotMatch(source, /[\u0600-\u06ff]/);
});
