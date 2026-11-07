# E01 Claude-agent experimental arm (recorded replay fixtures)

What this is: a recorded output of a Claude subagent (route `claude-agent-arm`, model label `claude-sonnet-subagent-2026-11-07`), run once on 2026-11-07 for experiment E01 (extraction/linking). Each `<family>.json` is an `ExtractionProposal`-shaped fixture (entities, claims, links, incidents, usefulness) plus `familyId` and `inputs`, saved so it can be scored against the rules extractor.

What this is not: it is not a small-GPT result and not an application route. The product never calls this; it is a labeled experimental arm for comparison only.

## Input rule followed
Read only, per family: `data/scenarios/<family>/sources/**` (teams.json, email-*.txt, slack-export/**) and `data/scenarios/<family>/people.json`. Never opened: truth.json, incoming.json, REVIEW.md, TEST_LOCK.json, benchmarks/authoring/. Split confirmed in `data/scenarios/families.json`: train = bgp-firmware-flaps, fan-temperature, config-rollback-private, cabling-pinch; validation = weak-mains-psu, bgp-linecard-private. Demo and test families were not processed. Type contracts (models.ts, memory.ts, vocabulary.ts, connectors README) were read for shapes only.

## Conventions
- evidenceId forms as instructed: `teams:<seq>`, `email:<Message-ID with angle brackets>`, `slack:<ts>`. These are the task's simplified forms, not the connectors' internal sourceIds (those use `msgid:`, `<channelId>:<ts>`, `<channel>:<convKey>#<seq>`); a scorer must map them.
- assertedByActorId and link personActorId are directory ids from people.json. Person entities carry display name plus provider actor ids as aliases.
- Performer vs advisor kept distinct: advice claims are asserted by the advisor and link contribution `advised` (firsthand false); action claims by the performer with `performed-action` (firsthand true).
- Condition origin is always `reported`; no value was inferred beyond what a message states.
- The email in weak-mains-psu (site access) is labeled useful but is not placed in an incident because it is a non-incident access fact.
- Excerpts are the full message text (emails: body with whitespace collapsed).

## Per-family counts
| family | split | entities | claims | links | incidents | usefulness |
|---|---|---|---|---|---|---|
| bgp-firmware-flaps | train | 12 | 17 | 11 | 2 | 17 |
| fan-temperature | train | 10 | 21 | 8 | 1 | 17 |
| config-rollback-private | train | 13 | 19 | 9 | 2 | 17 |
| cabling-pinch | train | 12 | 18 | 7 | 1 | 15 |
| weak-mains-psu | validation | 14 | 18 | 8 | 1 | 14 |
| bgp-linecard-private | validation | 13 | 17 | 10 | 2 | 18 |
