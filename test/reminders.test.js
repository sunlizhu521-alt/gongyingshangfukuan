import test from 'node:test';
import assert from 'node:assert/strict';
import { getReminderStage } from '../server/reminders.js';

test('returns reminder stage for due date', () => {
  assert.equal(getReminderStage('2026-06-20', new Date('2026-06-13')), '截止日前 7 天');
});
