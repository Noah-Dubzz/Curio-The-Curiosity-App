/* ── Web Speech API Setup ─────────────────────────────────── */
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recording = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    const textarea = document.getElementById('queryInput');
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        textarea.value += event.results[i][0].transcript + ' ';
        updateCount();
      }
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed') {
      setStatus('Mic Blocked');
    } else if (event.error === 'no-speech') {
      setStatus('No Speech');
    } else {
      setStatus('Error');
    }
    stopRecording();
  };

  // If the browser stops on its own (silence timeout), restart if still toggled on
  recognition.onend = () => {
    if (recording) {
      recognition.start();
    }
  };

} else {
  // Gracefully disable the button if browser doesn't support Speech API
  document.addEventListener('DOMContentLoaded', () => {
    const recBtn = document.getElementById('recBtn');
    if (recBtn) {
      recBtn.disabled = true;
      recBtn.title = 'Web Speech API not supported in this browser';
    }
    const st = document.getElementById('statusText');
    if (st) st.textContent = 'Unsupported';
  });
}

/* ── DOM References ───────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const recBtn    = document.getElementById('recBtn');
  const submitBtn = document.getElementById('submitBtn');
  const queryInput = document.getElementById('queryInput');

  if (recBtn) recBtn.addEventListener('click', toggleRecording);
  if (submitBtn) submitBtn.addEventListener('click', handleSubmit);
  if (queryInput) queryInput.addEventListener('input', updateCount);
});

/* ── Toggle Recording ─────────────────────────────────────── */
function toggleRecording() {
  if (!recognition) return;
  recording = !recording;

  if (recording) {
    startRecording();
  } else {
    stopRecording();
  }
}

function startRecording() {
  recording = true;
  try {
    recognition.start();
  } catch (e) {
    // Already started — ignore the error
  }
  const btn = document.getElementById('recBtn');
  if (btn) btn.classList.add('on');
  const lbl = document.getElementById('recLabel');
  if (lbl) lbl.textContent = '\u25CF Recording...';
  const pip = document.getElementById('statusPip');
  if (pip) pip.classList.add('on');
  setStatus('Audio Active');
}

function stopRecording() {
  recording = false;
  if (recognition) {
    recognition.stop();
  }
  const btn = document.getElementById('recBtn');
  if (btn) btn.classList.remove('on');
  const lbl = document.getElementById('recLabel');
  if (lbl) lbl.textContent = 'Click to Record';
  const pip = document.getElementById('statusPip');
  if (pip) pip.classList.remove('on');
  setStatus('Ready');
}

/* ── Helpers ──────────────────────────────────────────────── */
function setStatus(text) {
  const st = document.getElementById('statusText');
  if (st) st.textContent = text;
}

function updateCount() {
  const ta = document.getElementById('queryInput');
  if (!ta) return;
  const len = ta.value.length;
  const cc = document.getElementById('charCount');
  if (cc) cc.textContent = len + ' / 500';
}

/* ── Submit Handler ───────────────────────────────────────── */
function handleSubmit() {
  const queryEl = document.getElementById('queryInput');
  if (!queryEl) return;
  const query = queryEl.value.trim();

  if (!query) {
    setStatus('No Input');
    setTimeout(() => setStatus('Ready'), 1500);
    return;
  }

  // Stop recording if active before submitting
  if (recording) {
    stopRecording();
  }

  // Send the query into the main app chat input if present
  const mainInput = document.getElementById('chat-input');
  if (mainInput) {
    mainInput.value = query;
    // Try to call app-level sendMessage if available
    if (typeof window.sendMessage === 'function') {
      window.sendMessage();
    } else {
      // Fallback: dispatch input event so app can detect value change
      mainInput.dispatchEvent(new Event('input', { bubbles: true }));
      // If there's a send button, click it
      const sendBtn = document.querySelector('.send-btn');
      if (sendBtn) sendBtn.click();
    }
  }

  console.log('Submitted query from assistant:', query);

  setStatus('Sent!');
  setTimeout(() => {
    if (queryEl) queryEl.value = '';
    updateCount();
    setStatus('Ready');
    // close assistant UI if present
    if (typeof window.closeAssistant === 'function') window.closeAssistant();
  }, 400);
}

/* ── Open/Close Helpers (global) ───────────────────────────── */
window.openAssistant = function () {
  const root = document.getElementById('macAssistantContainer');
  if (!root) return;
  root.style.display = 'block';
};

window.closeAssistant = function () {
  const root = document.getElementById('macAssistantContainer');
  if (!root) return;
  root.style.display = 'none';
};
