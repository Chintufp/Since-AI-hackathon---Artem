# Submission form: text to paste

Drafted 8 Nov 2026 from the pitch script and checked against the code on `run/2026-11-07-overnight`. Character counts are for the text inside each block.

## Project name

```
Lumi
```

(The repository and code still say "Knowledge Twin". The About text says so once, so judges are not confused.)

## Tagline (max 140)

Yours, 69 characters, matches the last line of the film:

```
The knowledge your team already has, finally kept, checked and usable
```

Alternative that says what it does, 121 characters:

```
Lumi catches fixes that live only in chat, checks them with the people who know, and serves them to colleagues and agents
```

## About the project (max 5000)

Follows the film's script, with the technical detail and the features the film had no time for (points, quiet hours, the Context Layer). The first lines are what voters see under the tagline.

```
Lumi is a small snowball that lives at the edge of every engineer's screen. We made it cute on purpose: people answer a friendly avatar asking one quick question far more readily than they fill in a form or a wiki page. Behind it is a system that catches the knowledge your team only ever says out loud, checks it with the people who know, and makes it usable for colleagues and for AI agents.

THE PROBLEM
In every team, the fix for the last outage lives in two people's heads, a Slack thread or an e-mail. Nobody documents it and nobody finds it again. Advice that was right for one unit generation is wrong for the next, a guess sits next to a confirmed fix, and an AI agent working the next fault at 3 a.m. has nothing true to work from.

1. CAPTURE: FROM A NOISY CHANNEL TO ONE PRECISE PROBLEM
Lumi reads where work is discussed: Slack (live, read-only), Teams exports, e-mail and pasted threads, with GitHub and ticketing next. Every message is kept verbatim with its author, its time as given ("date unknown" stays unknown) and its access scope, so private channels stay private. Chatter is dropped; work content is cut into claims (symptom, action, outcome, condition) bound to the equipment, site and people they concern. Each new sentence is scored against open cases on several signals, not one: meaning (embedding similarity, bge-m3 running locally), time, conversation (same thread, or a reply to someone already in the case), shared things (unit, site, firmware) and references ("that unit"). From the scores Lumi forms hypotheses (a new problem, or which existing one) and a local LLM phrases each candidate in one sentence. An e-mail that retells a thread is recognised as a copy, not a second confirmation.

2. CHECK: CONFIDENCE FROM PEOPLE, NOT FROM THE MODEL
A machine guess is only a hypothesis, so Lumi asks. It hops out with a question mark and asks the person best placed to know one Yes/No question: is this really the problem, did the fix work, does it apply to this unit? Yes reinforces; No or Not sure rescopes or reformulates; every answer is kept with who gave it. Candidate questions are ranked by expected gain in certainty per unit of people's time, and a contextual bandit (LinUCB) learns from the measured reward; it becomes the default only once it beats the rules on unseen cases. Daily budgets, quiet hours (questions raised at night wait until 07:00) and never asking the same person twice keep it light. Knowledge also has time: a fix can be superseded by a later firmware note, and our Context Layer view shows exactly what an agent would have been told about a unit at any moment.

3. SERVE: COLLEAGUES AND AGENTS
An engineer types a problem into Lumi and gets the earlier fix with its caveats ("reported once, outcome not verified"), a timeline of the source case where each step opens the sentence it came from, and people with relevant experience, each with what they actually did, plus a message draft Lumi never sends by itself. Any AI agent can call Lumi over MCP (12 tools) to investigate, see which fact is still missing and request a clarification. If the deciding fact is unknown, the agent doesn't guess: its question goes to an engineer through Lumi, queued until morning if it's 3 a.m.

POINTS
Answering earns optional points and a happy reaction from Lumi. Points are opt-in per person; only people who take part are scored or listed. A No earns exactly what a Yes earns (the value is the information, not agreement), corrections and outcome reports earn more, Not sure and Later are never penalised, and points never decide whether something is true. They can be switched off completely.

HOW IT'S BUILT
TypeScript on Node 24: a local service with SQLite, an HTTP API (42 routes) and an MCP server, plus an Electron companion for macOS and Windows. Retrieval fuses BM25, exact identifiers and trigrams with optional bge-m3 embeddings. Models sit in three slots (embed, extract, phrase): rules by default, local Ollama models (bge-m3, qwen3) or a hosted API by choice. A model only proposes; validated evidence decides what is stored, and every record names the route that made it. A network guard blocks every outside host unless a slot is switched on, so by default nothing leaves the company.

HONEST STATUS
641 automated tests pass and the demo runs offline with one command. Elisa's example thread is imported unchanged; the rest of the data is synthetic and labelled. Retrieval works well; deciding whether old advice applies to a new unit is the weakest step, and the bandit has not yet beaten the rules on our synthetic runs. Try the interface at artem.love/sinceai.
```

## Built with (first five show on the vote card)

```
TypeScript, Node.js, Electron, Model Context Protocol, SQLite, Ollama, bge-m3, qwen3, LinUCB, Slack API
```

## Repository

```
https://github.com/Chintufp/Since-AI-hackathon---Artem
```

The repository is public, but `origin` has only `main` at `d4c93db` (the scaffold). The working branch `run/2026-11-07-overnight` is not pushed, so a judge opening the link today sees none of the product. Before the deadline: commit, push the branch, and either merge it into `main` or make it the default branch.

## Demo URL (optional)

```
https://artem.love/sinceai/
```

An interactive UI preview: the real Lumi panel on sample data; actions say the engine runs locally or on the organisation's server. Built by `node scripts/build-web-demo.mjs <out>`; the full demo still runs locally (`pnpm install`, `pnpm demo:judge`).

## Demo video

The YouTube link from the film, unlisted is fine. Under two minutes.

## Files

| Field | What to upload | Status |
| --- | --- | --- |
| Source code | `.zip` of the repository at the deadline, without `node_modules`, `data/local`, `private/` (Elisa's material, must not leave), `movie/` renders | To make: `git archive` gives exactly the committed files |
| Demo video | The MP4 if not using YouTube | From the film agent |
| Pitch deck | PDF of the deck | `docs/slides/index.html` exists (12 slides) but says "Knowledge Twin" and predates the Lumi story; rename and export to PDF |
| Supporting document | Pilot / continuation plan | `docs/submission/Lumi-continuation-plan.pdf` (one page; source `continuation-plan.html`) |

Zip command, once everything is committed:

```bash
git archive --format=zip -o ../lumi-source.zip HEAD
```
