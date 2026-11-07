# Generated follow-ups (synthetic)

**What.** Two dated follow-up messages and two problems that use them:

- `teams-followup-erkki.json`: Erkki Expert, Teams, 14 Oct 2026 10:05 (+03:00). He writes that the 4.2 firmware fixes the forwarding-state bug behind TRN-042, that units already on 4.2 should not see it, and that if they do it is something else.
- `email-eino-barrier.txt`: Eino Salo, e-mail, Tue 6 Oct 2026 08:40 (+03:00), subject "RBS-310 barrier code": the barrier code at RBS-310 is now 7731 because the landlord changed the lock. It replaces the 5802 code from his 20 Aug e-mail in `data/scenarios/remote-power-access`. Like that e-mail it is org-visible (imported without access groups), deliberately: see DECISIONS-engine.md D-B1-42.
- `../followups-synthetic/teams-followup-helmi.json`: the same firmware note by Helmi Virtanen about the synthetic TRN-117 family. The demo reset imports it only when Elisa's thread is not on this machine (clean clone, or seed `synthetic`), so the before/after-14-Oct story works without the git-ignored files; the caveat then names Helmi.
- `problems.json`: a problem on a unit running firmware 4.2 (Erkki's TRN-042 advice is superseded for it, ask Erkki) and a drive to RBS-310 that needs the barrier code (7731 from Eino on 6 Oct, replacing 5802 from 20 Aug, changes every October).

**By whom.** Written by the day-2 B1 engine build (an agent working for Artem, 7–8 November 2026). Nothing here comes from Elisa: Elisa's example has no dates at all, and these files exist to show validity windows and supersession on dated sources.

**Why.** The build brief (section 4, B1) asks for supersession ("fixed in firmware 4.2", "changed the lock", "every October") and a point-in-time view (`at`). Both need sources with known dates; the generated messages give the demo two stories that change over time: TRN-042's advice before and after 14 Oct, and RBS-310's barrier code before and after 6 Oct.

**How they are used.** `POST /demo/reset` imports this directory (format `scenario-dir`; `problems.json` and this README are not sources) for every seed except `empty`. The names and the organization are as fictional as the rest of `data/scenarios`.
