# The agent path over MCP: recorded transcript

**Recorded 7 November 2026 with Claude Code, from this repository, as a fallback for judges without an MCP client.** What was recorded: the Knowledge Twin MCP server (`src/apps/service/mcp.ts`) started over stdio on a freshly reset demo database (`pnpm demo:reset`, Elisa example + demo families + developer fixture), driven by the official MCP SDK client in `scripts/mcp-demo.ts` (`pnpm demo:agent`). The tool choice follows the suggested prompt in [docs/DEMO.md](../../../DEMO.md) ("A field tech reports TRN-301: link up, no traffic after an SFP swap. What do we know and what should he check first? Ask a colleague if you need to."); **no model was in the loop** in this recording (our code never calls one; a judge's own Claude would choose the same tools from their descriptions). While the agent waited, the one question was answered with **Yes** by Erkki Expert through the same service call the companion makes when he taps Yes (the badge showed it for Erkki first). Repeated status polls while waiting are collapsed (5 identical `kt_clarification_status` calls omitted). Nothing here was edited otherwise; the ids are the real ones from that run.

```text
MCP server knowledge-twin on data/local/transcript.sqlite: 8 tools (kt_investigate, kt_get_context, kt_request_clarification, kt_clarification_status, kt_cancel_clarification, kt_record_observation, kt_record_outcome, kt_find_people). Agent principal agent:claude-code, groups [noc]. No model is involved in this script.

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

→ kt_find_people({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_find_people
"Veikko Vikkelä · Field Engineer: Performed the interface reset and reported recovery in TRN-042; Ran the traffic counter check in TRN-042; Reported the problem in TRN-042\nErkki Expert · Network Expert: Advised the interface reset in TRN-042\nAarne Koskela · Field Engineer: Performed the interface reset and reported recovery in TRN-117; Reported the problem in TRN-117; Observed the situation in TRN-117\nHelmi Virtanen · Network Expert: Performed the SFP replacement in TRN-117; Advised the interface reset in TRN-117; Reported the problem in TRN-117\nTapio Lehto · NOC Engineer: Reported the outcome of the SFP replacement in TRN-117"

→ kt_request_clarification({"investigationId":"inv_b2df60e5a46f361cb07d","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_request_clarification
{
  "status": "question-open",
  "reason": "Question q_aeb9f42a5553bfa39d3c is delivered.",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "questionId": "q_aeb9f42a5553bfa39d3c",
  "questionStatus": "delivered",
  "text": "Is TRN-301 an older unit?",
  "loop": "question-open"
}

Waiting up to 40 s for a human to answer "Is TRN-301 an older unit?" in the companion (Settings → You = the person asked)…

→ kt_clarification_status({"questionId":"q_aeb9f42a5553bfa39d3c","principal":{"id":"agent:claude-code","displayName":"Claude Code (judge)","groups":["noc"]}})

## kt_clarification_status
{
  "questionId": "q_aeb9f42a5553bfa39d3c",
  "investigationId": "inv_b2df60e5a46f361cb07d",
  "status": "answered",
  "text": "Is TRN-301 an older unit?",
  "answer": {
    "value": "yes",
    "answeredBy": "ent_219a3364c47654f1cbbc",
    "at": "2026-11-07T06:59:50.482Z"
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
  "observedAt": "2026-11-07T06:59:50.730Z",
  "lasting": "unknown",
  "text": "Counters were zero; disabled and re-enabled the interface, traffic came back (reported by the field tech).",
  "createdEvidenceId": "ev_fd347228f753b66db743"
}
```

## What a judge sees in their own Claude

1. `kt_investigate` → a **qualified** recommendation ("Confirm the unit details (older unit) before disabling and re-enabling the interface."), the caveats (reported once, lasting effect not verified; unknown for this unit: older unit), the matching cases with what matched and what is unknown, the people with their actual contributions, the open gaps and the loop status (*deferred: one quick question to someone with firsthand knowledge could settle this*). Routes are listed: rules and local only.
2. `kt_find_people` → the same people, with reasons; the agent is told to ask through the loop rather than contact them.
3. `kt_request_clarification` → `question-open`, question id and text *Is TRN-301 an older unit?*; the question appears in the companion for **Erkki Expert** (Settings → You = Erkki, questions badge 1).
4. `kt_clarification_status` → `delivered` while he has not answered; `answered` with `value: yes` and `answeredBy` afterwards.
5. `kt_get_context` → the recommendation is now **check-first** ("Check the traffic counters before replacing the SFP again."), the gap is resolved, loop *answered*.
6. `kt_record_outcome` → the tech's report stored as its own attributed outcome report (reporter type `agent`, lasting `unknown`); the historical TRN-042 case is not rewritten.
