# participation

Optional points for contributions (R46). A separate record pair (`participation` events, `participationOptin` per person), never read by evidence, retrieval, selection or any other module; only the service's points routes, the answer receipt and the panel's Points & rating view read it.

## Public interface (`index.ts`)
- `getOptIn(store, personEntityId)` / `participates(store, personEntityId)` / `setOptIn(store, {orgId, personEntityId, participates, at})`: one `ParticipationOptIn` record per person, default no. `since` is the date of the current choice (an unchanged choice keeps it).
- `awardPoints(store, {orgId, personEntityId, contributionEventId, kind, summary, refId?, at, participates})` -> `{awarded, event?, duplicate}`. Records nothing unless `participates` (the recipient's choice at the time of the contribution). The event id is derived from `contributionEventId`, so a retry never awards twice. `summary` must be neutral wording ("Answered a question (yes)"); `refId` is the question / investigation / evidence id, never text.
- `revokeContribution(store, contributionEventId)` withdraws the event (undo of an answer), so a re-answer can earn again.
- `balanceOf(store, personEntityId)` -> `ParticipationBalance`: `{participates: false, points: 0, events: []}` for a person who does not take part (their rows stay stored, hidden).
- `rating(store, {displayName, personEntityId?, now})` -> `ParticipationRating`: only people who take part, sorted by all-time balance (ties share a rank), with points in the last `RECENT_DAYS` = 7 days, answers and outcome reports per person, totals, and `me` (balance, rank, last 10 events) for the given person when they take part.
- `POINT_TABLE` / `pointsFor(kind)`: answer-yes 2, answer-no 2 (equal credit for a useful No), correction 3 (an observation recorded for one's own investigation), evidence 2 (authored evidence that became a claim, once per evidence record, at import), outcome-report 3; answer-unknown, defer, dismiss 0 (neutral, never penalised).

## Dependencies
`contracts` only.

## Configuration
The point table is a constant. Taking part is the person's own record (`PUT /participation/:id/optin`, only by that person); `UserSettings.points` is only the device's display switch for the receipt's +N.

## Checks run
`node --test 'src/libs/utils/participation/**/*.test.ts'`: 6 tests (no record without opt-in, retry does not double, No equals Yes and neutral kinds are 0, revoke then re-award, opt-out hides and keeps rows, rating order / shared ranks / recent window / privacy). `tests/points.test.ts` covers the HTTP path (opt-in gating and 403s, every award kind, undo, evidence at import, rating privacy).

## Known limitations
- Points are not a measure of answer quality or usefulness; nothing here judges correctness.
- Contributions made before a person opted in earn nothing retroactively; neutral events are stored only while the person takes part.
