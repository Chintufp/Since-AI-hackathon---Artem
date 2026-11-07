# Decisions · Day 2 integration (day2/b2 models merged after day2/b1 engine)

Merge commit `e844b0b` ("Merge day2/b2 (models) into the run branch"). day2/b1 (engine: validity, `at`, GET /context,
access facts, quiet hours, standing gaps; DECISIONS-engine.md) was already merged; day2/b2 (models: slots, providers,
embeddings, case cards, extractor-llm, phrase slot, store health + reward, Settings -> Models, E08-E10;
DECISIONS-models.md) conflicted in 15 files. Every conflict keeps both sides; where the two could not both hold as
written, the judgement is recorded here.

After the merge: `pnpm typecheck` clean, `pnpm test` 507/507 pass (private/ present), `node --test experiments/*.test.ts`
23/23 pass.

## D-INT-01 · Plain unions (no judgement beyond keeping both)

- `contracts/questions.ts`: `QuestionCandidate` keeps B1's `origin?: 'standing'` and `pile?: 'later'` and B2's
  `templateText?` and `phrasing?`. `deliverAfter` and `answerType: 'free-text'` came in without conflict.
- `contracts/service.ts`: imports both `ContextAssertionsView` (B1) and the model slot types (B2).
- `org-config.ts`: one import of `ModelSlots, QuietHours`; `defaultQuietHours`, `defaultStandingGaps` and
  `DEFAULT_MODEL_SLOTS` are all exported.
- `views.ts`: `questionView` carries B1's `deliverAfter` (while held) and `answerType: 'free-text'`, then B2's
  `wordedBy`/`templateText`.
- `memory/index.ts`: exports both B1's context-assertions/standing-gaps/validity and B2's case card; the
  extractor-llm/enrich exports merged cleanly. `ImportFromPathRequest` has both `standing` and `onCommitted`.
- `http.ts`: one schema import list with `contextQuerySchema` and the four model schemas.
- `service/README.md`: B1's "part B" section, then B2's "Model slots" section.
- `ui/styles.css`: B1-side panel styles (info tooltip, similar cases, thumbnails, Connections page) and B2's Models
  styles. `ui/mock-api.test.ts`: B1's GET /context mock test and B2's three Models mock tests.

## D-INT-02 · Route count is 40

The route table in `http.ts` has 40 entries: the 32 before day 2, B1's `GET /context`, and B2's seven model routes
(`GET /models`, `POST /models/pull`, `GET /models/pull/:id`, `POST /models/test`, `POST /models/key`,
`POST /models/install`, `GET /models/install`). B1's tests said 33, B2's said 39; both `tests/e2e.test.ts` and
`tests/points.test.ts` now assert 40, and e2e checks `GET /context` by name along with the model routes.

## D-INT-03 · Order inside importFromPath: standing gaps, then onCommitted

`recordStandingGaps` (when `standing` is passed) runs right after the rules commit, then `onCommitted` hands the
threads to the extract slot. `onCommitted` only collects the items (the model pass runs afterwards, awaited, in
`Engine.importAndEnrich`), so the order does not change what the rules import records.

## D-INT-04 · On the model import path, standing gaps are re-recorded and asked after the union

`Engine.importData` asks standing gaps (B1) only when it is NOT called with `onCommitted` (the rules-only path: demo
reset, scripts, extract on rules). `importAndEnrich` (extract on local/api) does it after the model's union instead:
when the model committed claims it calls `recordStandingGaps` again over the union, then asks (when
`standingGaps.ask`). Reason: otherwise the background ask races the awaited model pass and may ask about a symptom the
model's proposal is about to supply. With extract on rules the path is exactly B1's.

## D-INT-05 · Engine.answer keeps both tails

After an answer: the receipt is built (B1 order), `afterChange()` starts the embedding refresh when `autoModels` is on
(B2), then `await askStanding()` (B1). After an import: `afterChange()` runs on both paths (B2), as in B2.
Engine imports keep `evaluateEligibility` (B1) and add `PhrasedQuestionGenerator` and `LinUcb` (B2).

## D-INT-06 · The reward's quiet-hours burden term uses B1's quiet hours (fix)

