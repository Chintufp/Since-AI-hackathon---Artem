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

The first two lines are what voters see under the tagline, so they carry the problem and the answer.

```
The fix for the last outage lives in two people's heads and one Slack thread. Nobody writes it down, and nobody finds it again. Lumi catches that knowledge where it is said, checks it with the people who know, and makes it usable for colleagues and for AI agents.

THE PROBLEM
In Elisa's network operations, expert knowledge lives in Teams threads, e-mails and chat, never in the manuals. A conversation mixes three unrelated topics, a guess sits next to a confirmed fix, and advice that was right for one unit generation is wrong for the next. Documentation steps do not get done, so the knowledge is lost, and an AI agent working the next fault at 3 a.m. has nothing true to work from.

WHAT LUMI DOES
1. Capture. Lumi reads the channels people already use (Slack, Teams exports, e-mail, a paste) with no form to fill in. Each message is kept verbatim with its author, time and access scope. Claims are cut from it (symptom, action, outcome, condition) and bound to the equipment, site and people they concern.
2. Link. Each new sentence is scored against open cases on several signals, not one: meaning (embedding similarity), time, conversation (same thread or a reply to someone already in the case) and shared things such as unit, site and firmware. Lumi decides whether it is a new problem or part of an existing one.
3. Check. A machine guess is only a hypothesis. Lumi, a small snowball that lives at the edge of each engineer's screen, asks the person best placed to know one Yes/No question, within a daily budget and never at night. Yes reinforces, No or "not quite" rescopes. Questions are ranked by expected gain in what is known per unit of people's time; a contextual bandit (LinUCB) learns from the measured reward. Nothing is invented: every answer points back to the sentence it came from and who said it, with its caveats ("reported once, outcome not verified").
4. Serve. Colleagues ask Lumi about a new fault and get the earlier fix, its limits, a timeline of the source case and who to talk to. Any AI agent can call Lumi over MCP: it gets the confirmed fix, who said it, which fact is still missing, and can ask a person through Lumi instead of guessing.

HOW WE BUILT IT
TypeScript on Node 24: a local service with SQLite, an HTTP API (42 routes) and an MCP server (12 tools, Model Context Protocol SDK), plus an Electron companion for macOS that hosts Lumi. Retrieval fuses BM25, exact identifiers and trigrams, with optional bge-m3 embeddings. Models sit in three slots (embed, extract, phrase), each with rules by default, a local Ollama model (bge-m3, qwen3) or a hosted API as opt-in. A model only proposes; validated evidence decides what is stored, and every record names the route that made it. A network guard blocks every outside host unless a slot is switched on. Knowledge has validity in time: our Context Layer view shows what an agent would be told about a unit at any moment, including advice superseded by a later firmware fix.

CHALLENGES
- Telling a hypothesis from a fact. Support (how many independent sources) and applicability (does it fit this unit) are kept apart; an e-mail retelling a thread is recognised as a copy, not a second confirmation.
- Asking without annoying. Budgets, quiet hours and "never ask the same person twice" are built into who gets asked.
- Being honest about numbers. We ran experiments on synthetic scenario families with a hash-locked test split. Retrieval works (recall@3 8/8 on the demo set), but deciding whether old advice applies is still the weak part, and the bandit did not yet beat the rules ranking (0 of 3 seeds), so rules stay the default. All figures and their denominators are in docs/SUBMISSION.md.

WHAT IS REAL TODAY
641 automated tests pass. The demo runs fully offline on one Mac with one command (pnpm demo:judge). Elisa's example thread is imported unchanged; the rest of the data is synthetic and labelled as such. Live Slack works read-only behind an explicit switch. No real engineers have answered Lumi yet.

WHAT COMES NEXT
A central service with Lumi clients on every engineer's machine, live Slack and Teams connectors, a pilot with one operations team to measure real answer rates and seconds of expert time, and learned linking trained on the answers people give.
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
