# Older-units stand-in (generated, synthetic)

**What.** One Teams thread, one dated follow-up and the two people in them:

- `teams-1-thread.json`: Ville Ranta (Field Engineer) changed the SFP on TRN-233; link up, alarms cleared, no traffic. Pekka Laine (Network Expert) asks whether it is one of the older units; Ville says yes. Pekka: on those the forwarding state sometimes does not recover after an SFP change; disable the interface, wait, enable it again. Ville: traffic is back.
- `teams-2-followup-pekka.json`: Pekka Laine, 14 Oct 2026 10:05 (+03:00): the 4.2 firmware fixes the forwarding-state bug behind TRN-233 (the same note Helmi writes about TRN-117 in `../followups-synthetic`).
- `people.json`: the two people (directory entries, so they can be asked and the demo chips find Ville).

The files are numbered so the importer (which reads a directory in name order) commits the thread before the note that bounds it.

**By whom.** Written by the day-2 final build (an agent working for Artem, 8 November 2026). Nothing here comes from Elisa: the wording is the inline stand-in that `tests/experts-disagree.test.ts` already used, the names and node ids are invented, and no organizer name is used.

**Why.** On a clone without the git-ignored `private/` files, the judge's agent path (`pnpm demo:agent`, the 03:00 sequence) found no case with a missing "older unit" condition: TRN-042 exists only in Elisa's files, and the synthetic TRN-117 records no unit condition. The script then stopped with "No open gap needs a person". With this thread the clean clone has a case whose applicability is decided by "Is TRN-301 an older unit?", which Erkki Expert (in every directory through his firmware note in `../followups`) can answer through his role. Decision: `docs/runs/2026-11-07-overnight/day2/DECISIONS-package.md` D-B6-27.

**How it is used.** `POST /demo/reset` (and `pnpm demo:reset`) imports this directory on the default seed only when Elisa's thread was not imported. Seed `synthetic` never imports it, so the experiments (E08–E10) and their hash-locked numbers, which are built on that seed, are unchanged. With Elisa's files present it is never imported.
