# Knowledge Twin — judge walkthrough (3 minutes, then optional extras)

Everything below runs on this machine only: a local service, a local SQLite file, a small desktop companion. No cloud, no model API, no real chat, mail or Slack account. Every step here was run on 7 November 2026 on macOS; the text after each click is what appeared.

## What you are looking at (30 seconds)

Elisa's challenge: expert knowledge lives in Teams threads and e-mails, never in the manuals. Knowledge Twin reads those messages as they are (no form, no documentation step), turns each thread into a **case** bound to the equipment, the people and the time it concerns, and, when a similar problem comes in later, answers with the earlier fix **and its caveats**: who said it, whether the outcome was verified, which condition it depends on. If one deciding fact is missing, it asks exactly one person one Yes/No question, within a daily budget, and uses the answer. The same engine is an MCP server, so an autonomous agent gets the same answer under the same access rules and limits. The pixel companion ("Lumi") is how a person meets it: click him, tell him what happened, answer the rare question.

## Start

```bash
pnpm install
```

```bash
pnpm demo:judge
```

That one command resets the demo data, starts the service on `127.0.0.1:47831`, launches the companion, opens the activity page in your browser and starts the **simulated** activity stream, whose day begins four minutes later so the script below runs on untouched data first (`--stream-delay 0` starts it at once, `--no-stream` never). Lumi falls in from the top of the screen, lands bottom-right, says hello and, a few seconds later, rolls off to the right edge: that is where he lives. A sliver of him stays visible at the edge. Move the cursor near that corner and he peeks and hops back in; clicking the sliver works too, and so does ⌘⌥S or the menu-bar icon. He goes back to the edge after about 20 s without interaction, and comes by himself when a question arrives for you. Ctrl-C in that terminal stops everything.

The reset prints what was captured, for example:

```
Teams JSON .../teams_chat.json: 1 cases, 25 claims, 3 entities, 2 people (seen 12, inserted 12)
Email text .../email.txt: 1 cases, 11 claims, 3 entities, 2 people (seen 1, inserted 1)
```

That is the **capture** step: Erkki's Teams thread and his e-mail imported as they are. The e-mail is recognised as a retelling of the thread, so it does not count as a second confirmation. (On a clone without Elisa's example files, the synthetic families and the developer fixture are imported instead; the walkthrough then uses the TRN-117 case of the `optic-forwarding-a` family in the same way.)

## The 3-minute script

**0:00 Open the companion.** Bring the cursor to the bottom-right corner so Lumi hops in, then click him (he does a springy tap). The card opens with "Tell me what happened…". At the bottom there are three icons: paperclip, questions (speech bubbles, with a count when there are open questions), settings (sliders).

**0:10 Be Veikko.** Click the sliders icon → Settings. In the **You** row choose `Veikko Vikkelä · Field Engineer`. Click the back arrow (top right). Say: *"Veikko is the field engineer from the Elisa example. He is at another site today."*

**0:25 Reuse on another old unit.** Paste this and press the arrow (or Cmd/Ctrl+Enter):

```
At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.
```

You see the result card:

- Heading: **Check the traffic counters before replacing the SFP again.**
- Caveat: *Reported once; cause and lasting effect not verified.*
- Next: *If the interface is up and counters stay at zero, disabling and re-enabling the interface reportedly restored traffic in TRN-042 (older unit).*
- Below it the basis case **TRN-042 · no traffic after SFP change** as a timeline: Reported problem (red) → Reported conditions → Possible cause → Suggested checks → Attempted counter check → Attempted interface reset (yellow) → Reported outcome (green).
- A row **People with relevant experience · 4** and a line *Existing evidence and your own observations settle the next step* (no one is asked: Veikko stated the unit age himself).

Say: *"This is Erkki's rule, reused on a unit Erkki has never seen. It is phrased as a check before the corrective action, and it says the outcome was reported once, not verified."*

