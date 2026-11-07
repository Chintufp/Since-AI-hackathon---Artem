# Slack film conversation (real Slack proof, ~15 s)

A short, **synthetic** conversation for Artem and Mark to type in the sandbox Slack channel while the film records `/pipeline`. Type each line as its own **top-level message** (not a thread reply), a few seconds apart. Copy the text exactly: the asset id `TRN-418` and the phrasing are what the rules extractor reads (symptom, condition, hypothesis, action, outcome); the lunch line and the "ok thanks" are there to be dropped.

**Part A** (the problem; Lumi asks Artem to confirm once 4 messages support it):

```text
Artem: TRN-418 at Kupittaa: link is up but no traffic since 08:40.
Mark: anyone up for lunch at 12?
Mark: Is it one of the older N5 units?
Artem: Yes, older N5 unit, installed 2019.
Mark: Probably the v6 template cannot address the N5 port layout.
Artem: Applied the v7.1 patch on TRN-418.
Mark: ok thanks
```

**Part B** (after the simulated phase; the outcome):

```text
Artem: TRN-418 traffic is back after the v7.1 patch, alarms cleared.
Mark: TRN-418 traffic still stable 2 h after the v7.1 patch.
```

What the page should show as the lines arrive:

- **RAW**: all eight messages, author and time.
- **USEFUL**: six kept; the lunch line, the question and "ok thanks" struck through and faded (the extractor's reason: small talk, no extractable knowledge).
- **CASE**: `TRN-418` with the four stages and how many passages each got (symptom ×1, condition ×3, action ×1, outcome ×1).
- **HYPOTHESIS**: "Probably the v6 template cannot address the N5 port layout." with the supporting passages underneath, and what is still open (the cause is not verified).
- **STORED RECORD** (button): the case, its claims, attempt/outcome, person links, evidence ids, and embeddings cut to six numbers (only when the embed slot is set to local `bge-m3`; otherwise it says none are stored).

Authors appear with their real Slack display names; the text is what matters. Use a fresh asset id (`TRN-419`, `TRN-420` …) for every retake on the same database, or restart the film service with a new temp `--db`, so a retake does not merge into the earlier case.

## Run it

The whole filmed sequence (service on a temp DB, poller, simulation driver, keys) is one command: `pnpm film`. See `docs/film-pages/RUN_OF_SHOW.md`. Pieces on their own: `pnpm demo:slack-poll --read-only …` (poller only) and `pnpm demo:slack-poll --replay docs/SLACK_FILM_CONVO.md` (part A into a fake workspace).

## Second page: one question, stage by stage

http://127.0.0.1:47831/pipeline/questions (same style, static, re-renders when the state changes; `?question=<id>` picks one, default the latest answered, else the latest asked). INPUTS (the problem asked in Lumi, the Slack and other passages behind the hypotheses, earlier Lumi answers) → OPEN CONDITION → QUESTIONS (the asked one filled black) → WHO CAN KNOW (eligibility reasons; the score only for the chosen person, as the selector recorded it) → ANSWER → EVIDENCE (the claim the answer changed, its change and source count) → RESULT (case completeness × correctness before → after, the recommendation now).

To produce a question after the Slack lines (tested with the service started with `--quiet-hours off`, so the question is delivered at night too): ask Lumi about a new unit with the same symptom, e.g. in the panel, as Veikko: *"TRN-420: link is up but no traffic. Not sure which unit generation this is."* On the elisa seed it asks Erkki Expert "Is TRN-420 an older unit?"; answer Yes in his panel (or `POST /questions/<id>/answer`). The recommendation then moves from qualified to check-first.
