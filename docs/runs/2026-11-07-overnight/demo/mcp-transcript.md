# The agent path over MCP: recorded transcript (the 03:00 sequence)

**Re-recorded 7 November 2026 (B7) from a real run of `scripts/mcp-demo.ts` (`pnpm demo:agent -- --simulate-tap --outcome`), as a fallback for judges without an MCP client.** What was recorded: a freshly reset demo database (`node scripts/demo-reset.ts --db data/local/transcript.sqlite`: Elisa example, demo families, developer fixture, follow-ups), the Knowledge Twin MCP server (`src/apps/service/mcp.ts`) started over stdio at **03:00 Helsinki** (`--clock 2026-11-08T01:00:00Z`) with **quiet hours on**, driven by the official MCP SDK client. **No model was in the loop** (our code never calls one; a judge's own Claude would choose the same tools from their descriptions). The agent lists the gaps, picks the one that decides applicability, and asks for Erkki by preference; the question is queued until 07:00 because nobody is woken at night. No service was serving this database on port 47831 (one was running there on another database and was left alone), so the script restarted the MCP server at **07:30** (it delivers held questions on its own clock); with the service and the companion on the same database, the script instead moves the service's demo clock to 07:30 and Erkki's badge lights up. Erkki's tap was simulated with `--simulate-tap` (the same engine call the companion makes, in-process on the same database). Nothing was edited; the ids are the real ones from that run.

```text
MCP server knowledge-twin on data/local/transcript.sqlite: 12 tools (kt_investigate, kt_get_context, kt_request_clarification, kt_list_gaps, kt_propose_question, kt_store_health, kt_clarification_status, kt_cancel_clarification, kt_record_observation, kt_record_outcome, kt_find_people, kt_participation). Agent principal agent:claude-code, groups [noc]. No model is involved in this script.
The MCP server's clock starts at 2026-11-08T01:00:00Z (03:00 Helsinki), quiet hours on (22:00-07:00): nobody is woken at night.

→ kt_investigate({"text":"TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_investigate
investigationId: inv_b2df60e5a46f361cb07d
recommendation (qualified, applicability qualified): Confirm the unit details (older unit) before disabling and re-enabling the interface.
next step: Disabling and re-enabling the interface reportedly restored traffic in TRN-042, but it is not known whether that applies here. Check the unit details (older unit) and check the traffic counters.
caveat: Reported once; cause and lasting effect not verified.
caveat: Unknown for this unit: older unit.
matches: TRN-117 · no traffic after SFP change [matching: SFP replaced, Alarms cleared, Interface up; unknown: Traffic counters zero] | TRN-042 · no traffic after SFP change [matching: SFP replaced, Interface up, Alarms cleared, Traffic absent; unknown: Older unit, Optical level normal, Traffic counters zero] | RTR-117 · BGP flapping after firmware update [matching: -; unknown: BGP session flapping, Recent change (update), Software version 4.2.1]
people: Veikko Vikkelä (Performed the interface reset and reported recovery in TRN-042; Ran the traffic counter check in TRN-042; Reported the problem in TRN-042) | Erkki Expert (Advised the interface reset in TRN-042) | Aarne Koskela (Performed the interface reset and reported recovery in TRN-117; Reported the problem in TRN-117; Observed the situation in TRN-117) | Helmi Virtanen (Performed the SFP replacement in TRN-117; Advised the interface reset in TRN-117; Reported the problem in TRN-117) | Tapio Lehto (Reported the outcome of the SFP replacement in TRN-117)
gaps: Unknown for this problem: older unit. It decides whether the response from TRN-042 applies. [open] | Whether recovery after the interface reset in TRN-042 lasted is unknown. [open]
loop: deferred — One quick question to someone with firsthand knowledge could settle this
routes: rules:problem-parser@1, local:hybrid-rrf@1(bm25+exact-id+trigram-hash[local,not-learned]), rules:rules-assessor@1(separate), rules:question-templates@1

→ kt_list_gaps({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_list_gaps
recommendation: qualified — Confirm the unit details (older unit) before disabling and re-enabling the interface.
quiet hours: on now; a question asked now is held until 2026-11-08T05:00:00.000Z (07:00 Helsinki)
gap [decides applicability] Unknown for this problem: older unit. It decides whether the response from TRN-042 applies.
  id: gap|inv_b2df60e5a46f361cb07d|missing|case_bfe94af54ee18df46e01|unit.age
  an answer changes: If older unit holds here, the response from TRN-042 becomes applicable (currently qualified); if it does not, it becomes inapplicable and the recommendation reverts to retaining uncertainty.
  question: "Is TRN-301 an older unit?"
  who could answer: Erkki Expert · Network Expert (not firsthand; can observe this through their role (Network Expert)) askable now
  who could answer: Helmi Virtanen · Network Expert (not firsthand; can observe this through their group (transport)) askable now
  who could answer: Olli Rautio · Routing Specialist (not firsthand; can observe this through their role (Routing Specialist)) askable now
  who could answer: Hanna Mäkelä · Network Technician (not firsthand; can observe this through their role (Network Technician)) askable now
  who could answer: Marja Niemi · NOC Engineer (not firsthand; can observe this through their group (noc)) askable now
  who could answer: Tapio Lehto · NOC Engineer (not firsthand; can observe this through their group (noc)) askable now
  who could answer: Outi Heino · NOC Team Lead (not firsthand; can observe this through their group (noc)) askable now
gap [decides nothing] Whether recovery after the interface reset in TRN-042 lasted is unknown.
  id: gap|inv_b2df60e5a46f361cb07d|lasting|case_bfe94af54ee18df46e01|attempt_9c092c1b0c368cc6a555
  an answer changes: Would show whether the recovery lasted. The current recommendation already labels the outcome as a single reported result, so it would not change today's action.
  not asked: Not consequential: the answer would not change the recommendation, so nobody is interrupted for it.
confidence in "Sometimes after changing the SFP the interface comes up normally, but the forwarding state doesn't recover correctly."
  support: supported (interface.reset reportedly performed and recovery reported (reported, lasting effect unknown)); moved by: no open gap; evidence: 8 refs
  applicability: qualified (distinguishing condition not yet known: Older unit); moved by: missing gap

The agent chooses the gap that decides applicability: Unknown for this problem: older unit. It decides whether the response from TRN-042 applies.

→ kt_find_people({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_find_people
"Veikko Vikkelä · Field Engineer (ent_bfc503c11994c003a9cd): Performed the interface reset and reported recovery in TRN-042; Ran the traffic counter check in TRN-042; Reported the problem in TRN-042\nErkki Expert · Network Expert (ent_219a3364c47654f1cbbc): Advised the interface reset in TRN-042\nAarne Koskela · Field Engineer (ent_f07bace092572f3cc4cc): Performed the interface reset and reported recovery in TRN-117; Reported the problem in TRN-117; Observed the situation in TRN-117\nHelmi Virtanen · Network Expert (ent_7f60cb0970891a3c15af): Performed the SFP replacement in TRN-117; Advised the interface reset in TRN-117; Reported the problem in TRN-117\nTapio Lehto · NOC Engineer (ent_bbeca410476231840212): Reported the outcome of the SFP replacement in TRN-117"

→ kt_request_clarification({"investigationId":"inv_b2df60e5a46f361cb07d","gapId":"gap|inv_b2df60e5a46f361cb07d|missing|case_bfe94af54ee18df46e01|unit.age","preferPersonEntityId":"ent_219a3364c47654f1cbbc","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_request_clarification
{
  "status": "question-open",
  "reason": "Question q_aeb9f42a5553bfa39d3c is queued. It is held by quiet hours until 2026-11-08T05:00:00.000Z (Queued until 07:00: nobody is woken at night).",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "questionId": "q_aeb9f42a5553bfa39d3c",
  "questionStatus": "queued",
  "text": "Is TRN-301 an older unit?",
  "gapId": "gap|inv_b2df60e5a46f361cb07d|missing|case_bfe94af54ee18df46e01|unit.age",
  "personEntityId": "ent_219a3364c47654f1cbbc",
  "deliverAfter": "2026-11-08T05:00:00.000Z",
  "loop": "question-open",
  "loopReason": "Queued until 07:00: nobody is woken at night"
}

Queued by quiet hours: deliverAfter 2026-11-08T05:00:00.000Z (07:00 Helsinki). Loop: Queued until 07:00: nobody is woken at night.

--- the clock moves to 2026-11-08T05:30:00Z (07:30 Helsinki) ---
No service on port 47831 serves data/local/transcript.sqlite: the MCP engine delivers on its own clock, so the MCP server restarts with --clock 2026-11-08T05:30:00Z.

Waiting for Erkki Expert's tap in the companion (Settings → You = Erkki Expert)…

→ kt_clarification_status({"questionId":"q_aeb9f42a5553bfa39d3c","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_clarification_status
{
  "questionId": "q_aeb9f42a5553bfa39d3c",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "status": "delivered",
  "text": "Is TRN-301 an older unit?"
}

[--simulate-tap] Erkki Expert taps "Yes" (the same engine call the companion makes, in-process on the same database).

→ kt_clarification_status (polled 1 more time)

## kt_clarification_status
{
  "questionId": "q_aeb9f42a5553bfa39d3c",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "status": "answered",
  "text": "Is TRN-301 an older unit?",
  "answer": {
    "value": "yes",
    "answeredBy": "ent_219a3364c47654f1cbbc",
    "at": "2026-11-08T05:31:00.000Z"
  }
}

→ kt_get_context({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_get_context (after)
investigationId: inv_b2df60e5a46f361cb07d
recommendation (check-first, applicability supported): Check the traffic counters before replacing the SFP again.
next step: If the interface is up, disabling and re-enabling the interface reportedly restored traffic in TRN-042 (older unit).
caveat: Reported once; cause and lasting effect not verified.
matches: TRN-042 · no traffic after SFP change [matching: SFP replaced, Interface up, Alarms cleared, Traffic absent, Older unit; unknown: Optical level normal, Traffic counters zero] | TRN-117 · no traffic after SFP change [matching: SFP replaced, Alarms cleared, Interface up; unknown: Traffic counters zero] | RTR-117 · BGP flapping after firmware update [matching: -; unknown: BGP session flapping, Recent change (update), Software version 4.2.1]
people: Veikko Vikkelä (Performed the interface reset and reported recovery in TRN-042; Ran the traffic counter check in TRN-042; Reported the problem in TRN-042) | Erkki Expert (Advised the interface reset in TRN-042) | Aarne Koskela (Performed the interface reset and reported recovery in TRN-117; Reported the problem in TRN-117; Observed the situation in TRN-117) | Helmi Virtanen (Performed the SFP replacement in TRN-117; Advised the interface reset in TRN-117; Reported the problem in TRN-117) | Tapio Lehto (Reported the outcome of the SFP replacement in TRN-117)
gaps: Whether recovery after the interface reset in TRN-042 lasted is unknown. [open] | Unknown for this problem: older unit. It decides whether the response from TRN-042 applies. [resolved]
loop: answered — The answer was used to update the recommendation
routes: rules:problem-parser@1, local:hybrid-rrf@1(bm25+exact-id+trigram-hash[local,not-learned]), rules:rules-assessor@1(separate)

→ kt_list_gaps({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_list_gaps (after)
recommendation: check-first — Check the traffic counters before replacing the SFP again.
quiet hours: not now
gap [decides nothing] Whether recovery after the interface reset in TRN-042 lasted is unknown.
  id: gap|inv_b2df60e5a46f361cb07d|lasting|case_bfe94af54ee18df46e01|attempt_9c092c1b0c368cc6a555
  an answer changes: Would show whether the recovery lasted. The current recommendation already labels the outcome as a single reported result, so it would not change today's action.
  not asked: Not consequential: the answer would not change the recommendation, so nobody is interrupted for it.
confidence in "Sometimes after changing the SFP the interface comes up normally, but the forwarding state doesn't recover correctly."
  support: supported (interface.reset reportedly performed and recovery reported (reported, lasting effect unknown)); moved by: no open gap; evidence: 8 refs
  applicability: applicable (no conflicts; matches: SFP replaced; Interface up; Alarms cleared; Traffic absent; Older unit); moved by: no open gap; settled by an answer (ans_7c0323cf165ac3dd0a1d)

→ kt_record_outcome({"investigationId":"inv_b2df60e5a46f361cb07d","result":"recovered","attemptedAction":"interface.reset","text":"Counters were zero; disabled and re-enabled the interface, traffic came back (reported by the field tech).","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_record_outcome
{
  "id": "outrep_9c01044c06e5480c0750",
  "orgId": "org:local",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "reporter": {
    "type": "agent",
    "id": "agent:claude-code",
    "displayName": "Claude Code (judge)"
  },
  "attemptedAction": "interface.reset",
  "result": "recovered",
  "observedAt": "2026-11-08T05:30:02.116Z",
  "lasting": "unknown",
  "text": "Counters were zero; disabled and re-enabled the interface, traffic came back (reported by the field tech).",
  "createdEvidenceId": "ev_fd347228f753b66db743"
}
```

## What a judge sees in their own Claude

1. `kt_investigate` → a **qualified** recommendation ("Confirm the unit details (older unit) before disabling and re-enabling the interface."), the caveats, the matching cases with what matched and what is unknown, the people with their contributions, the open gaps. No human is asked (agents default to `allowQuestions: false`).
2. `kt_list_gaps` → the gap that **decides applicability** (*older unit*, question "Is TRN-301 an older unit?") with everyone who could answer it, whether each can be asked now and why; the *lasting* gap decides nothing and asks nobody. The **confidence block**: support *supported* (one reported recovery, lasting unknown), applicability *qualified* (distinguishing condition not yet known: older unit), each with reasons and evidence references and the gap that would move it. No number anywhere: retrieval similarity is not confidence. Quiet hours are on: a question asked now is held until 07:00.
3. `kt_find_people` → the people with experience and their entity ids; the agent takes Erkki's.
4. `kt_request_clarification` with `gapId` and `preferPersonEntityId` = Erkki → `question-open`, `questionStatus: queued`, `deliverAfter` 07:00, loop line *Queued until 07:00: nobody is woken at night*. Had Erkki not been an eligible recipient, the call would have been **refused** with his gates in plain words and who the engine would ask instead.
5. At 07:30 the question is **delivered**; Erkki taps **Yes**; `kt_clarification_status` → `answered`, `value: yes`, `answeredBy` Erkki.
6. `kt_get_context` → the next step changed: **check-first** ("Check the traffic counters before replacing the SFP again."), the gap resolved, loop *answered*. `kt_list_gaps` → applicability **applicable**, settled by Erkki's answer; no open gap a person needs to answer.
7. `kt_record_outcome` → the tech's report stored as the agent's own attributed outcome report (lasting `unknown`); the historical TRN-042 case is not rewritten.