**0:55 Link: where it comes from.** Click **Suggested checks** in the timeline. It expands to the advice with who gave it and the sentence from the chat it came from (the Elisa thread has times but no date, so stamps read "09:22 (date unknown)"). Click **Reported outcome**: it says who reported recovery, after which attempt, and that timing, cause and lasting effect are unconfirmed. Say: *"Every node is bound to the message it came from, the person who said it and the time, and the outcome stays 'reported' until a later message confirms it held."*

**1:15 People, and a message nothing sends.** Click **People with relevant experience**. First entry: `Erkki Expert · Network Expert — Advised the interface reset in TRN-042`, then Aarne Koskela, Helmi Virtanen and Tapio Lehto from the similar TRN-117 case, each with what they actually did. Click **Prepare message** under Erkki: a draft "Message to Erkki Expert · Draft for you to review · nothing is sent" with the current symptoms, the checks already performed and the open point. Click **Back**, then the back arrow to return to the result, then the pencil icon to write again.

**1:40 The one question.** Paste:

```
TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.
```

Result heading: **Confirm the unit details (older unit) before disabling and re-enabling the interface.** Caveats: *Reported once; cause and lasting effect not verified.* and *Unknown for this unit: older unit.* At the bottom: **Asked a colleague with relevant experience · delivered**. Say: *"The deciding fact is missing and Veikko cannot see it, so one Yes/No question went to Erkki, the network expert. Three questions per person per day, thirty minutes between them, one open at a time."*

**2:05 Be Erkki and answer.** Sliders icon → **You** = `Erkki Expert · Network Expert` → back arrow. The questions icon now shows **1**. Click it: **Questions** lists `TRN-042 · no traffic after SFP change — Is TRN-301 an older unit?`. Click the question: the card shows the question, **Yes / No**, *Not sure · Later · Dismiss*, and **Why this question?** (expand it: the hypothesis from TRN-042 applies only if older unit, and what each answer changes). Click **Yes**. Receipt: **Recorded: Yes** — *You answered yes to "Is TRN-301 an older unit?". The recommendation now starts with a check.* with **Undo**.

**2:35 Back to Veikko: the answer was used.** Sliders icon → **You** = Veikko → back arrow → pencil icon → paste the TRN-301 text again (same text, same investigation). Heading is now **Check the traffic counters before replacing the SFP again.** and the status line reads *The answer was used to update the recommendation*. Say: *"Erkki's one tap changed Veikko's next step. A 'No' would have made it 'Don't reuse the fix from TRN-042'; 'Not sure' records nothing and never asks him the same thing again."*

**2:50 The agent path.** In a second terminal:

```bash
pnpm demo:agent
```

This is a plain MCP client (no model) starting the same MCP server on the same database and calling the tools an agent would: `kt_investigate` prints the qualified recommendation with its caveats, matches, people and open gaps; `kt_find_people` the same people with reasons; `kt_request_clarification` opens the one question (`status: question-open`, `text: "Is TRN-301 an older unit?"`); `kt_clarification_status` shows it `delivered` until a human answers. The agent's investigation is its own (an agent principal), so the question is opened again for Erkki: switch **You** to Erkki in the companion and the badge shows the agent's question too. Say: *"Same engine, same limits, same access rules for an agent as for a person; the agent cannot read restricted evidence or exceed anyone's question budget."* To let a real agent drive it, see "Your own Claude over MCP" below. (Run this before the simulated day starts, or expect the coordinator to pick another NOC person once more people are in the directory.)

### Remember this (30 seconds, no form)

Copy a Teams thread (or an e-mail, or drop a .txt/.eml/.json/.md file on the card or on Lumi) and paste it into the input. The chip *Looks like a conversation · Remember this* appears; click it (or the *Remember this* button next to Send, or Cmd+Shift+Enter). The receipt reads, for the Elisa thread copied as text on an empty store: *Captured: 1 case · 25 claims* / *bound to TRN-042, Veikko Vikkelä, Erkki Expert · 09:14–09:27 (date unknown)*, then Lumi hops. Pasting it again says *Already captured*. On the seeded Elisa store the same paste binds to the existing TRN-042 case (its messages are recorded as copies of the seeded thread). Send still investigates: a problem description is never stored by accident.

## The simulated real-time stream (what the browser tab shows)