B2's coordinator `burden()` compared `HH:MM` of the UTC clock against `quietHours.start/end`, written before B1's
`QuietHours` existed. B1's quiet hours are local wall-clock hours in an IANA zone (`Europe/Helsinki` in org-config), so
the UTC comparison would charge the term at the wrong hours (two or three hours off). The term now calls B1's
`inQuiet(now, quietHours)` from `questions/quiet-hours.ts`. Weights (`BURDEN`) unchanged. No test exercised the
mismatch; existing reward tests run without quiet hours and are unaffected.

## D-INT-07 · B1's standing kinds are not phrased by the model

`PhraseFacts.kind` widens to `'missing' | 'outcome' | 'missing-symptom' | 'pairing'` so the template generator can
return facts for every candidate (`generateDetailed`). `PhrasedQuestionGenerator` phrases only quick yes/no candidates
of the investigation kinds (`missing`, `outcome`); a missing-symptom question (free text, opens with "You ...") and a
pairing question (names two cases) keep the template wording and carry no `phrasing` mark, like evaluative
candidates. Reason: B2's validator requires a yes/no opener and checks the condition label or action noun of the two
kinds it was built for; a free-text question would always be rejected, and the pairing question's consequences name
both cases, which the validator does not check. This is a scope cut, not a refusal: phrasing the standing kinds needs
its own checks. No dedicated test was added for this guard (follow-up).

## D-INT-08 · E08/E10 run on the store they were recorded on, without B1's follow-ups

After the merge two experiment tests failed: the E08 paraphrase probe chose TRN-042 as its target, and the
embed=local service test found three texts with no recorded vector. Cause: B1's demo reset always imports
`data/demo/followups` (D-B1-16), and Erkki's 14 Oct note names TRN-042, so the probe's "Elisa present?" check
(`entity TRN-042 exists`) became true on a clean store, and the follow-up texts were never embedded when E08 was
recorded (outputs are hash-locked; re-recording needs Ollama, and this integration is offline). The experiments'
`demoEngine` and the embed=local service test now pass `NO_FOLLOWUPS` (follow-up directories that do not exist, which
the reset skips), exported from `experiments/runners-models.ts`. The real demo reset (service, judge demo) still
imports the follow-ups. Not done: re-running `node experiments/run.ts e08|e10` to confirm the committed results are
reproduced byte-for-byte after the merge, and recording vectors for the follow-up texts.

## D-INT-09 · Model status chip styles are scoped to the Models view (fix)

