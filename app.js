// ============================================================
//  Curio - The Curiosity App
//  Powered by Google Gemini
// ============================================================

// ── State ────────────────────────────────────────────────────
let userName        = '';
let userBackground  = '';
let conversationHistory = [];   // [{role:'user'|'model', parts:[{text}]}]
let knowledgeBank   = [];
let gems            = 0;
let ttsEnabled      = false;
let isRecording     = false;
let mediaRecorder   = null;
let audioChunks     = [];
let currentQuizTopic    = '';
let currentQuizQuestion = '';
let awaitingResponse    = false;

// ── System Prompt Builder ────────────────────────────────────
function buildSystemPrompt() {
  return `You are Curio, a learning assistant who talks like a knowledgeable friend â€” casual, sharp, and direct. NOT a tutor, NOT a motivational speaker.

User Profile:
- Name: ${userName}
- Background: ${userBackground}

LANGUAGE RULE (CRITICAL):
Always respond in the same language the user writes in. If they write in Spanish, respond in Spanish. French â€” French. Creole â€” Creole. Always match their language and maintain the same casual personality. If they switch languages mid-conversation, switch with them immediately.

TOPIC RULE (CRITICAL):
You will teach ANYTHING without judgment â€” gaming strategies, Fortnite mechanics, pop culture, slang, memes, history, science, cooking, sports, music, finance, fashion, fitness, coding, math, philosophy, relationships, internet culture, literally anything. Zero gatekeeping. If someone wants to learn how to crank 90s in Fortnite, what baby Gronk means, BBL lingo, how stocks work, anything â€” same energy and same teaching approach every time.

Conversation Flow â€” follow this order every time:

STEP 1 â€” CLARIFY FIRST
If the user mentions a broad topic, do NOT dive in yet.
Acknowledge briefly and ask what specific part they want to learn.
Bad: "That's awesome! There's so much to know!"
Good: "Cool â€” that's pretty broad though, what specific part are you trying to figure out?"

STEP 2 â€” MAKE A SMART GUESS ABOUT THEIR CONTEXT
Once you know the specific topic, use their background to make a smart assumption.
State it casually and confirm.

STEP 3 â€” FIND THE ANCHOR
Ask if they know a closely related concept they probably already understand.

STEP 3b â€” IF THEY SAY NO TO THE ANCHOR
Don't panic or trail off. Pivot to a simpler everyday analogy â€” no jargon.
Teach that simpler thing first in 2â€“3 sentences, then come back to the original topic.
Never leave a thought unfinished. Always complete your sentence and ask a follow-up.

STEP 4 â€” BRIDGE AND TEACH
Use what they know to introduce what they don't. One idea at a time.
After each step: short check-in like "does that make sense?" or "still with me?"

STEP 5 â€” GIVE EXAMPLES WHEN ASKED
Don't dump information immediately. Wait until they ask or are clearly stuck.

Tone Rules (CRITICAL):
- 2â€“3 sentences per reply max, then stop and ask something.
- NEVER open with enthusiasm or compliments. No "That's awesome!", "Great question!" â€” just get to the point.
- Sound like a person texting a friend, not an assistant writing an email.
- Casual language: "yeah", "totally", "alright", "kind of like...", "nah", "fair enough"
- Use ${userName}'s name occasionally, not every message.

Knowledge Bank Signal:
Only after ${userName} has clearly shown they understand the concept (answered correctly, or explicitly said they get it), end your response with this exact tag on its own line:
[LEARNED: <concise topic name>]

Example ending: "Yeah exactly, you got it. [LEARNED: Fortnite Building Mechanics]"

Do NOT emit [LEARNED: ...] until real understanding is shown.`;
}
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal Markdown -> HTML renderer (safe: HTML-escaped first).
 */
