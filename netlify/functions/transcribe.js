const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed.' })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'API key not configured.' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }

  const { audioData, mimeType } = body;

  if (!audioData || typeof audioData !== 'string') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'audioData is required.' })
    };
  }

  // Validate that audioData is valid base64
  if (!/^[A-Za-z0-9+/]+=*$/.test(audioData)) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid audio data encoding.' })
    };
  }

  // ~7.5 MB audio limit (10 MB base64 chars)
  if (audioData.length > 10_000_000) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Audio too large. Keep recordings under ~1 minute.' })
    };
  }

  // Whitelist MIME types — never pass user-supplied value directly to Gemini
  const ALLOWED_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'];
  const safeMimeType  = ALLOWED_TYPES.includes(mimeType) ? mimeType : 'audio/webm';

  const geminiBody = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: safeMimeType, data: audioData } },
        {
          text: 'Transcribe exactly what is spoken in this audio. Return only the spoken words — no commentary, no formatting, no explanations.'
        }
      ]
    }]
  };

  try {
    const res  = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(geminiBody)
    });
    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.error?.message || 'Gemini transcription failed.';
      return {
        statusCode: res.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: errMsg })
      };
    }

    const transcript = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({ transcript })
    };
  } catch (err) {
    console.error('Transcribe function error:', err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error.' })
    };
  }
};