B2 added `#kt-panel .rf-chip { border-radius:999px; max-width:60%; white-space:nowrap; ... }` for the slot status
chip, but `.rf-chip` is also the attachment chip in the input view (the run branch's thumbnail chips use it). The four
B2 chip rules are now `#kt-panel .rf-models-view .rf-chip...`, so attachment chips look as before and the Models view
is unchanged.

## D-INT-10 · Panel views and Back

`ViewName` has both `'connections'` (run branch, Artem 7 Nov) and `'models'` (B2). `BACK` is the union
(`result -> input`, `connections -> settings`, `models -> settings`, plus the shared entries), and the `back` action
keeps the run branch's people-from-case rule. Settings shows both rows (Models, Connections); the action switch has
both the `connections`/`conn` cases and B2's `models`/`model-*` cases.

## D-INT-11 · Standing answers carry no measured reward (left as built)

B2's reward (store-metric delta minus burden, `selector.update`) is measured in `QuestionCoordinator.answer` for
investigation questions. B1's standing answers go through `answerStanding`, which B2 never saw; they still write the
evaluation's response but no `assessedBenefit` and no selector update. Extending the reward to standing answers would be
new behaviour on neither branch (and D-B2-51 already notes that the metric reads an applicability "no" as a
contradiction), so it is left for a later decision rather than invented during the merge.

## D-INT-12 · The standing pass after an answer shares the answer's phrase budget (review fix)

Review found that `Engine.answer` awaited `askStanding()`, which built a second wiring, so a second
`PhrasedQuestionGenerator` with its own 20 s budget, and that its eligibility pre-check called `generate()` on that
generator: every standing state checked cost a phrase call, plus another when the question was requested. With phrase on
a slow (not stuck) local model, one POST /questions/:id/answer could wait 20 s in the answer and another 20 s in the
standing pass, against D-B2-57's one budget per request and the 40 s client timeout. Now `askStanding(w)` takes the
wiring, `answer` passes its own, and the pre-check uses the plain templates (`wiring().templates`; recipients do not
depend on the wording), so only the requested question is phrased. Upkeep and imports still build one wiring per pass.
Measured with a fake local provider: upkeep with two due outcome gaps made 3 phrase calls before, 1 after.
Reverse: drop the parameter and use `w.generator` in the pre-check.

## Review of the merge (7 Nov): outcome

A reviewer checked the merge file by file (nothing lost from either side, 40 routes, 9 MCP tools, 507 tests green, E10
reproduces exactly) and raised five minor findings. All five were confirmed against the code and fixed:

1. **E08 results were stale for the merged code.** Confirmed: `node experiments/run.ts e08` on HEAD changed the demo
   problem remote-power-access-p2 from `retain-uncertainty` / `no-question-needed` to `none` / `deferred` in every
   variant, and the demo access denominator from 46 to 42 (leakage 1/46 -> 1/42), because of B1's access-facts change
   (E00 on the run branch already showed `none`). Recall@3, lookalike-top-1 and the paraphrase probe ranks are unchanged.
   Fixed: E08 re-run and committed, `experiments/RESULTS.md` regenerated with `report`. E00 and E10 were re-run as well
   and differ only in timings (not committed). D-B2-61's "replay to the same numbers" was true on day2/b2; on the merged
   code the fixtures still replay (hash-locked) but the demo store they read changed. This also closes the open item in
   D-INT-08 for E08/E10.
2. **Service README said 33 routes.** Confirmed (router: 40). Fixed, and the two undocumented routes
   (`GET /demo/activity`, `GET /demo/activity.html`) got a row.
3. **README said every answer writes a reward.** Confirmed: standing answers return through `answerStanding` before
   measure/burden/learn (D-INT-11). The README now says investigation answers only and points to D-INT-11. DECISIONS-models
   D-B2 text is B2's own record and is left as written; this entry is the correction.
4. **No test for the quiet-hours burden (D-INT-06).** Confirmed. Added to `questions/quiet-hours.test.ts`: the same answer
   with and without quiet hours differs by exactly `BURDEN.quiet` at 21:00Z (23:00 EET) and not at all at 05:30Z
   (07:30 EET, inside 22:00-07:00 only on the UTC clock). A UTC comparison in `burden()` fails it (checked).
5. **Standing outcome questions go to the phrase model; answer latency.** Partly as stated. The standing outcome question
   uses the same template as an investigation outcome question ("Did ... right after <action> on <case>?") and carries
   no computed "when" words; those are only in missing-symptom and pairing questions, which `phraseable()` excludes. So
   phrasing it is intended and goes through the validator, which requires the action noun. The latency part was real and
   is fixed by D-INT-12. New `tests/standing-phrase.test.ts`: pairing and missing-symptom never reach the model and keep
   their wording; a standing outcome reply is accepted or, when it drops the action, rejected to the template; one phrase
   call per asked question; an answer builds one wiring. The last two fail on the previous engine (checked), the first
   fails when the guard is widened (checked).

Typecheck clean, 511/511 tests (507 + 4 new).

## D-INT-13 · Day 2 lanes merged in the order b3, b4, b5, b7

The stray panel fix in the checkout (the missing `</section>` after the Connections grid) was committed alone first
(b90b2d9). day2/b3 carries the same line (4b5c1dd), so the b3 merge took it without a conflict; panel.ts has 12 opening
and 12 closing `<section>` tags after all four merges. Merged with `--no-ff`, typecheck and the full suite run after each:
511 -> 538 (b3) -> 571 (b4) -> 582 (b5) -> 601 (b7), every lane's own count added in full, so no lane test was lost.

## D-INT-14 · Conflicts resolved by keeping both sides

- b4: `ui/mock-api.test.ts` (B3's provenance and /costs mock tests next to B4's POST /import paste test) and `ui/styles.css`
  (B3's provenance strip and cost row rules, then B4's Remember this button and offer chip). Plain union.
- b5: `contracts/views.ts` ResultView carries both `provenance?` (B3) and `alternatives?` (B5); `service/views.ts`
  spreads both; `ui/mock-api.ts` mock investigate returns both; `docs/DEMO.md` keeps B4's "### Remember this" and then
  B5's "## Experts disagree" section. The panel already rendered both (setProvenance under the heading, "Also on record"
  lines in the result notes), auto-merged.
