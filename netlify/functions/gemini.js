const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured on the server.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { systemInstruction, contents, generationConfig } = body;

  // ------ Input validation ------
  if (!contents || !Array.isArray(contents) || contents.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request: contents is required.' }) };
  }

  if (contents.length > 60) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Conversation history too long.' }) };
  }

  for (const msg of contents) {
    if (!msg?.role || !Array.isArray(msg?.parts)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Malformed message in contents.' }) };
    }
    for (const part of msg.parts) {
      if (typeof part?.text !== 'string' || part.text.length > 10000) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Message text too long.' }) };
      }
    }
  }
  // ------ End validation ------

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction, contents, generationConfig })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      const errMsg = data?.error?.message || 'Gemini API error.';
      return { statusCode: geminiRes.status, body: JSON.stringify({ error: errMsg }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    console.error('Gemini function error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error. Please try again.' }) };
  }
};
