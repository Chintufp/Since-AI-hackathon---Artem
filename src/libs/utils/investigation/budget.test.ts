/** The per-person budget's "today" is the local day of the quiet hours' time zone (review of the reward's burden term). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeStore, QuestionRecord } from '../contracts/index.ts';
import { computeBudget } from './budget.ts';
import { localDay } from '../questions/quiet-hours.ts';

const PID = 'person:t:erkki';
const store = (deliveredAt: string[]): KnowledgeStore => ({
  list: (kind: string) => (kind === 'question' ? deliveredAt.map((at, i) => ({ id: `q${i}`, personEntityId: PID, status: 'answered', deliveredAt: at }) as unknown as QuestionRecord) : []),
}) as unknown as KnowledgeStore;
const helsinki = { coordinator: { dailyLimitPerPerson: 3, cooldownMinutes: 0, quietHours: { start: '21:00', end: '07:00', timeZone: 'Europe/Helsinki' } } } as never;
const utc = { coordinator: { dailyLimitPerPerson: 3, cooldownMinutes: 0 } } as never;

test('localDay: the calendar date in the time zone, UTC without one', () => {
  assert.equal(localDay(new Date('2026-11-08T23:30:00Z'), 'Europe/Helsinki'), '2026-11-09');
  assert.equal(localDay(new Date('2026-11-08T23:30:00Z')), '2026-11-08');
  assert.equal(localDay(new Date('2026-07-01T21:30:00Z'), 'Europe/Helsinki'), '2026-07-02', 'summer time (UTC+3)');
});

test('a question delivered at 01:30 Helsinki time counts toward that Helsinki day, not the previous UTC day', () => {
  // 2026-11-09 01:30 Helsinki = 2026-11-08 23:30 UTC; "now" is 2026-11-09 10:00 Helsinki = 08:00 UTC.
  const s = store(['2026-11-08T23:30:00.000Z']);
  const now = new Date('2026-11-09T08:00:00.000Z');
  assert.equal(computeBudget(s, PID, helsinki, now).askedToday, 1);
  assert.equal(computeBudget(s, PID, utc, now).askedToday, 0, 'without quiet hours the day stays the UTC day');
  // 2026-11-08 23:30 Helsinki (21:30 UTC) is yesterday in Helsinki although it is the same UTC day as 22:30 UTC.
  assert.equal(computeBudget(store(['2026-11-08T21:30:00.000Z']), PID, helsinki, new Date('2026-11-08T22:30:00.000Z')).askedToday, 0);
});