function formatMessage(text) {
  // 1. Escape raw HTML so nothing from the API can inject markup
  let out = escapeHtml(text);

  // 2. Fenced code blocks  ```lang\n...\n```
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code>${code.trimEnd()}</code></pre>`;
  });

  // 3. Inline code  `...`
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 4. Bold  **...**
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 5. Newlines -> <br>
  out = out.replace(/\n/g, '<br>');

  return out;
}

function currentTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── DOM helpers ───────────────────────────────────────────────
function addMessage(text, role) {
  const msgs = document.getElementById('messages');

  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (role === 'bot' && ttsEnabled) bubble.classList.add('tts-active');
  bubble.innerHTML = formatMessage(text);

  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = currentTime();

  wrapper.appendChild(bubble);
  wrapper.appendChild(time);
  msgs.appendChild(wrapper);
  msgs.scrollTop = msgs.scrollHeight;
}

function showTyping(visible) {
  const el = document.getElementById('typing-indicator');
  el.classList.toggle('hidden', !visible);
  if (visible) {
    document.getElementById('messages').scrollTop =
      document.getElementById('messages').scrollHeight;
  }
}

// ── Setup ─────────────────────────────────────────────────────
function startApp() {
  const nameVal = document.getElementById('setup-name').value.trim();
  const bgVal   = document.getElementById('setup-background').value.trim();

  if (!nameVal) {
    alert('Please enter your name to continue.');
    return;
  }

  userName       = nameVal;
  userBackground = bgVal || 'a curious learner';

  localStorage.setItem('curio_name',       userName);
  localStorage.setItem('curio_background', userBackground);
  localStorage.setItem('curio_gems',       '0');
  localStorage.setItem('curio_knowledge',  '[]');

  initApp();
}

function initApp() {
  userName       = localStorage.getItem('curio_name')       || '';
  userBackground = localStorage.getItem('curio_background') || 'a curious learner';

  if (!userName) {
    prefillSetup();
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    return;
  }

  gems         = parseInt(localStorage.getItem('curio_gems') || '0', 10);
  knowledgeBank = JSON.parse(localStorage.getItem('curio_knowledge') || '[]');
  conversationHistory = [];

  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  document.getElementById('sidebar-name').textContent     = userName;
  document.getElementById('user-avatar-text').textContent = userName.charAt(0).toUpperCase();
  document.getElementById('gems-count').textContent       = gems;

  renderKnowledgeBank();
}

function prefillSetup() {
  const n = localStorage.getItem('curio_name');
  const b = localStorage.getItem('curio_background');
  if (n) document.getElementById('setup-name').value       = n;
  if (b) document.getElementById('setup-background').value = b;
}

function resetApp() {
  if (!confirm('This will clear your knowledge bank, gems, and settings. Are you sure?')) return;
  localStorage.clear();
  location.reload();
}

function newConversation() {
  speechSynthesis.cancel();
  conversationHistory = [];
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'welcome-message';
  welcome.id        = 'welcome-msg';
  welcome.innerHTML = `
    <div class="welcome-icon">:^)</div>
    <h2>Hi again, ${escapeHtml(userName)}!</h2>
    <p>Ready for a new topic?<br />What would you like to learn?</p>
  `;
  msgs.appendChild(welcome);
}
async function geminiRequest(payload) {
  const inExtension =
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    !!chrome.runtime.id;

  const url = inExtension ? NETLIFY_PROXY : '/api/gemini';

  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });

  if (!response.ok) {
    let errMsg = `API error ${response.status}`;
    try {
      const errData = await response.json();
      // Netlify returns { error: "string" }  -  not { error: { message } }
      errMsg = errData?.error?.message ?? errData?.error ?? errMsg;
    } catch (_) { /* ignore */ }
    throw new Error(errMsg);
  }

  return response.json();
}

// ── Gemini API ────────────────────────────────────────────────
async function callGemini(userText) {
  conversationHistory.push({
    role: 'user',
    parts: [{ text: userText }]
  });

  const payload = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt() }]
    },
    contents: conversationHistory,
    generationConfig: {
      temperature: 0.82,
      maxOutputTokens: 500
    }
  };

  const data  = await geminiRequest(payload);
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  if (!reply) throw new Error('Empty response from Gemini. Please try again.');

  conversationHistory.push({
    role: 'model',
    parts: [{ text: reply }]
  });

  return reply;
}

// ── Send Message ──────────────────────────────────────────────
async function sendMessage() {
  if (awaitingResponse) return;

  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  input.value      = '';
  awaitingResponse = true;

  // Remove welcome banner on first message
  const welcome = document.getElementById('welcome-msg');
  if (welcome) welcome.remove();

  addMessage(text, 'user');
  showTyping(true);

  try {
    const rawReply = await callGemini(text);

    showTyping(false);

    // Strip [LEARNED: ...] tag before displaying
    const learnedMatch = rawReply.match(/\[LEARNED:\s*([^\]]+)\]/i);
    const cleanReply   = rawReply.replace(/\[LEARNED:\s*[^\]]+\]/gi, '').trim();

    addMessage(cleanReply, 'bot');

    if (ttsEnabled) speak(cleanReply);

    if (learnedMatch) {
      const topic = learnedMatch[1].trim();
      handleLearned(topic);
    }
  } catch (err) {
    showTyping(false);
    // Pop the failed user message back out so the user can retry without it poisoning history
    if (conversationHistory.length && conversationHistory[conversationHistory.length - 1].role === 'user') {
      conversationHistory.pop();
    }
    const friendly = err.message.includes('503')
      ? 'Curio is a little overloaded right now  -  give it a second and try again!'
      : err.message.includes('403') || err.message.toLowerCase().includes('api key')
      ? 'API key error (403). The Gemini API key needs to be updated in Netlify. Get a new key at aistudio.google.com and update GEMINI_API_KEY in the Netlify dashboard.'
      : `Something went wrong: ${err.message}`;
    addMessage(friendly, 'bot');
  } finally {
    awaitingResponse = false;
  }
}

// ── Knowledge Bank & Gamification ────────────────────────────
function handleLearned(topic) {
  if (!knowledgeBank.includes(topic)) {
    knowledgeBank.push(topic);
    localStorage.setItem('curio_knowledge', JSON.stringify(knowledgeBank));
    renderKnowledgeBank();
  }
  currentQuizTopic = topic;
  setTimeout(() => showLearnedPopup(topic), 800);
}

function showLearnedPopup(topic) {
  const existing = document.getElementById('learned-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'learned-modal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="mac-close-box"></div>
        <h3>Knowledge Unlocked</h3>
      </div>
      <div class="quiz-content" style="text-align:center;padding:28px 24px 20px">
        <div style="font-size:40px;margin-bottom:10px">:^)</div>
        <div style="font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;color:var(--gray-dark)">You learned:</div>
        <div style="font-size:22px;font-weight:bold;margin-bottom:16px">${escapeHtml(topic)}</div>
        <div style="font-size:14px;color:var(--gray-dark)">Attempt the challenge to earn gems, or keep exploring.</div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" id="learned-newchat-btn">New Chat</button>
        <button class="btn-primary btn-primary-sm" id="learned-challenge-btn">Attempt Challenge (+gems)</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('learned-newchat-btn').addEventListener('click', () => {
    modal.remove();
    newConversation();
  });
  document.getElementById('learned-challenge-btn').addEventListener('click', () => {
    modal.remove();
    openQuiz(topic);
  });
}
function renderKnowledgeBank() {
  const container = document.getElementById('knowledge-bank');
  if (knowledgeBank.length === 0) {
    container.innerHTML = '<div class="empty-state">Nothing learned yet.<br>Start a conversation!</div>';
    return;
  }
  container.innerHTML = knowledgeBank
    .map(item => `<div class="knowledge-item" data-topic="${escapeHtml(item)}" style="cursor:pointer" title="Tap to attempt challenge">
      <span class="k-check">[v]</span>
      <span>${escapeHtml(item)}</span>
      <span style="margin-left:auto;font-size:11px;opacity:0.45">></span>
    </div>`)
    .join('');
  container.querySelectorAll('.knowledge-item').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.dataset.topic;
      if (t) { currentQuizTopic = t; openQuiz(t); }
    });
  });
}
function showToast(msg) {
  const toast    = document.createElement('div');
  toast.className = 'gems-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3100);
}

// ── Quiz ──────────────────────────────────────────────────────
async function openQuiz(topic) {
  currentQuizQuestion = '';

  document.getElementById('quiz-topic-label').textContent = `Test your knowledge of ${topic}`;
  document.getElementById('quiz-question-text').textContent = 'Loading questionâ€¦';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-answer').style.display = '';

  const submitBtn = document.getElementById('quiz-submit-btn');
  const skipBtn   = document.getElementById('quiz-skip-btn');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.disabled    = false;
  submitBtn.classList.remove('hidden');
  skipBtn.textContent   = 'Skip';

  document.getElementById('quiz-modal').classList.remove('hidden');

  try {
    const question = await generateQuizQuestion(topic);
    currentQuizQuestion = question;
    document.getElementById('quiz-question-text').textContent = question;
  } catch (_) {
    currentQuizQuestion = `In your own words, explain what ${topic} is and how it works.`;
    document.getElementById('quiz-question-text').textContent = currentQuizQuestion;
  }
}
async function generateQuizQuestion(topic) {
  const data = await geminiRequest({
    contents: [{
      role: 'user',
      parts: [{ text: `Write one short quiz question (one sentence) to test a student's understanding of "${topic}". The question should require a short paragraph answer showing conceptual understanding. Return ONLY the question text, nothing else.` }]
    }]
  });
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    `Explain ${topic} in your own words.`;
}

