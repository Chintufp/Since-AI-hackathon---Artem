# Mark's Mac for the shoot

Mark's Lumi runs on his Mac and talks to the one service on Artem's Mac. Nothing runs as a service on Mark's Mac.

## Once (about 5 minutes)

Node 24+ and pnpm 10 (`corepack enable` gives pnpm), then:

```bash
git clone <repo url> lumi && cd lumi
```

```bash
git checkout run/2026-11-07-overnight
```

```bash
pnpm install
```

```bash
pnpm build
```

(The film changes are uncommitted on Artem's Mac today; until they are committed and pushed, copy Artem's working tree instead of cloning, e.g. AirDrop a zip of the folder without `node_modules`, then `pnpm install && pnpm build`.)

## Before recording

1. Artem starts `pnpm film … --lan auto`; it prints `Mark's Lumi: … KT_SERVICE_URL=http://<Artem's IP>:47831 …`.
2. On Mark's Mac, check it reaches the service:

```bash
curl -s http://<Artem's IP>:47831/health
```

It must print `{"ok":true,…}`.

3. Start Mark's Lumi:

```bash
KT_NO_SERVICE=1 KT_SERVICE_URL=http://<Artem's IP>:47831 KT_PERSON=Mark KT_QUESTION_POLL_MS=1000 KT_FILM_ARRIVE=1 pnpm desktop
```

Lumi goes to the edge after 2.5 s and comes in by himself when a question for Mark arrives.

## If it does not connect

- **macOS firewall prompt on Artem's Mac** ("accept incoming connections for node?"): click Allow. If it was denied: System Settings → Network → Firewall → Options → node → Allow.
- **Hackathon Wi-Fi that isolates clients** (curl times out although both are on the same Wi-Fi): put both Macs on a phone hotspot, restart `pnpm film … --lan auto` (the IP changes) and use the new URL.
- **Wrong address**: `--lan auto` picks Artem's first private IPv4; check it with `ipconfig getifaddr en0` on Artem's Mac, or pass `--lan <ip>` explicitly.
- **403 "Only loopback host names are served"**: the URL's host must be exactly the IP the runner printed (not a hostname).
- Last resort: run both Lumis on Artem's Mac (the rehearsal does this: `pnpm film --replay --desktops`), and film Mark's from that screen.
