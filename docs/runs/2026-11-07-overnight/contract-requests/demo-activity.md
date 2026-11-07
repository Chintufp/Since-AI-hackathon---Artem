# Contract request from demo-mode: an "Activity" view in the panel

**From:** the demo-mode session (branch `claude/demo-mode-4c65f3`). **For:** whoever owns `src/libs/utils/ui/panel.ts` (not edited by this session). Until the panel has this view, judges watch the stream in a browser tab at `/demo/activity.html` (same type scale and palette as the panel), which is already served by the service.

## What exists on the service (added by this session, contract `ApiRoutes` in `contracts/service.ts`)

- `GET /demo/activity?since=<seq>&limit=<n>` → `ActivityView` `{ simulated: true, source, present, total, rows: ActivityRowView[] }`. Rows are the tail of a JSONL file written by `pnpm demo:play` (`data/local/demo-activity.jsonl`, git-ignored); `since` is the last `seq` the client has, `limit` defaults to 200 (max 1000). Missing file: `present: false`, no rows. The service never writes this file.
- `ActivityRowView`: `seq`, `at` (simulated ISO time), `real` (ISO, when written), `kind` (`evidence` | `investigation` | `question` | `answer` | `judge` | `agent` | `clock` | `note` | `summary`), `text` (one line), `who?` (display name), `why?` (plain-words reason), `detail?` (ids, family, recommendation kind, route), `simulated: true`, `forYou?` (true when the row concerns the person in Settings → You).
- `GET /demo/clock` → `{ mode: 'real' | 'simulated', now, rate }`: the engine's clock (the stream moves it so budgets count in simulated hours).
- `QuestionView.personEntityId?` (new optional field) names the recipient when `GET /questions` is listed without a person.

## The view the panel could add (small)

A fourth footer icon (or an entry under Settings → "Activity") opening a `rf-panel-content` list, same list styling as the Questions view:

- Row = `hh:mm` of `at` (local), then `text`; `why` beneath in the 12 px grey style used for *Why this question?*; `who` as the 11 px label used for case labels.
- Rows with `forYou` get the light `#f7f8f8` background and the label "for you".
- Poll `GET /demo/activity?since=<last seq>` every 2 s while the view is open (append only; keep at most the last 200 rows), and show the clock line from `GET /demo/clock` ("simulated 09:14") at the top.
- Header must say **Simulated** (the stream is synthetic; nothing in it is a real person or message). When `present` is false: "No activity yet. Run `pnpm demo:play`."
- Tapping a `question` row with `forYou` could open the Questions view (the badge already counts it).

Nothing in this view needs the service to change; the row shape is stable. If the panel would rather receive events than poll, a `since` cursor on `GET /events` already exists and the stream mirrors your own actions from it.
