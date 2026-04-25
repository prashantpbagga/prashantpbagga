# Live Fact-Checker

A real-time fact-checking sidekick for live streams. Listens to a conversation through your mic, extracts factual claims, verifies them with Claude + web search, and shows verdicts (TRUE / FALSE / MISLEADING / UNVERIFIED) with sources — all in a clean panel that doubles as an OBS browser source.

## How it works

1. The browser captures continuous speech via the Web Speech API and streams a rolling transcript to a small Node backend.
2. The backend asks Claude (Sonnet 4.6) to pull out specific, verifiable claims from the new portion of the transcript.
3. Claude calls the `web_search` tool to verify each claim against authoritative sources.
4. Results stream back as cards in the UI, deduped against earlier checks.

## Setup

```bash
cd live-fact-checker
npm install
cp .env.example .env
# put your Anthropic API key in .env
npm start
```

Then open http://localhost:3000 in **Chrome or Edge** (Web Speech API requires a Chromium browser), grant mic access, and click **Start listening**.

## Use it during a stream

- **Solo / single mic:** keep the page open on a second monitor. Verdicts appear within ~6 seconds of a claim being made.
- **Capturing the whole call (Discord, Zoom, etc.):** route system audio into your mic input using a virtual cable (e.g., [VB-Cable](https://vb-audio.com/Cable/) on Windows, [BlackHole](https://existential.audio/blackhole/) on macOS), then select that virtual device as the browser's microphone.
- **On-stream overlay:** in OBS, add a **Browser Source** pointing to `http://localhost:3000`. The dark theme is designed to sit cleanly on top of gameplay.

## Tuning

Environment variables (see `.env.example`):

| Var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. |
| `PORT` | `3000` | HTTP port. |
| `FACT_CHECK_MODEL` | `claude-sonnet-4-6` | Swap to `claude-haiku-4-5-20251001` for faster/cheaper. |
| `MAX_SEARCHES` | `4` | Web searches per check pass. |

Frontend constants in `public/app.js`:

- `CHECK_INTERVAL_MS` — how often to send a check (default 6s).
- `MIN_NEW_CHARS` — don't send unless this much new text has accumulated.
- `CONTEXT_WINDOW_MS` — how much rolling transcript context to send.

## Notes

- The system prompt is prompt-cached, so repeated checks during a session are cheap.
- Already-checked claims are tracked server-side to avoid repeating the same verdict; click **Clear** to reset.
- Speech recognition runs in the browser and never leaves your machine — only the transcript text goes to the Anthropic API.
