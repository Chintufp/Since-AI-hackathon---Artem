# memory-access-fix-4

Fix: members of a private Slack channel can see that channel's records.

## Changes
- connectors/slack-map.ts, slack-export.ts, types.ts, index.ts: `SlackChannel.members`; private-channel records carry `metadata.membershipGrants` [{actorId, displayName?, group}] for channel members (channels.json `members`; posters when `members` is absent; bots skipped; none when the import overrides `accessGroups`).
- memory/membership.ts (new), memory/index.ts: `applyMembershipGrants` after commit. Resolves each grant to a person (actor id, then name; a named member without an entity gets one), records attribute `member-of:<group>`=true and merges the group into `accessScope.groups` (additive, idempotent, re-merged after later commits).
- apps/service/directory.ts: `applyDirectory` now sets groups = directory groups + derived `member-of:*` groups (directory stays authority for org groups; channel memberships additive). No engine change was needed: `effective()` / `principalFor()` read the person's entity groups, which now include the derived ones, so the cap = directory + derived.
- apps/service/directory.test.ts (new, 6 tests): two posting members both see, outsider does not, with and without people.json, members listed vs poster fallback, non-poster listed member, merge + directory-drop keeps channel group, idempotent re-import/re-apply.
- READMEs: memory (membership + re-import cannot tighten access, reset or revise), connectors, service.

## Before / after (config-rollback-private, in-memory service on 47993, scenario-dir import, change-review sources visible via GET /cases/:id)
- Before (reviewer repro): Sirkka, Jarmo, Antti, Elina all 0 of 5.
- After: Sirkka 5, Jarmo 5, Antti 5, Elina 0 (she is not a member of change-review; she sees 1 case instead of 2). Tuula (member) also gets the group. Groups after: Sirkka core/access/change-board/slack-channel:C001CO; Elina noc only.
- Investigate with p1 text: Sirkka/Jarmo/Antti/Tuula get 2 matches, Elina 1.

## Verification
typecheck clean; pnpm test 239 pass (233 + 6); benchmarks/experiments 77 pass.

## Not done / limitations
- Re-import cannot tighten access of an identical already-imported record, nor add grants to records imported before this change (documented; reset or revise).
- A membership is never revoked by later imports (additive only); removing a member requires reset.
- Non-Slack providers have no membership grants (Teams private chats not covered).
- Engine.ts untouched (not owned); demo.ts untouched (no change needed).