`pnpm demo:judge` also starts `pnpm demo:play`: a scripted, sped-up day (1 simulated hour = 10 real seconds, 07:30–17:30, seed 1) against the running service, printed in the terminal and shown at **http://127.0.0.1:47831/demo/activity.html**. Until the day begins the page shows *Simulated day begins in … s*. Everything in it is simulated and labelled so:

- **evidence** rows: Teams threads, e-mails and Slack days from the synthetic incident families arrive and are captured (how many records, cases and claims the rules extractor produced).
- **investigation** rows: simulated engineers ask the service, and the row shows the recommendation they got.
- **question** rows: the real coordinator asked someone, with **why them** ("because they performed the action on TRN-117", "because they can observe this through their role (Network Expert)") and the checks it passed (access, daily limit, cooldown, open questions, duplicates).
- **answer** rows: simulated colleagues answer Yes / No / Not sure, tap Later or Dismiss after a plausible delay, and the row says what the recommendation became.
- Rows marked **for you** concern the person chosen under Settings → You. Every couple of simulated hours the stream tries once to involve you; when the coordinator picks you, Lumi's questions badge shows it and the row says *For you: … open the companion to answer*. The stream never answers for you, and it never exceeds the coordinator's limits (they are enforced by the service, and the service's clock runs in simulated time while the stream runs). Your own actions in the companion also appear in the stream.
- Agent calls over MCP against the same database appear as **agent** rows.

The same rows are appended as JSON lines to `data/local/demo-activity.jsonl` (git-ignored) and served by `GET /demo/activity`. `pnpm demo:play -- --seed 2` replays a different day; `--hour-seconds 5` runs it faster; `--instant` runs it in one go; `--delay 0` skips the quiet period when you run it by hand.

## The Context Layer: what an agent is told at time t (1 minute)

Open **http://127.0.0.1:47831/context.html?entity=TRN-042** in a browser (the service must be running; the case view's **Open the context layer** button opens the same page). One plain SVG chart, four rows: **as observed** (a diamond per message or e-mail), **as experienced** (one bar per claim: open bars fade right with *still believed true*, superseded bars are grey with an arrow to what replaced them), **bindings** and **people**. The Teams thread has clock times but no date, so it sits on its own "same day, date unknown" segment: nothing on the page invents a date. Click any bar to see the sentence it came from.

Drag the **t** line (or click it and use ← → Home End). The card under the chart is what an agent is told at that moment, computed by the service through your access (a preview: nothing is stored, nobody is asked). On the Elisa example files:

| t | The card says |
| --- | --- |
| 09:14 – 09:18 (date unknown) | nothing yet (`none`): only this thread up to here counts, and the fix is not in it yet |
| 09:19 – 09:22 | **check first**: "Check the traffic counters first." |
| 09:25 | **qualified**: bounce the interface, reported once |
| 14 Oct and now | **qualified** with the caveat *Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2*; the bar is hatched: *bounded 14 Oct by Erkki Expert · holds for software.version < 4.2* |

Then **http://127.0.0.1:47831/context.html?entity=RBS-310** (the barrier code): before 20 Aug *No barrier code for RBS-310 is on file*; at 20 Aug **5802**; at 6 Oct **7731** *replaces 5802 from 20 Aug*, and the 5802 bar turns grey with an arrow to 7731. Add `&principalId=<id>` (any id from `GET /directory`) to view as someone else; restricted knowledge never shows on their page. `&text=` changes the question the card asks. Without Elisa's files, use `?entity=TRN-117` (the synthetic thread and Helmi's dated firmware note). Screenshots of both stories: `docs/runs/2026-11-07-overnight/day2/screenshots/context-*.png`.

Every result heading in the companion carries the same **provenance strip** (who said it, where and when, how many independent sources, whether it is still believed true). **Erkki's cost** (asked, answered, seconds spent, reuse by people and by agents, and the store line) is a card at the top of the activity page and a row in Settings → Points & rating, both from `GET /costs`.

## Points, if you want them (30 seconds)

Points are optional and personal: nobody has any until they say so. As Erkki (Settings → **You** = Erkki), open **Settings → Points & rating** and switch on **I take part in points**; the sentence under it says points count contributions and never judge whether an answer was right, and that opting out hides them without deleting anything. Answer a question (the TRN-301 one, or the next one the stream sends you) and the receipt shows **+2** with a small pixel burst and a link **See your points**: your balance large, your rank among the simulated people who take part, your last contributions as neutral lines ("Answered a question (no)"), and the participants list with you marked. A useful *No* earns the same as a *Yes*; *Not sure*, *Later* and *Dismiss* earn nothing and cost nothing. The simulated colleagues take part by default (their awards are **points** rows in the stream, labelled simulated); a person who never opted in has no points and appears nowhere, not even to an agent asking over MCP (`kt_participation`). Switch the toggle off and the view goes quiet; switch it on again and the history is back.

## The Slack path (1 minute, synthetic export)

Slack is captured through the same pipeline as Teams and e-mail, with one addition: a private channel's member list becomes an access grant, so what was said there is visible only to its members. Run, with the service up:

```bash
pnpm demo:slack
```

It imports the **synthetic** export of the `config-rollback-private` family (`data/scenarios/config-rollback-private/sources/slack-export`: private `#change-review` with four members, public `#noc-general`; no workspace is contacted) through the `slack-export` connector, then asks the same question as two people:

- **Elina Mattila · Junior NOC Engineer · groups [noc]** sees one case, `ACC-12 · voice VLAN dropped about ten minutes`, and gets *Confirm the unit details (…) before rolling back the config.*
- **Antti Korhonen · NOC Engineer · groups [noc, change-board, slack-channel:C001CO]** sees `ACC-12` **and** `ACC-30 · now uplink ports down`, with its five private-channel messages listed (Sirkka Lindholm: *"Do not roll back N5 units. The v6 template cannot address their port layout. Apply the v7.1 patch…"*); `ACC-30` is among his matches and not among Elina's.

The membership `slack-channel:C001CO` on Antti came from the export's channel member list; the directory (people.json) stays the authority for organization groups and never loses a membership. The same gate applies to timelines, people reasons, question wording and MCP results (tested: zero private evidence reaches non-members).

**What the live Slack path would do, and what it needs.** The live connector (`src/libs/utils/connectors/slack-live.ts`) maps `conversations.history` payloads with the same code as the export (fixture-tested); it refuses any network call unless it is constructed with `{liveAuthorized: true, token}` (an environment variable alone is not authorization), and its connection card reads *awaiting authorization*. Demonstrating it needs a sandbox workspace that Artem names explicitly, a bot token with `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, and the channels to read; nothing is connected before that (open question U25). No Slack credential on this machine was used for anything in this demo.

### Slack (live, sandbox workspace, read-only)

Artem may run the same path against a **sandbox** workspace he names, read-only. Nothing in the repository holds a token; the only source is an environment variable he sets in the demo terminal, and its value is never printed, logged or committed. With the service up:

```bash
export KT_SLACK_LIVE=1
```

```bash
export KT_SLACK_TOKEN=<bot token of the sandbox app; placeholder, never a value here>
```

```bash
pnpm demo:slack --live --workspace "<exact team name>" --channel "#<channel>"
```

What happens, in order: the command refuses and prints exactly what is missing (and the five setup steps: sandbox workspace, an app with only `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, bot invited to the one channel, the two exports) unless both variables and both flags are present. Then one read-only `auth.test`; if the token's team name is not the `--workspace` you named, it stops and prints both names and nothing else is read (**the confirmation step**). Otherwise it reads that channel's info, its member list and its last 50 messages (`--limit`), plus `users.list` for display names, through an allowlist of read methods only (any other method name throws before any network call), maps them with the same code as the export (private channel = members only), imports them as `slack-live:<team id>` and appends a row to the activity stream (`route: slack-live`). Then the access gate: it names the directory people who hold `slack-channel:<id>`, lists the cases and sources the first member sees from that channel, and shows that an outsider with no groups sees none.

