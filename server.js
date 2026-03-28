require('dotenv').config();

const express   = require('express');
const rateLimit = require('express-rate-limit');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

if (!GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY is not set in the .env file.');
  process.exit(1);
}

// ── Body parsing (64 KB max to block oversized payloads) ─────
app.use(express.json({ limit: '64kb' }));

// ── Block direct access to .env and config files ─────────────
app.use((req, res, next) => {
  const blocked = /(\.(env|git|config|json)$|^\/server\.js$)/i;
  if (blocked.test(req.path)) return res.status(403).send('Forbidden');
  next();
});

// ── Serve static frontend files ───────────────────────────────
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  // Never cache the HTML so updates reach users immediately
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── Rate limiter: 30 requests / IP / minute ───────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down a little.' }
});

// ── Gemini Proxy ──────────────────────────────────────────────
app.post('/api/gemini', limiter, async (req, res) => {
  const { systemInstruction, contents, generationConfig } = req.body;

  // ------ Input validation ------
  if (!contents || !Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: 'Invalid request: contents is required.' });
  }

  if (contents.length > 60) {
    return res.status(400).json({ error: 'Conversation history too long.' });
  }

  for (const msg of contents) {
    if (!msg?.role || !Array.isArray(msg?.parts)) {
      return res.status(400).json({ error: 'Malformed message in contents.' });
    }
    for (const part of msg.parts) {
      if (typeof part?.text !== 'string' || part.text.length > 10000) {
        return res.status(400).json({ error: 'Message text too long.' });
      }
    }
  }
  // ------ End validation ------

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction, contents, generationConfig })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const errMsg = data?.error?.message || 'Gemini API error.';
      return res.status(geminiRes.status).json({ error: errMsg });
    }

    res.json(data);
  } catch (err) {
    console.error('Gemini proxy error:', err.message);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧠 Curio is running → http://localhost:${PORT}\n`);
});