async function submitQuiz() {
  const answer    = document.getElementById('quiz-answer').value.trim();
  const submitBtn = document.getElementById('quiz-submit-btn');
  const skipBtn   = document.getElementById('quiz-skip-btn');

  if (!answer) {
    document.getElementById('quiz-answer').style.borderColor = '#ef4444';
    setTimeout(() => { document.getElementById('quiz-answer').style.borderColor = ''; }, 1500);
    return;
  }

  submitBtn.textContent = 'Checkingâ€¦';
  submitBtn.disabled    = true;

  try {
    const data     = await geminiRequest({
      contents: [{
        role: 'user',
        parts: [{ text: `Quiz question: "${currentQuizQuestion}"\nStudent answer: "${answer}"\n\nBriefly evaluate in 2â€“3 encouraging sentences. Tell them if their understanding is correct or where they went slightly wrong. Be supportive. End with exactly one word on a new line: CORRECT or INCORRECT.` }]
      }]
    });
    const feedback = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Determine correctness â€” CORRECT must appear and INCORRECT must not
    const isCorrect = /\bCORRECT\b/.test(feedback) && !/\bINCORRECT\b/.test(feedback);

    if (isCorrect) {
      gems += 200;
      localStorage.setItem('curio_gems', String(gems));
      document.getElementById('gems-count').textContent = gems;
      showToast('+200 <> Gems earned! Great answer!');
    }

    // Show feedback in place of the textarea
    document.getElementById('quiz-answer').style.display = 'none';
    document.getElementById('quiz-question-text').innerHTML =
      `<div style="font-size:26px;text-align:center;margin-bottom:10px">${isCorrect ? '\o/' : '(?)'}</div>` +
      formatMessage(feedback.replace(/\b(CORRECT|INCORRECT)\b\s*$/, '').trim());

    submitBtn.classList.add('hidden');
    skipBtn.textContent = 'Close';
  } catch (_) {
    closeQuiz();
  }
}
function closeQuiz() {
  document.getElementById('quiz-modal').classList.add('hidden');

  // Reset for next use
  const submitBtn = document.getElementById('quiz-submit-btn');
  submitBtn.textContent = 'Submit Answer';
  submitBtn.disabled    = false;
  submitBtn.classList.remove('hidden');

  document.getElementById('quiz-skip-btn').textContent = 'Skip';

  document.getElementById('quiz-answer').style.display      = '';
  document.getElementById('quiz-answer').style.borderColor  = '';
  document.getElementById('quiz-question-text').textContent = '';
  currentQuizQuestion = '';
}
function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById('tts-btn');
  if (btn) btn.classList.toggle('active', ttsEnabled);
  // Tint bot message bubbles when TTS is active so the user can see which voice
  document.querySelectorAll('.message.bot .message-bubble').forEach(el => {
    el.classList.toggle('tts-active', ttsEnabled);
  });
  if (!ttsEnabled) speechSynthesis.cancel();
}

