// api/agent.js
// Tailored system prompt + short-term memory + simple rate limit + streaming
// Env: OPENAI_API_KEY, optional OPENAI_MODEL (default gpt-4o)

const RATE_WINDOW_MS = 10_000; // 10s
const RATE_MAX = 5; // max 5 requests / 10s per IP
const hits = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  arr.push(now); hits.set(ip, arr);

  let body;
  try { body = req.body || {}; } catch { body = {}; }
  const { message, history = [], temperature = 0.7, max_tokens = 800 } = body;

  if (!message) return res.status(400).json({ error: 'Missing message' });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  if (!apiKey) return res.status(500).json({ error: 'Server misconfigured: OPENAI_API_KEY not set' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Guardrails / system context — tune to your portal
  const system = [
    "You are an in-page assistant for a data/ERP dashboard.",
    "Be concise, actionable, and cite steps if giving instructions.",
    "When asked about the page, infer from visible sections (tables, cards, filters).",
    "If the user asks for confidential data or to perform risky actions, refuse and offer safer alternatives.",
    "Prefer numbered steps; keep responses < 250 words unless explicitly asked for more.",
    "If math is needed, compute carefully.",
    "When asked about the analysis, use the data from the visible sections (tables, cards, filters).",
    "When asked about the Portfolio Optimisation Strategy, respond based on the following context: ",
    "- Retain High-Value Users: Focus premium services on 23 high-value users generating substantial ROI (Users 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 30, 31, 32, 33, 34)",
    "- Optimise Moderate Users: Transition 11 moderate users to lower-cost alternatives or hybrid models (Users 15, 17, 18, 21, 23, 26, 27, 29, 35)",
    "- Discontinue Low-Value Users: Consider eliminating services for 8 low-engagement users showing no measurable value (Users 16, 19, 20, 24, 25, 28, 36, 37, 38)",
    "- Negotiation Position: Strong foundation for 20-30% cost reduction while maintaining core value delivery, supported by user preference for optimisation and demonstrated alternative availability.",
    "- Service Restructuring: Concentrate on report access and strategic analyst calls while reducing conference allocations, aligning with demonstrated usage patterns and value attribution.",
    "When asked about user data, respond based on the following context: ",
    "- Ace Tan (CISO): 1,749 reports, 47 calls, 14 conferences = 1,810 total activities (Average: 90.5 per month).",
    "- Dom Chan (Gartner for CIO): 559 reports, 31 calls, 1 conference = 591 total activities (Average: 29.6 per month).",
    "- Yong NB (GITL-Advisor): 566 reports, 15 calls, 2 conferences = 583 total activities (Average: 29.2 per month).",
    "- Tee YY (GITL-Advisor): 530 reports, 8 calls, 1 conference = 539 total activities (Average: 27.0 per month).",
    "- YZ Feng (CDAO): 300 reports, 22 calls, 7 conferences = 329 total activities (Average: 16.5 per month).",
    "- AGGREGATE TOTALS: 7,003 total reports, 332 total calls, 48 total conferences, 7,383 total activities with average 194.3 activities per user.",
  ].join(" ");

  // Build messages with recent history
  const msgs = [{ role: 'system', content: system }];
  for (const m of history) {
    if (!m || typeof m.content !== 'string' || (m.role !== 'user' && m.role !== 'assistant')) continue;
    msgs.push({ role: m.role, content: m.content.slice(0, 4000) }); // trim to stay safe
  }
  msgs.push({ role: 'user', content: message });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        stream: true,
        temperature,
        max_tokens,
        messages: msgs
      })
    });

    if (!response.ok || !response.body) {
      const text = await response.text();
      res.write(`data: ${JSON.stringify({ error: text })}\n\n`);
      res.write(`data: [DONE]\n\n`);
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('data:')) {
          const payload = line.replace(/^data:\s*/, '');
          if (payload === '[DONE]') {
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const token = json.choices?.[0]?.delta?.content || '';
//            if (token) res.write(`data: ${JSON.stringify({ delta: token })}\n\n`);
            if (token) {
              // Send raw token for smoother rendering or Format it simple here
              const formattedToken = token.replace(/\n/g, '<br/>'); // simple formatting example
              res.write(`data: ${JSON.stringify({ delta: formattedToken})}\n\n`);
          } catch {}
        }
      }
      buffer = lines[lines.length - 1];
    }
    res.write(`data: [DONE]\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write(`data: [DONE]\n\n`);
    res.end();
  }
}
