# Run of show: Slack → Lumi → agent (two Macs)

One service on Artem's Mac (temp database, film limits), the Slack poller (outbound reads only), two real Lumis (Artem's Mac, Mark's Mac), a simulation driver that waits for a key. Nothing is deployed. `q` deletes the temp database.

The conversation is `docs/film-pages/CONVO_ARTEM_MARK.md`: four ```text blocks in order (before recording, the trigger, the fix, solved). The runner reads it.

## Wording the extractor needs (checked with the replay, rules extractor)

| Line now | Change to | Why |
| --- | --- | --- |
| `Artem: Alarms cleared, RX power normal. Counters at zero.` | `Artem: TRN-418: alarms cleared, RX power normal, counters at zero.` | without the asset it became its own case "no traffic" |
| `Mark: btw are we still doing the hackathon pizza thing on friday` | `Mark: are we still on for pizza on friday?` | was kept (as "other") |
| `Artem: yes, I ordered 4 already 🍕` | `Artem: on it, 4 ordered 🍕` | was kept as a condition ("yes …") |
| `Mark: Is it one of the older N5 units? Same thing happened on ACC-30 in July: the v6 template cannot address the N5 port layout.` | `Mark: Is TRN-418 one of the older N5 units? Probably the v6 template cannot address the N5 port layout, same as ACC-30 in July.` | no hypothesis was extracted, and ACC-30 pulled the trigger and the fix into an "ACC-30" case |
| `Artem: TRN-418 stable for 2 h after the v7.1 patch. Closing it.` | `Artem: TRN-418 traffic still stable 2 h after the v7.1 patch. Closing it.` | "stable for 2 h" matched no rule |
| `Mark: someone should write that N5 thing down somewhere` | `Mark: can someone put that on the wiki 😅` | was kept as advice |

With these, the replay keeps and drops as the table in the conversation file says, with two differences that are the engine's own reading: "Don't roll it back to v6 … Apply the v7.1 patch instead." is kept as advice and actions (the rollback warning is a negated action, not a condition), and ACC-30 stays a mention in the hypothesis text (it is not linked to a July case; nothing in the store links it).

## The threshold (calibrated on the real engine)

The value is the number of distinct Slack messages behind TRN-418's live claims; the question needs a reported symptom and a stated cause too, and only cases from live Slack get it. `/pipeline` shows it under CASE as **CERTAINTY 3 / 4 messages**.

- After the 8 pre-recording lines (imported as channel history in one batch): **3 / 4**, below threshold, nothing asked.
- After the trigger "Yes, older N5 unit, installed 2019.": **4 / 4**, the question is asked.

Setting: `pnpm film --confirm-after 4` (the service's `--confirm-after` / `KT_CONFIRM_AFTER`; 0 = off, the default everywhere else).

## Before recording (off camera)

1. Slack app from `docs/film-pages/slack-app-manifest.yml`, invited to a new channel. Artem and Mark type the **before recording** lines there.
2. Each person's Slack member id: profile → ⋮ → Copy member ID.
3. Network: both Macs on the same network that lets them talk (a phone hotspot is safest; see `MARK_MAC_SETUP.md`).
4. Artem's Mac, terminal 1:

```bash
export KT_SLACK_LIVE=1
```

```bash
export KT_SLACK_TOKEN=xoxb-…
```

```bash
pnpm film --workspace "<exact workspace name>" --channel "#<channel>" --artem-slack U… --mark-slack U… --lan auto
```

It imports the channel history at start (the page shows the pre-recording lines), and prints the page URLs, the exact command for each Lumi, Mark's service URL and the finale command.

5. Artem's Mac, terminal 2 (his Lumi):

```bash
KT_NO_SERVICE=1 KT_PERSON=Artem KT_QUESTION_POLL_MS=1000 KT_FILM_ARRIVE=1 pnpm desktop
```

6. Mark's Mac: `MARK_MAC_SETUP.md` (its Lumi points at Artem's Mac, `KT_PERSON=Mark`).
7. Browser on Artem's Mac: `http://127.0.0.1:47831/pipeline` and `/pipeline/questions`. Check: CERTAINTY 3 / 4.

Identities are fixed by `KT_PERSON` per app (off camera; nothing to switch on camera). Lumi goes away to the screen edge 2.5 s after launch.

## On camera