function speak(text) {
  if (!ttsEnabled || !window.speechSynthesis) return;

  // Strip markdown syntax so TTS reads clean prose
  const clean = text
    .replace(/```[\s\S]*?```/g, ', code example, ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[LEARNED:[^\]]+\]/gi, '');

  speechSynthesis.cancel();
  const utter  = new SpeechSynthesisUtterance(clean);
  utter.rate   = 0.95;
  utter.pitch  = 1.05;
  speechSynthesis.speak(utter);
}

//  Voice Input (MediaRecorder  Gemini transcription) 
// Web Speech API (webkitSpeechRecognition) is blocked in Chrome MV3 extensions.
// We record raw audio with MediaRecorder, send it to the Netlify transcribe
// function, and Gemini returns the transcript.

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function toggleMic() {
  // Second tap: stop recording and trigger transcription
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  // Request mic permission
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (permErr) {
    if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
      alert("Microphone access was blocked. Please allow mic access in your browser's site settings and try again.");
    } else {
      alert('Could not access microphone: ' + permErr.message);
    }
    return;
  }

  const chatInput = document.getElementById('chat-input');
  const micBtn    = document.getElementById('mic-btn');

  // Pick the best supported MIME type (ordered by quality/compatibility)
  const mimeType = [
    'audio/webm;codecs=opus',  // Chrome, Opera GX, Edge
    'audio/webm',              // Chrome fallback
    'audio/ogg;codecs=opus',   // Firefox
    'audio/mp4',               // Safari / iOS
    ''                         // browser default
  ].find(t => t === '' || MediaRecorder.isTypeSupported(t));

  audioChunks   = [];
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  // Capture now  mediaRecorder.mimeType may be cleared by the time onstop fires
  const effectiveMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) audioChunks.push(e.data);
  };

  mediaRecorder.onstart = () => {
    isRecording = true;
    if (micBtn) micBtn.classList.add('recording');
    if (chatInput) {
      chatInput.placeholder = '( Recording... tap mic again to send )';
      chatInput.value = '';
    }
    showToast('( Recording... tap mic again to send )');
  };

  mediaRecorder.onstop = async () => {
    isRecording = false;
    stream.getTracks().forEach(t => t.stop());
    if (micBtn) micBtn.classList.remove('recording');

    if (!audioChunks.length) {
      if (chatInput) chatInput.placeholder = 'Ask Curio something...';
      return;
    }

    if (chatInput) chatInput.placeholder = '( Transcribing... )';
    showToast('( Transcribing... )');

    try {
      const blob         = new Blob(audioChunks, { type: effectiveMimeType });
      const safeMimeType = blob.type.split(';')[0]; // strip codec params for Gemini
      const arrayBuffer  = await blob.arrayBuffer();
      const audioData    = arrayBufferToBase64(arrayBuffer);

      const isExtension   = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
      const transcribeURL = isExtension
        ? 'https://hacklantacurio.netlify.app/api/transcribe'
        : '/api/transcribe';

      const res    = await fetch(transcribeURL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ audioData, mimeType: safeMimeType })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Transcription failed');

      const transcript = result.transcript?.trim() || '';
      if (chatInput) chatInput.placeholder = 'Ask Curio something...';
      if (transcript) {
        chatInput.value = transcript;
        sendMessage();
      } else {
        showToast('( No speech detected  -  try again )');
      }
    } catch (err) {
      console.error('Transcription error:', err);
      if (chatInput) chatInput.placeholder = 'Ask Curio something...';
      showToast('( Transcription failed  -  try again )');
    }

    audioChunks   = [];
    mediaRecorder = null;
  };

  // timeslice=250ms ensures ondataavailable fires regularly, not just on stop
  // (needed for Opera GX and some Chromium builds)
  mediaRecorder.start(250);
}
// ── Sidebar Toggle ────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ── Wire up all event listeners (replaces inline handlers for MV3 CSP) ───────
document.addEventListener('DOMContentLoaded', () => {
  // Setup screen
  const setupNameInput = document.getElementById('setup-name');
  if (setupNameInput) {
    setupNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startApp();
    });
  }
  const setupBtn = document.getElementById('setup-btn');
  if (setupBtn) setupBtn.addEventListener('click', startApp);

  // Sidebar actions
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) newChatBtn.addEventListener('click', newConversation);
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetApp);

  // Chat header
  const menuBtn = document.getElementById('menu-btn');
  if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);

  // Extension popup: close sidebar when backdrop or X box is clicked
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', toggleSidebar);
  const sidebarClose = document.getElementById('sidebar-close');
  if (sidebarClose) sidebarClose.addEventListener('click', toggleSidebar);

  const ttsBtn = document.getElementById('tts-btn');
  if (ttsBtn) ttsBtn.addEventListener('click', toggleTTS);

  // Input row
  const micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.addEventListener('click', toggleMic);
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) sendBtn.addEventListener('click', sendMessage);

  // Quiz modal
  const quizSkipBtn = document.getElementById('quiz-skip-btn');
  if (quizSkipBtn) quizSkipBtn.addEventListener('click', closeQuiz);
  const quizSubmitBtn = document.getElementById('quiz-submit-btn');
  if (quizSubmitBtn) quizSubmitBtn.addEventListener('click', submitQuiz);
});

// Expose sendMessage globally so popup.js (IIFE) can call window.sendMessage()
window.sendMessage = sendMessage;

// ── Boot ──────────────────────────────────────────────────────
window.addEventListener('load', () => {
  const savedName = localStorage.getItem('curio_name');
  if (savedName) {
    initApp();
  } else {
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  }
});