- b7: `service/engine.ts` imports, the union of B3/B4's (`ImportFromPathResult`, `earliestDated`) and B7's
  (`AGENT_WORDING_EVENT`, `AgentWordedGenerator`, `checkAgentWording`, `templateFor`, `BatchItem`, `visibleCase`).
  Engine.storeHealth (B3's per-viewer cost store line) and B7's storeHealthView (kt_store_health) sit on the same method
  without conflict.
No shared decision file (DECISIONS-engine/models/integration) was appended by more than one lane; each lane's own
DECISIONS-view/capture/disagree/inquiry.md came in unchanged.

## D-INT-15 · Counts: 42 HTTP routes, 12 MCP tools

B3 added two routes (GET /context.html and GET /costs), not one, so the union is 42, not the 41 the integration brief
guessed; B4 rides on POST /import and B5/B7 add no routes. The route assertions in `tests/e2e.test.ts` and
`tests/points.test.ts` already said 42 from b3 and stay. MCP_TOOLS has 12 entries (9 + B7's kt_list_gaps,
kt_propose_question, kt_store_health; the three are MCP only); `tests/mcp.test.ts` says 12 from b7.

## D-INT-16 · Post-merge checks

- `node --test experiments/*.test.ts` 23/23; `node experiments/run.ts e00` 17/17, results differed in timings only and
  were dropped (`git checkout -- experiments/results`).
- With every slot on rules nothing new calls out: the new `fetch` calls are the activity and context pages and
  `scripts/mcp-demo.ts` talking to the local service. Agent wording (B7) is the route `agent-worded@1` (route `rules`) in
  `models/routes.ts`, no model of ours runs. The Slack poller (B4) uses the fake workspace unless `KT_SLACK_LIVE`, a token,
  a workspace, a channel and a people file are all given (`pollerGuard` in `scripts/slack-poll.ts`); `slack-live.ts` and
  its `slack.com/api` client predate the day. Slack is a connector, not a model route, so it is not in routes.ts.
- Quiet hours: `pnpm demo:agent` (scripts/mcp-demo.ts) starts mcp.ts with `--quiet-hours on` unless `--day`;
  `pnpm demo:judge` defaults `--quiet-hours off` (D-B1-35 holds for the judge; B7 turns them on only for demo:agent).
- Remember this: POST /import goes through importAndEnrich; with extract on rules that is importData, and every claim a
  paste creates carries `route: rules, version: rules-extractor@1` (checked on a pasted two-line thread: 6 of 6 claims);
  on a model slot the enrich step traces `import.enriched` with its route as before.
- The b3 merge needed Artem's uncommitted README.md moved aside (b3 adds a Context Layer line): his diff was saved as a
  patch, the file checked out, merged, and the patch applied back uncommitted. His other files were not touched.

Typecheck clean, 601/601 tests.

## D-INT-17 · Review of the four-lane merge: outcome

Two read-only reviews ran on 27efa33. The merge review found no lost behaviour: every line a lane added or deleted is
in HEAD as many times as the lanes put it there (the one difference is the intended union of the retrieval import in
engine.ts), no conflict markers, and the test deltas add up (+27, +33, +11, +19 = 659 declarations). The adversarial
review checked where the lanes meet (store health, unit.batch through the gap tools, one answer flipping both expert
branches, quiet hours, Remember this, zod schemas against contracts, the 3-minute script) and found no major issue.
Six minor findings, all confirmed and all fixed:

- **B7 test total** (DECISIONS-inquiry.md): "526 after B7" was +15; the lane added 19. Now 530 (511 + 19). Lane log
  drift, not a merge loss.
- **Experts disagree, recipient** (DEMO.md): reproduced on an in-memory elisa service (quiet hours off): after the
  TRN-301 question is answered by Erkki, the TRN-577 question goes to Helmi Virtanen ("through their group
  (transport)"), Erkki has none; on a fresh reset it goes to Erkki. DEMO.md now says so and tells the presenter to switch
  to whoever the status line names, or to run the section first after a reset.
- **Experts disagree, the No branch** (DEMO.md): reproduced: No gives the qualified "Confirm the unit details (older
  unit) before disabling and re-enabling the interface." with "Unknown for this unit: older unit." and a second question
  "Is TRN-577 an older unit?" to Helmi. DEMO.md now describes that instead of "Erkki's reset becomes the recommendation".
- **Slack connectors outside routes.ts and the guard** (connectors/slack-*.ts): the three clients' default fetch is now
  `slackNetworkFetch` (new `connectors/slack-net.ts`): route label `slack-web@1` (route `api`, not a model) in
  ROUTE_REGISTRY, refused with NetworkProviderBlockedError before any request unless KT_SLACK_LIVE=1, and only to
  https://slack.com; it looks up globalThis.fetch per request, so installNetworkGuard still applies on top. Injected
  fetches (tests, fake workspace) are unchanged. This corrects D-INT-16's "Slack is not in routes.ts". The MCP process
  not passing `{noApi: true}` stays a non-defect (keys are in memory only). Test: `slack-net.test.ts` (3).
- **demo:agent and the stream fight over the clock** (scripts/mcp-demo.ts): the script now reads /demo/clock before
  moving it; when it is already simulated (the stream drives it) it warns, still moves it to 07:30 for the delivery, and
  does not reset it to real time afterwards, so the stream keeps its clock. DEMO.md step 5 says to run demo:agent before
  the stream starts (240 s) or with `demo:judge -- --no-stream`. Test: source assertions in `tests/service-main.test.ts`
  (the script is not run in tests).
- **Raw entity id in the first judge row** (simulation/runner.ts): the runner reads /directory before the first
  refreshJudge (opt-ins still wait for refreshDirectory, so R46 holds). Test: `tests/demo-stream.test.ts` asserts the
  row reads "You are Jukka Salo in the companion"; it failed on the old runner with "You are ent_06ee…".

Commits d8356c0, 8231903, 00a8ac5. Typecheck clean, 604/604 tests (601 + 3).

## R5 hardening (day2/r5-guard)

- **D-INT-20, the network guard runs in the service.** `src/apps/service/guard.ts` (`installServiceGuard`, `deriveAllowlist`)
  installs `installNetworkGuard` in `main.ts` before listening. `NetworkGuardOptions.allowOrigins` may now be a function and
  there is an `onBlock` hook; the allowlist is evaluated per fetch from `engine.modelSlots()`, so `PUT /settings` takes
  effect on the next call with no re-install. Allowed: nothing with every slot on rules; the Ollama origin for a local slot;
  the two hosted-model origins for an api slot only when KT_NO_API is not 1; slack.com only under KT_SLACK_LIVE=1; the
  service's own origin (local pages, mcp-demo). A refusal logs the route label it was missing (`ORIGIN_ROUTES` in
  routes.ts; "none" for a host no route reaches). Decision: the spec says nothing on rules, so GET /models detection also
  cannot reach Ollama until a slot is local; flagged in the service README rather than carved out. Tests:
  `tests/service-guard.test.ts` (2), `tests/service-main.test.ts` (source order). demo:judge and demo:agent unaffected
  (separate processes talking to the service port).
- **D-INT-21, provenance on /investigate was not a defect.** Reproduced on a clean clone (no private/, default reset, port
  47996, KT_NO_API=1): `{text, principal}` and the page body `{text, principal, entityIds, allowQuestions:false, preview:true}`
  return the same provenance for the same text. The Phase 4 body lacked it because its text named no asset and had no
  entityIds: nothing is found (`kind none`, no case), and a strip describes a claim, so inventing one would be false.
  `principal` as a string is a 400. Not changed in the service; the body is documented in service/README.md and
  docs/DEMO.md and pinned by `tests/investigate-provenance.test.ts`.
