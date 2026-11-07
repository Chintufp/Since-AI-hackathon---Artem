# Decisions · Day 2 B5 (experts disagree)

Branch `day2/b5`, from `run/2026-11-07-overnight` at `67dcb3f` (B1 and B2 merged). Brief: BUILD_BRIEF section 4, B5;
DAY2_PLAN Move 5; Phase 1 map `maps/MAP-B4B5.md` (its spike facts were re-checked on the merged code).

## D-B5-01 · The second expert's thread lives in data/demo/experts-disagree and is seeded by every demo reset

`teams.json` (Aarne Koskela and Helmi Virtanen at TRN-512, 2021 batch, clear the forwarding table), `people.json` (the
two people with the optic-forwarding-a ids and actorIds, so they merge) and a README saying it is generated. Not under
`data/scenarios` (not a family; `families.json` and the organizer-name ban stay untouched). `resetDemo` imports it for
every seed except `empty`, after the follow-ups. `EngineOptions.expertsDisagreeDir` overrides the path; the
experiments' `NO_FOLLOWUPS` points it at a missing directory, so the recorded E08/E10 stores do not change (same reason
as D-INT-08). Reversal: drop the import block in `demo.ts`.

## D-B5-02 · Different keys per expert branch

Answers are per condition key (`<key>#answer`), so the two branches must be decided by different keys: expert A's case
keeps `unit.age` (Elisa's TRN-042, or the synthetic older-units thread in the test), Helmi's case uses the new
`unit.batch`. One shared key with per-case answer scoping would be a core engine change; not needed here. Reversal: scope
answer markers by caseId in `mergeConditions`/`compareConditions`.

## D-B5-03 · unit.batch is parsed for 202x only

Capture (`extraction-config.ts`, `\b(202\d)\s+batch\b`) and query (`problem-parser.ts` rule `unit-batch`) use the same key
and value format (`'2021'`, label `2021 batch`). Restricted to the 2020s because the synthetic TRN-117 thread says "Is this
one from the 2019 batch?": a 2019 value there would put both experts on one key and one answer would flip both (map spike
3). "Which batch is it?" and "Not sure which batch this unit is from." carry no value and parse to nothing. Reversal:
widen the year class once answers are scoped per case (D-B5-02).

## D-B5-04 · The batch is stated flatly in the thread

"It is the 2021 batch." (no "I think", "around"): hedged conditions never create consequential gaps, so a hedged batch would
leave Helmi's case without a question. The rest of the vocabulary follows the brief: `CONDITION_KEYS['unit.batch']`,
`distinguishingKeys += 'unit.batch'`, template `Is {asset} from the {value} batch?`, `EQUIPMENT_FACTS += 'unit.batch'`
(so the Network Expert / NOC people may be asked it), `DEFAULT_PHRASES` action `table.clear` with recovery "restored
traffic" and evidence terms `forwarding`, `table`.

## D-B5-05 · Seeding broke the 4.2 firmware story; two small engine fixes, not a test change

With the thread seeded, `tests/followups-synthetic.test.ts` failed: the problem "TRN-077 older unit on firmware 4.2 ..."
recommended "Confirm the unit details (2021 batch) before clearing the forwarding table" instead of "the fix from TRN-117
was superseded ... ask Helmi Virtanen". Two causes, both fixed at the cause:

1. The engine did not know that an older unit is not from a later batch. `AgeFold.batchKey` (`'unit.batch'` in the
   default settings): a case whose flat batch year is after `olderThroughYear` (2019) CONFLICTS with a problem that says
   "older unit" (stated, or folded from an installation year). Conflict only: the batch is never folded into an age, so a
   problem that says nothing about age (the B5 problem) still sees `unit.batch` as its own missing key and the question
   stays "Is TRN-577 from the 2021 batch?". `retrieval/conditions.ts`, a dozen lines.
