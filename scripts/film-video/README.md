# Submission video tooling

How the ~2:00 submission video was made. Media (takes, voice clips, renders) stay out of git in `data/local/film-video/`.

- `render.py`, `render2.py`, `render3.py`: the voice-driven edit. Artem's narration clips are cut between words (`render3.py` PIECES), the screen footage is laid on top (BLOCKS), with swoosh transitions, a webcam bubble, subtitles from word timestamps (local Whisper) and overlay cards (`overlays.py`). Run `python3 render3.py segs` then `python3 render3.py assemble`. Paths point at Artem's machine.
- `part1-pipeline/`: the Part 1 "under the hood" page, computed for real on the film's Slack messages. `compute.py` reads the running service (`/pipeline.json`, `/cases`), embeds the relevant sentences and the case cards with local bge-m3 (Ollama), scores them (0.6 meaning + 0.25 time + 0.15 conversation), forms the hypotheses and asks local qwen3:8b for one problem sentence (`data.json` is that run's output). `page.html` animates it; `cap.cjs` captures it frame by frame with Electron.
- `capture/connections-motion.cjs`: captures the real Lumi panel opening Settings → Admin → Connections (dev mock, with the film machine's name and server URL shown).
- The real-app take itself was recorded with `scripts/film-video.mjs` against the live Slack run (`scripts/film-run.ts`).
