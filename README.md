# sweeps-screenshot-validator

Railway worker service that validates sweepstakes pages via browser screenshots and Gemini vision AI.

## How It Works

Every 20 minutes this worker:
1. Resets stale queue items via PATCH
2. Claims a batch of items from the screenshot queue
3. For each item: navigates with Playwright, dismisses cookie banners, takes a screenshot
4. Sends the screenshot to Gemini 2.5 Flash for analysis
5. Posts the verdict back to the API

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CRON_SECRET` | Yes | — | Bearer token for API auth |
| `GOOGLE_AI_API_KEY` | Yes | — | Gemini API key |
| `SWEEPS_API_URL` | No | `https://sweepstoday.com` | Base API URL |
| `BATCH_SIZE` | No | `5` | Items per cycle |
| `CYCLE_INTERVAL_MS` | No | `1200000` | Ms between cycles (20 min) |
| `LOG_LEVEL` | No | `info` | debug/info/warn/error |
| `PORT` | No | `3000` | Health check port |

## Local Development

```bash
cp .env.example .env
# Fill in your env vars
npm install
npx playwright install chromium
npm run dev
```

## Deployment

Push to main — Railway auto-deploys from the Dockerfile.