2. Then TRN-512 became inapplicable, and its retain-uncertainty plan (rank 2) beat B1's superseded "none" plan (rank 1),
   so the headline became "Don't reuse the fix from TRN-512" and the superseded caveat was lost. A superseded fix names
   who to ask, which says more than "don't reuse" a less similar case: its rank is now 2.5 (above retain-uncertainty,
   below every usable plan). The ruled-out case stays as a caveat ("TRN-512 does not apply: 2021 batch there, older unit
   here."). `recommend.ts`, one number.

Reversal: remove `batchKey` from the default `ageFold` / set the superseded rank back to 1 (then the follow-ups test
needs the B5 thread left out of the reset).

## D-B5-06 · Store health counts a batch toward the unit generation, not as a fifth slot

Adding `unit.batch` to `distinguishingKeys` changed the store metric's denominator (4 -> 5 keys): every case's
distinguishing slot dropped (RTR-117 0.25 -> 0.2) and E10's recorded completeness moved (0.45 -> 0.4467). A batch, like an
installation year, tells the unit's generation, so `store-health.ts` now aliases `unit.batch` under `unit.age` and leaves
a distinguishing key that is an alias of another distinguishing key out of the denominator. E10 reproduces its committed
numbers again; `tests/store-health.test.ts` is unchanged. Reversal: drop the alias and update the store-health test and
E10 results.

## D-B5-07 · E00, E08 and E10 unchanged

`node experiments/run.ts e00` (17/17 checks), `e08` and `e10` after the change differ from the committed results only in
timings and timestamps (not committed). The new key is unseen in the frozen families.

## D-B5-08 · table.clear in the action lexicon

The generic verb fallback already turned "Cleared the forwarding table." into an attempt `table.clear`, but Helmi's advice
"Clear the forwarding table on the node instead." got no action, so the attempt showed "No advice recorded for this step"
and Helmi's person reason read "Advised a response in TRN-512". A `defaultActionLexicon` entry
(`clear|flush ... forwarding table` -> `table.clear`) gives advice and attempt the same action: the attempt is "Advised by
Helmi Virtanen" and her reason is "Advised the forwarding table clear in TRN-512". E00 unchanged (timings only).
Reversal: remove the entry.

## D-B5-09 · Alternatives are computed in investigate() and carried on the state and the ResultView

`investigation/alternatives.ts` `buildAlternatives(related, selected, directory, settings, problemConditions)`: every
related hypothesis except the selected one, with support not contradicted and an adviser: the adviser of the case's
corrective attempt, else of another advised attempt, else the author of an advice claim. An attempt the problem says was
already done (the SFP the requester just replaced) is skipped, as `recommend()` does. `deciding` is the plain label of
the first missing distinguishing condition, else of the first conflicting one (the case's own value, "2021 batch").
`text`: "<expert> advised <gerund> in <case> (<applicability>, depends on <deciding>)". Sorted qualified (the branches a
fact can still decide), applicable, unknown, inapplicable; at most 3. Stored as optional `InvestigationState.alternatives` (contracts/investigation.ts
`AlternativeHypothesis`) and copied to optional `ResultView.alternatives` (contracts/views.ts), filtered to the cases
among the viewer's visible candidates (`sanitizeState`). The MCP `agentResult` spreads the view, so it carries them too.
Why in `investigate()` and not in `views.ts`: the attempt, its adviser and the related set are only available there
(the related set is not persisted). Nothing is written to the store besides the state itself; the recommendation, the
gaps and the single question are unchanged. Reversal: drop the field and the builder.

## D-B5-10 · Seeding side effects on the judge prompts (checked on a fresh elisa reset)

Checked every prompt of `data/demo/judge-prompts.json` with and without the thread: every `targets` entry is still
reached and the TRN-042 / TRN-301 / TRN-508 questions are unchanged ("Is TRN-301 an older unit?" to Erkki). The two
TRN-117 prompts now ask "Is TRN-117 from the 2021 batch?" (to the same people) instead of "Is TRN-117 an older unit?":
TRN-512's hypothesis now scores above TRN-042's for that text, and TRN-117's own "2019 batch" is not parsed (D-B5-03). The
recipients are what the prompts record, so the file is left as it is; the B5 prompt is added. Not caused by B5 and not
fixed here: the TRN-412 prompt (target Erkki) asks nothing ("Existing evidence and your own observations settle the next
step") with or without the thread.

## D-B5-11 · The panel shows up to two alternatives, not the inapplicable ones

Under the recommendation's notes (after Next:), one line per alternative: "Also on record: <text>", at most two. An
inapplicable alternative is left out of the panel because the recommendation already carries it as a caveat ("TRN-512
does not apply: 2021 batch there, older unit here."); it stays in `ResultView.alternatives` for the API and MCP. Not
checked visually in the Electron companion (no DOM test harness for `renderResult`); `mock-api` carries an example
(PKG-118, Priya Nair) so the dev mock shows the line. Reversal: remove the two lines in `panel.ts`.

## D-B5-12 · Judge prompt and DEMO.md

`data/demo/judge-prompts.json` gets the B5 problem with requester Liisa Mäkelä; on a fresh elisa reset the question
"Is TRN-577 from the 2021 batch?" goes to Erkki Expert (checked). `docs/DEMO.md` gets an "Experts disagree" section with
the paste text, and the TRN-088 step lists the extra caveat that the seeded thread adds ("TRN-512 does not apply ...").
The heading, next step and people of the TRN-088 and TRN-301 steps are unchanged (checked with and without the thread).
