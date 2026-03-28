const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// CORS headers — required so the Chrome extension (chrome-extension:// origin)
// can call this Netlify function without being blocked by the browser.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// Retry up to 2 times on 429 / 503 with short delays (300ms, 800ms)
async function fetchWithRetry(url, options, maxRetries = 2) {
  const RETRYABLE = new Set([429, 503]);
  let lastStatus = 0;
  let lastData   = {};
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res  = await fetch(url, options);
    const data = await res.json();
    if (res.ok) return { status: res.status, data };
    lastStatus = res.status;
    lastData   = data;
    if (!RETRYABLE.has(res.status)) break;
    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 300 : 800));
    }
  }
  return { status: lastStatus, data: lastData };
}

exports.handler = async (event) => {
  // Handle CORS preflight (browser sends OPTIONS before the real POST)
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'API key not configured on the server.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { systemInstruction, contents, generationConfig } = body;

  // ------ Input validation ------
  if (!contents || !Array.isArray(contents) || contents.length === 0) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid request: contents is required.' }) };
  }

  if (contents.length > 60) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Conversation history too long.' }) };
  }

  for (const msg of contents) {
    if (!msg?.role || !Array.isArray(msg?.parts)) {
        return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Malformed message in contents.' }) };
      }
      for (const part of msg.parts) {
        if (typeof part?.text !== 'string' || part.text.length > 10000) {
          return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Message text too long.' }) };
        }
      }
  }
  // ------ End validation ------

  try {
    const { status, data } = await fetchWithRetry(
      `${GEMINI_URL}?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction, contents, generationConfig })
      }
    );

    if (status !== 200) {
      const errMsg = data?.error?.message || 'Gemini API error.';
      return { statusCode: status, headers: CORS_HEADERS, body: JSON.stringify({ error: errMsg }) };
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('Gemini function error:', err.message);
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Internal server error. Please try again.' }) };
  }
};
