# Floating AI Chat v2 (tailored)

Upgrades:
- Tailored system prompt for your dashboard.
- Short-term memory (last ~12 turns) stored in localStorage and sent to backend.
- Client knobs for temperature and max tokens.
- Simple rate limit (5 req / 10s per IP).
- Streaming responses via SSE.

## Deploy (Vercel)
- Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`)
- Set the Framework choice to `Other` (in Vercel)
- Build Command: `echo "Nothing to build"`
- Output Directory: `public`

Open your site and click the AI button.
