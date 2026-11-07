# participation

Optional points for contributions. A separate record type (`participation`), off unless `settings.points` is on, and never read by evidence, retrieval, selection or any other module (only the service route `GET /participation/:id` and the answer receipt read it).

## Public interface (`index.ts`)
- `awardPoints(store, {orgId, personEntityId, contributionEventId, kind, summary, at, enabled})` -> `{awarded, event?, duplicate}`. Does nothing when `enabled` is false. The event id is derived from `contributionEventId`, so a retry never awards twice.
- `revokeContribution(store, contributionEventId)` withdraws the event (undo of an answer), so a re-answer can earn again.
- `balanceOf(store, personEntityId, enabled)` -> `ParticipationBalance`.
- `POINT_TABLE` / `pointsFor(kind)`: answer-yes 2, answer-no 2 (equal credit for a useful No), correction 3, evidence 2, outcome-report 3; answer-unknown, defer, dismiss 0 (neutral, never penalised).

## Dependencies
`contracts` only.

## Configuration
The point table is a constant; the on/off switch is `UserSettings.points`, passed in as `enabled`.

## Checks run
`node --test 'src/libs/utils/participation/**/*.test.ts'`: 4 tests passing (off means nothing recorded, retry does not double, No equals Yes and neutral kinds are 0, revoke then re-award). The service e2e test also covers the HTTP path.

## Known limitations
- Points are not a measure of answer quality or usefulness; nothing here judges correctness.
- Neutral events are stored only while points are on, so history before enabling is empty.