| # | Who does what | What appears | Real or simulated |
|---|---|---|---|
| 1 | (already on screen) the pre-recording lines | `/pipeline`: RAW, USEFUL (oat milk, pizza, "alarms?" struck through), CASE TRN-418 with CERTAINTY 3 / 4, HYPOTHESIS "Probably the v6 template …" | **Real** |
| 2 | Artem sends the **trigger** in Slack | CERTAINTY 4 / 4 "threshold reached: Lumi asked". On Artem's screen Lumi comes in from the edge and opens the card by himself: *"TRN-418: link is up but no traffic since 08:40, alarms cleared, RX power normal, counters at zero, older N5 unit, installed 2019. Probably the v6 template cannot address the N5 port layout, same as ACC-30 in July. Is this a problem?"* with Yes / No / Not sure; *Why this question?* lists the Slack messages. Artem taps **Yes**. | **Real**. Measured in the rehearsal: 3.6 s from the trigger message to the open card (poll 2 s + app poll 1 s + arrival). |
| 3 | Mark sends the **fix** lines; Artem presses **s** | `/pipeline/questions`: colleagues' problems (TRN-420/421/422/425), the engine's questions and recipients, simulated answers ~3 s later, the CHAIN filling in. A question the engine sends to Mark reaches Mark's Lumi the same way. | Colleagues and their answers **simulated** (boxed `simulated` tag, stored as such); questions, recipients, scores, gates, claim updates **real**. |
| 4 | Artem and Mark send the **solved** lines | CHAIN · OUTCOME: "traffic is back …", "traffic still stable 2 h …" | **Real** capture of staged text |
| 5 | Terminal (big font): `pnpm film:agent --db <path printed at start>` | kt_investigate on TRN-423 (TRN-418 as top match, Artem and Mark among the people) → kt_request_clarification: the agent's question to a person (in the rehearsal: Mark, so it lands in Mark's Lumi) | **Real** MCP client on the same database |
| end | **q** | temp DB deleted | |

**Retake:** press **r**. The database is cleared and re-seeded in place (same service, same port, both Lumis stay connected), the channel history is re-read up to the last pre-recording line (everything typed in the take is ignored), and CERTAINTY is back to 3 / 4. Artem sends the trigger again; Lumi arrives again (in film mode he forgets a question once no question is open).

## Film flags (all off by default)

| Where | Flag | Effect |
| --- | --- | --- |
| service | `--film` | no cooldown, 10 open questions per person, 100 a day |
| service | `--quiet-hours off` | no 22–07 hold |
| service | `--confirm-after N` | the confirm question (above) |
| service | `--lan-host <IP>` | also listen on this one private IPv4 (not 0.0.0.0); loopback stays |
| desktop | `KT_PERSON=<name or entity id>` | this app's own person (two apps on one service are two people) |
| desktop | `KT_QUESTION_POLL_MS=1000` | collapsed question poll (default 90 s) |
| desktop | `KT_FILM_ARRIVE=1` | start away; arrive with a new question and open its card by himself |
| desktop | `KT_SERVICE_URL=http://<ip>:47831` + `KT_NO_SERVICE=1` | use a service on another Mac |

## Rehearsal (no Slack)

```bash
pnpm film --replay --auto --desktops
```

Two local Lumis (Artem's, Mark's), the whole run, measured latencies, a capture of Artem's card in the temp folder, the MCP finale at the end. Interactive: `pnpm film --replay --desktops`, then t (trigger), f (fix), s, b (solved), r, q. Pass `--convo <file>` to try other wording.

Measured (8 Nov, this Mac): trigger → question stored 0.5–2.0 s (Slack poll 2 s); trigger → Artem's Lumi open on the card by himself 3.6 s; pre-lines 3 / 4, trigger 4 / 4; reset → 3 / 4 and the retake asks again.

## Honest limits

- The simulated colleagues' answers are scripted per unit (TRN-420, 421, 425 older: yes; 422: no).
- Who gets a follow-up is the engine's choice by load and role: in the rehearsal it chose Erkki, Helmi and Olli for the colleagues, and Mark for the agent's question. It is not forced to Mark.
- For new units the recommendation still cites the seeded TRN-042 case while TRN-418 is the top match; that is the engine's ranking.
- The service on the LAN has no login: anyone on that network can read and write this temp, synthetic database while it runs. Use a hotspot or a trusted network, and `q` afterwards.