Sentence for the judges: *"Read-only, one sandbox channel, nothing posted; production Slack would run the same connector under the organisation's data policy."* Which workspace and channel, and the token at demo time, are Artem's (open question U28).

### Slack sandbox, live (poller: a typed message becomes a case, a 👍 answers a question)

Rehearse first, with no workspace, no token and no network (an in-memory fake workspace runs the same poller against the running service; every directory person gets a fake Slack user):

```bash
pnpm demo:slack-poll --fake --requester "Veikko Vikkelä"
```

On the Elisa seed (`pnpm service --seed elisa`) this printed, on 7 November: the requester types "Changed the SFP on TRN-301 …" in the fake `#field-ops` → *case: TRN-301 · no traffic after SFP change*; he asks Lumi about TRN-301 → *(qualified) Confirm the unit details (older unit) before disabling and re-enabling the interface*, question *Is TRN-301 an older unit?*; the next poll DMs it to Erkki Expert with one line of why and *React 👍 yes · 👎 no · 🤷 not sure*; Erkki's 👍 (a colleague's 👎 on the same DM is ignored) answers yes through the service; asking again → *(check-first) Check the traffic counters before replacing the SFP again*. Rows go to the activity stream, labelled as a fake workspace.

For the live run Artem creates and names, in a **sandbox** workspace (never production): one channel for the demo; a Slack app with ONLY the bot scopes `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, `chat:write`, `reactions:read` (no `im:write`, no `reactions:write`), installed and its bot invited to that channel; a Slack user for each demo person, whose `U…` id goes into that person's `actorIds` as `person:slack:U…` in a people file (people.json shape). Then, with the service up, in the demo terminal:

```bash
export KT_SLACK_LIVE=1
```

```bash
export KT_SLACK_TOKEN=<bot token of the sandbox app; placeholder, never a value here>
```

```bash
pnpm demo:slack-poll --workspace "<exact team name>" --channel "#<channel>" --people <path to people.json>
```

Without both variables, both flags and `--people`, it refuses, prints what is missing and the setup steps, and never prints the token. Every 5 s (`--poll-ms`; `--once` for one poll) it reads the channel through the read-only allowlist and imports it as `slack-live:<team id>` with the people file (a repeat inserts nothing), DMs each **delivered** question of a mapped person once (`chat.postMessage` to the user id; questions held by quiet hours wait; the DM log is `data/local/slack-poller.json`, so a restart never re-sends), and reads the DM's reactions (`reactions.get`): only the recipient's own 👍/👎/🤷 counts, and it answers through `POST /questions/:id/answer` as `person:slack:<U…>`, so the same recipient check, attribution, points and undo apply. A reaction changed after the answer is ignored (Undo is in the panel). A question delivered again after a demo reset (same question id, new delivery) is DM'd again, so a rehearsal never swallows the real run's DM. An unchanged channel is re-imported at most once a minute. If `auth.test` does not answer the workspace named by `--workspace`, the poll sends no DM, reads no reaction, and the poller stops (exit 2). **Post in the channel as top-level messages, not as replies in a Slack thread:** the poller reads `conversations.history` only, so thread replies are not captured. A pasted thread re-pasted with a narrower group keeps its first, wider scope; the receipt then says "already visible beyond your groups". Unverified until the first live run: whether `reactions.get` on the bot's DM also needs `im:history` (if Slack answers `missing_scope`, add it). Ctrl+C stops after the current poll.

## Your own Claude over MCP (optional, 2 minutes)

Our code never calls a model; the agent is **your** Claude. Add this to a `.mcp.json` in the repository root (Claude Code) or to Claude Desktop's MCP configuration, with the service's database already seeded (`pnpm demo:reset` or `pnpm demo:judge`):

```json
{
  "mcpServers": {
    "knowledge-twin": {
      "command": "node",
      "args": ["src/apps/service/mcp.ts", "--agent-id", "agent:claude-code", "--agent-name", "Claude Code", "--agent-groups", "noc"]
    }
  }
}
```

(`--db <path>` points it at another database; `--org-policy none` disables the organization observability policy. The flags are those of `src/apps/service/mcp.ts`.) Start Claude Code in the repository and ask:

> A field tech reports TRN-301: link up, no traffic after an SFP swap. What do we know and what should he check first? Ask a colleague if you need to.

What you should see, tool by tool (the recorded run is in [docs/runs/2026-11-07-overnight/demo/mcp-transcript.md](runs/2026-11-07-overnight/demo/mcp-transcript.md), the fallback if you have no MCP client):

1. `kt_investigate` → the qualified recommendation *Confirm the unit details (older unit) before disabling and re-enabling the interface.* with the caveats, the matching cases (TRN-042 with what matched and what is unknown), the people with their actual contributions and the open gap *Unknown for this problem: older unit. It decides whether the response from TRN-042 applies.* No human is asked yet (agents default to `allowQuestions: false`).
2. `kt_request_clarification` → `question-open`, *Is TRN-301 an older unit?* The companion's badge shows it for **Erkki Expert** (Settings → You = Erkki). Tap **Yes** there.
3. `kt_clarification_status` → `answered`, value `yes`, answered by Erkki's person id.
4. `kt_get_context` → the recommendation is now *Check the traffic counters before replacing the SFP again.* (check-first), loop *answered*.
5. When the tech reports back, `kt_record_outcome` (result `recovered`, attemptedAction `interface.reset`) → stored as the agent's own attributed outcome report with lasting effect `unknown`; the historical case is not rewritten.

While the stream runs, the agent's calls appear in the activity page as **agent** rows (`Agent Claude Code (agent:claude-code) investigated over MCP: …`, `reported an outcome …`).

## Privacy and no cloud, in one breath

The service listens on loopback only and refuses non-loopback host names. The data is one SQLite file under `data/local/`. Nothing contacts a model provider: a network guard in the code throws if anything tries. Message drafts are text for the user to review; nothing is sent to Teams, e-mail or Slack (the one exception is the opt-in sandbox poller above, which DMs questions in a workspace Artem names, behind KT_SLACK_LIVE=1). Elisa's example files are read from an ignored folder and never copied into the repository. Access is enforced per piece of evidence: a person or agent only ever sees cases, timelines, people reasons and questions built from evidence their groups may see (tested, including over MCP).

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The card says *Couldn't reach the service* | The service is not up. Run `pnpm service` in a terminal (it prints `listening on http://127.0.0.1:47831`), then click **Retry**. `pnpm demo:judge` starts it for you. |
| Something is in a strange state | Sliders icon → **Demo data: Reset demo** (click twice), or `pnpm demo:reset` in a terminal; both re-import everything and keep your settings. |
| A question does not appear | Questions are per person: check Settings → **You** is the person who was asked (the stream and the result card say who). The badge refreshes every 20 s while the card is open; close and reopen the card to refresh now. A person gets at most 3 questions a day with 30 minutes between them: `pnpm demo:reset` clears that too. |
| The question went to someone other than Erkki | More NOC people are in the directory (the simulated day has begun, or a family was imported): the coordinator picks among equally placed observers deterministically. Reset, or do the script before the day begins. |
| The question shows **queued** instead of delivered | Quiet hours (22:00–07:00 Helsinki, org-config) hold questions until 07:00. `pnpm demo:judge` and `pnpm demo:agent` start with them off; a service started by hand (`pnpm service`) has them on: start it with `KT_QUIET_HOURS=off` (or `--quiet-hours off`). To see them on purpose, keep them on and move the demo clock to 03:00 Helsinki: `curl -X POST 127.0.0.1:47831/demo/clock -H 'content-type: application/json' -d '{"now":"2026-11-08T01:00:00Z"}'` (an empty body returns to real time). |
| Lumi is not visible | He sits bottom-right; the tray (menu bar) icon has **Show / Hide Lumi**. |
| Port 47831 is taken | `KT_PORT=47900 pnpm demo:judge` (or `pnpm demo:judge --port 47900`). |
| The activity page is empty | The stream has not written anything yet (`pnpm demo:play` needs the service running), or it is pointed at another log file. |
| Nothing from Elisa's example | The organizer's files are not in this clone's `private/` folder; the synthetic TRN-117 case plays the same role (use the same texts; the basis case will read TRN-117). |
