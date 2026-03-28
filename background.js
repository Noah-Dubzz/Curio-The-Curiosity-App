// ============================================================
//  Curio Chrome Extension – Background Service Worker
//  Handles: tab launch on icon click + Gemini API proxy
// ============================================================

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// Embedded API key — safe to store here because service workers are
// not accessible from web page contexts and the extension is personal/sideloaded.
const API_KEY = 'AIzaSyDi0twY4d9wxRbKtIjKN9XKETpTHYf1kGo';

// ── Open the full app in a new tab when the toolbar icon is clicked ──
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ── Gemini API proxy ────────────────────────────────────────────────
// app.js sends { type: 'GEMINI_REQUEST', payload: <generateContent body> }
// and expects back { ok: bool, status: int, data: <parsed JSON> }
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'GEMINI_REQUEST') return false;

  (async () => {
    try {
      const res  = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(msg.payload)
      });
      const data = await res.json();

      // Retry once on 429 / 503
      if (!res.ok && (res.status === 429 || res.status === 503)) {
        await new Promise(r => setTimeout(r, 600));
        const retry  = await fetch(`${GEMINI_URL}?key=${API_KEY}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(msg.payload)
        });
        const rData = await retry.json();
        sendResponse({ ok: retry.ok, status: retry.status, data: rData });
        return;
      }

      sendResponse({ ok: res.ok, status: res.status, data });
    } catch (err) {
      sendResponse({ ok: false, status: 500, data: { error: { message: err.message } } });
    }
  })();

  return true; // Keep the message channel open for the async response
});
