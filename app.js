// ============================================================
//  Curio - The Curiosity App
//  Powered by Google Gemini
// ============================================================

// ── State ────────────────────────────────────────────────────
const NETLIFY_PROXY = 'https://hacklantacurio.netlify.app/api/gemini';
let userName        = '';
let userBackground  = '';
let conversationHistory = [];   // [{role:'user'|'model', parts:[{text}]}]
let knowledgeBank   = [];
let curiosityBox    = [];       // user-curated topics for Curio + Memory Game
let gems            = 0;
let ttsEnabled      = false;
let isRecording     = false;
let mediaRecorder   = null;
let audioChunks     = [];
let currentQuizTopic    = '';
let currentQuizQuestion = '';
let awaitingResponse    = false;

// Google / Firebase state
let googleUser  = null;   // Firebase User object when signed in
let cloudSynced = false;

// Memory Game state
let memoryQuestions  = [];   // [{topic, question, choices, correct}]
let memoryRound      = 0;
let memoryScore      = 0;
const MEMORY_ROUNDS  = 10;

// ── System Prompt Builder ────────────────────────────────────
function buildSystemPrompt() {

  return `You are Curio, a learning assistant who talks like a knowledgeable friend - casual, sharp, and direct. NOT a tutor, NOT a motivational speaker.



User Profile:

- Name: ${userName}

- Background: ${userBackground}



LANGUAGE RULE (CRITICAL):

Always respond in the same language the user writes in. If they write in Spanish, respond in Spanish. French - French. Creole - Creole. Always match their language and maintain the same casual personality. If they switch languages mid-conversation, switch with them immediately.



TOPIC RULE (CRITICAL):

You will teach ANYTHING without judgment - gaming strategies, Fortnite mechanics, pop culture, slang, memes, history, science, cooking, sports, music, finance, fashion, fitness, coding, math, philosophy, relationships, internet culture, literally anything. Zero gatekeeping. If someone wants to learn how to crank 90s in Fortnite, what baby Gronk means, BBL lingo, how stocks work, anything - same energy and same teaching approach every time.



Conversation Flow - follow this order every time:



STEP 1 - CLARIFY FIRST

If the user mentions a broad topic, do NOT dive in yet.

Acknowledge briefly and ask what specific part they want to learn.

Bad: "That's awesome! There's so much to know!"

Good: "Cool - that's pretty broad though, what specific part are you trying to figure out?"



STEP 2 - MAKE A SMART GUESS ABOUT THEIR CONTEXT

Once you know the specific topic, use their background to make a smart assumption.

State it casually and confirm.



STEP 3 - FIND THE ANCHOR

Ask if they know a closely related concept they probably already understand.



STEP 3b - IF THEY SAY NO TO THE ANCHOR

Don't panic or trail off. Pivot to a simpler everyday analogy - no jargon.

Teach that simpler thing first in 2-3 sentences, then come back to the original topic.

Never leave a thought unfinished. Always complete your sentence and ask a follow-up.



STEP 4 - BRIDGE AND TEACH

Use what they know to introduce what they don't. One idea at a time.

After each step: short check-in like "does that make sense?" or "still with me?"



STEP 5 - GIVE EXAMPLES WHEN ASKED

Don't dump information immediately. Wait until they ask or are clearly stuck.



Tone Rules (CRITICAL):

- 2-3 sentences per reply max, then stop and ask something.

- NEVER open with enthusiasm or compliments. No "That's awesome!", "Great question!" - just get to the point.

- Sound like a person texting a friend, not an assistant writing an email.

- Casual language: "yeah", "totally", "alright", "kind of like...", "nah", "fair enough"

- Use ${userName}'s name occasionally, not every message.



Knowledge Bank Signal:

Only after ${userName} has clearly shown they understand the concept (answered correctly, or explicitly said they get it), end your response with this exact tag on its own line:

[LEARNED: <concise topic name>]



Example ending: "Yeah exactly, you got it. [LEARNED: Fortnite Building Mechanics]"



Do NOT emit [LEARNED: ...] until real understanding is shown.${knowledgeBank.length > 0 ? `

${userName}'s Knowledge Bank (topics they've already learned - don't re-teach from scratch, build on this):
${knowledgeBank.map(t => `- ${t}`).join('\n')}` : ''}${curiosityBox.length > 0 ? `

Curiosity Box (topics ${userName} is interested in - lean into these where relevant):
${curiosityBox.map(t => `- ${t}`).join('\n')}` : ''}`;

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
  curiosityBox  = JSON.parse(localStorage.getItem('curio_cbox')      || '[]');
  conversationHistory = [];

  document.getElementById('setup-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // On mobile, sidebar starts collapsed (overlay drawer)
  if (window.innerWidth <= 640) {
    document.getElementById('sidebar').classList.add('collapsed');
  }

  document.getElementById('sidebar-name').textContent     = userName;
  document.getElementById('user-avatar-text').textContent = userName.charAt(0).toUpperCase();
  document.getElementById('gems-count').textContent       = gems;

  renderKnowledgeBank();
  renderCuriosityBox();
  updateGoogleStatus();

  // Show chat view by default
  showView('chat');
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

    cloudSave();

    updateMemoryLobbyHint();

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

  document.getElementById('quiz-question-text').textContent = 'Loading question...';

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



  submitBtn.textContent = 'Checking...';

  submitBtn.disabled    = true;



  try {

    const data     = await geminiRequest({

      contents: [{

        role: 'user',

        parts: [{ text: `Quiz question: "${currentQuizQuestion}"\nStudent answer: "${answer}"\n\nBriefly evaluate in 2-3 encouraging sentences. Tell them if their understanding is correct or where they went slightly wrong. Be supportive. End with exactly one word on a new line: CORRECT or INCORRECT.` }]

      }]

    });

    const feedback = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';



    // Determine correctness - CORRECT must appear and INCORRECT must not

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

// ── View Navigation ───────────────────────────────────────────
function showView(viewId) {
  // All view panels
  document.querySelectorAll('.view-panel').forEach(el => el.classList.add('hidden'));
  // Show the target panel (using the chat-area too since chat is a <main class="chat-area view-panel">)
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.remove('hidden');

  // Update nav tab active state
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });

  // Seed memory lobby hint when navigating there
  if (viewId === 'memory') updateMemoryLobbyHint();
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

  // Google sign-in on setup screen
  const setupGoogleBtn = document.getElementById('setup-google-btn');
  if (setupGoogleBtn) setupGoogleBtn.addEventListener('click', handleGoogleSignIn);

  // Sidebar actions
  const newChatBtn = document.getElementById('new-chat-btn');
  if (newChatBtn) newChatBtn.addEventListener('click', newConversation);
  const resetBtn = document.getElementById('reset-btn');
  if (resetBtn) resetBtn.addEventListener('click', resetApp);

  // Chat header menu buttons (one per view)
  ['menu-btn', 'menu-btn-cbox', 'menu-btn-memory'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', toggleSidebar);
  });

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

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  });

  // Google connect button (in sidebar)
  const gcBtn = document.getElementById('google-connect-btn');
  if (gcBtn) gcBtn.addEventListener('click', handleGoogleSignIn);

  // Curiosity Box
  const cboxAddBtn = document.getElementById('cbox-add-btn');
  if (cboxAddBtn) cboxAddBtn.addEventListener('click', addCuriosityItem);
  const cboxInput = document.getElementById('cbox-input');
  if (cboxInput) {
    cboxInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addCuriosityItem();
    });
  }

  // Memory Game
  const memStartBtn = document.getElementById('memory-start-btn');
  if (memStartBtn) memStartBtn.addEventListener('click', startMemoryGame);
  const memPlayAgainBtn = document.getElementById('memory-play-again-btn');
  if (memPlayAgainBtn) memPlayAgainBtn.addEventListener('click', () => {
    document.getElementById('memory-gameover').classList.add('hidden');
    document.getElementById('memory-lobby').classList.remove('hidden');
  });
  const memQuitBtn = document.getElementById('memory-quit-btn');
  if (memQuitBtn) memQuitBtn.addEventListener('click', () => {
    endMemoryGame();
    document.getElementById('memory-game').classList.add('hidden');
    document.getElementById('memory-lobby').classList.remove('hidden');
  });
  const memNextBtn = document.getElementById('memory-next-btn');
  if (memNextBtn) memNextBtn.addEventListener('click', nextMemoryRound);
  const memSkipMg = document.getElementById('memory-skip-minigame');
  if (memSkipMg) memSkipMg.addEventListener('click', resolveMemoryMinigame);

  // Listen for Firebase auth state changes (web only)
  window.addEventListener('curio-auth-changed', (e) => {
    googleUser = e.detail;
    if (googleUser) {
      // Signed in: load cloud data, then init app
      loadCloudData(googleUser.uid);
    }
    updateGoogleStatus();
  });
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

// ═══════════════════════════════════════════════════════════
// ── CURIOSITY BOX ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

function addCuriosityItem() {
  const input = document.getElementById('cbox-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) return;
  if (curiosityBox.includes(val)) {
    input.value = '';
    return;
  }
  curiosityBox.push(val);
  localStorage.setItem('curio_cbox', JSON.stringify(curiosityBox));
  input.value = '';
  renderCuriosityBox();
  cloudSave();
  updateMemoryLobbyHint();
}

function removeCuriosityItem(item) {
  curiosityBox = curiosityBox.filter(i => i !== item);
  localStorage.setItem('curio_cbox', JSON.stringify(curiosityBox));
  renderCuriosityBox();
  cloudSave();
  updateMemoryLobbyHint();
}

function renderCuriosityBox() {
  const grid = document.getElementById('cbox-grid');
  if (!grid) return;

  if (curiosityBox.length === 0) {
    grid.innerHTML = '<div class="empty-state cbox-empty">Your Curiosity Box is empty.<br/>Add something!</div>';
    return;
  }

  grid.innerHTML = curiosityBox.map(item => `
    <div class="cbox-tag">
      <span class="cbox-tag-text">${escapeHtml(item)}</span>
      <button class="cbox-tag-remove" data-item="${escapeHtml(item)}" title="Remove">x</button>
    </div>
  `).join('');

  grid.querySelectorAll('.cbox-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => removeCuriosityItem(btn.dataset.item));
  });
}

// Also make Curio AI aware of Curiosity Box topics in its system prompt
// (injected in buildSystemPrompt already via curiosityBox variable)

// ═══════════════════════════════════════════════════════════
// ── GOOGLE / FIREBASE SYNC ─────────────────────────────────
// ═══════════════════════════════════════════════════════════

async function handleGoogleSignIn() {
  if (!window._curio_signIn) {
    alert('Google Sign-in is not available in the extension. Use the web app at hacklantacurio.netlify.app');
    return;
  }
  try {
    const result = await window._curio_signIn();
    googleUser   = result.user;
    // If this is a new Google user who hasn't gone through setup, pre-fill from their Google profile
    if (!localStorage.getItem('curio_name') && googleUser.displayName) {
      // Auto-setup from Google profile
      userName       = googleUser.displayName.split(' ')[0];
      userBackground = 'a curious learner';
      localStorage.setItem('curio_name',       userName);
      localStorage.setItem('curio_background', userBackground);
    }
    await loadCloudData(googleUser.uid);
    initApp();
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error('Google sign-in error:', err);
      alert('Sign-in failed: ' + err.message);
    }
  }
}

async function loadCloudData(uid) {
  if (!window._curio_loadCloud) return;
  try {
    const data = await window._curio_loadCloud(uid);
    if (!data) return;
    // Merge cloud data into local (cloud wins on conflict)
    if (data.name)           { userName       = data.name;           localStorage.setItem('curio_name', userName); }
    if (data.background)     { userBackground = data.background;     localStorage.setItem('curio_background', userBackground); }
    if (data.gems != null)   { gems           = data.gems;           localStorage.setItem('curio_gems', String(gems)); }
    if (data.knowledge)      { knowledgeBank  = data.knowledge;      localStorage.setItem('curio_knowledge', JSON.stringify(knowledgeBank)); }
    if (data.cbox)           { curiosityBox   = data.cbox;           localStorage.setItem('curio_cbox', JSON.stringify(curiosityBox)); }
    cloudSynced = true;
    updateGoogleStatus();
    // Re-render if app is already visible
    const gemsEl = document.getElementById('gems-count');
    if (gemsEl) {
      gemsEl.textContent = gems;
      renderKnowledgeBank();
      renderCuriosityBox();
    }
  } catch (err) {
    console.error('Cloud load error:', err);
  }
}

function cloudSave() {
  if (!googleUser || !window._curio_saveCloud) return;
  window._curio_saveCloud(googleUser.uid, {
    name:       userName,
    background: userBackground,
    gems,
    knowledge:  knowledgeBank,
    cbox:       curiosityBox
  }).catch(err => console.error('Cloud save error:', err));
}

function updateGoogleStatus() {
  const statusEl = document.getElementById('google-status');
  const btnEl    = document.getElementById('google-connect-btn');
  if (!statusEl || !btnEl) return;

  if (googleUser) {
    const name = googleUser.displayName || googleUser.email || 'Google';
    statusEl.innerHTML = `
      <span class="google-connected-label">[G] ${escapeHtml(name)}</span>
      <button class="google-disconnect-btn" id="google-disconnect-btn">Disconnect</button>
    `;
    const disconnectBtn = document.getElementById('google-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async () => {
        if (!window._curio_signOut) return;
        await window._curio_signOut();
        googleUser  = null;
        cloudSynced = false;
        updateGoogleStatus();
      });
    }
  } else {
    statusEl.innerHTML = '<button class="google-connect-btn" id="google-connect-btn">Connect Google -></button>';
    const gcBtn = document.getElementById('google-connect-btn');
    if (gcBtn) gcBtn.addEventListener('click', handleGoogleSignIn);
  }
}

// Hook cloud saves to existing data-mutating functions
// (called after any local storage write in the original functions)
const _origHandleLearned = typeof handleLearned === 'function' ? handleLearned : null;


// ═══════════════════════════════════════════════════════════
// ── MEMORY GAME ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

let memoryMgResolve     = null; // resolve fn for the current mini-game promise
let memoryMgIntervals   = [];
let memoryMgTimeouts    = [];

function mgAddInterval(fn, t) { const id = setInterval(fn, t);  memoryMgIntervals.push(id); return id; }
function mgAddTimeout(fn, t)  { const id = setTimeout(fn, t);   memoryMgTimeouts.push(id);  return id; }
function mgClearAll() {
  memoryMgIntervals.forEach(clearInterval); memoryMgIntervals = [];
  memoryMgTimeouts.forEach(clearTimeout);   memoryMgTimeouts  = [];
}

function playMemorySound(type) {
  // Simple Web Audio API tones (no external URLs)
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    const map = { success: [660, 0.2], error: [220, 0.15], pop: [440, 0.1], beep: [520, 0.08] };
    const [freq, vol] = map[type] || [440, 0.1];
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(); osc.stop(ctx.currentTime + 0.25);
  } catch (_) {}
}

function updateMemoryLobbyHint() {
  const hint = document.getElementById('memory-pool-hint');
  if (!hint) return;
  const total = knowledgeBank.length + curiosityBox.length;
  if (total === 0) {
    hint.textContent = 'Add topics to your Knowledge Bank or Curiosity Box to generate questions!';
    const startBtn = document.getElementById('memory-start-btn');
    if (startBtn) startBtn.disabled = true;
  } else {
    hint.textContent = `${total} topic${total !== 1 ? 's' : ''} available (${knowledgeBank.length} learned, ${curiosityBox.length} in Curiosity Box)`;
    const startBtn = document.getElementById('memory-start-btn');
    if (startBtn) startBtn.disabled = false;
  }
}

async function startMemoryGame() {
  const pool = [...knowledgeBank, ...curiosityBox];
  if (pool.length === 0) return;

  document.getElementById('memory-lobby').classList.add('hidden');
  document.getElementById('memory-gameover').classList.add('hidden');
  document.getElementById('memory-game').classList.remove('hidden');

  memoryRound = 0;
  memoryScore = 0;
  memoryQuestions = [];
  updateMemoryScoreDisplay();

  // Show loading state
  document.getElementById('memory-question').textContent  = 'Generating questions...';
  document.getElementById('memory-topic-tag').textContent = '...';
  document.getElementById('memory-answers').innerHTML     = '';
  document.getElementById('memory-feedback').classList.add('hidden');
  document.getElementById('memory-round-label').textContent = `Loading...`;

  // Generate question batch from AI
  try {
    const topicsToUse = pool.sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, MEMORY_ROUNDS));
    memoryQuestions   = await generateMemoryQuestions(topicsToUse, MEMORY_ROUNDS);
  } catch (err) {
    // Fallback: make simple recall questions
    memoryQuestions = buildFallbackQuestions([...knowledgeBank, ...curiosityBox], MEMORY_ROUNDS);
  }

  showMemoryRound();
}

async function generateMemoryQuestions(topics, count) {
  const topicList = topics.slice(0, count).map((t, i) => `${i+1}. "${t}"`).join('\n');

  const prompt = `You are creating a multiple-choice quiz for a learning app. Generate exactly ${count} questions, one per topic where possible (reuse topics if needed to fill ${count}).

Topics:
${topicList}

For each question output EXACTLY this JSON format (an array of ${count} objects):
[
  {
    "topic": "topic name",
    "question": "question text?",
    "choices": ["A) option1", "B) option2", "C) option3", "D) option4"],
    "correct": "A"
  }
]

Rules:
- Questions should test understanding, not just recall
- Wrong choices should be plausible but clearly incorrect to someone who knows the topic
- Keep questions concise (one sentence)
- Return ONLY the JSON array, no other text`;

  const data = await geminiRequest({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
  });

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Extract JSON from the response (Gemini sometimes wraps it in markdown)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON in response');
  return JSON.parse(jsonMatch[0]);
}

function buildFallbackQuestions(topics, count) {
  const questions = [];
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    questions.push({
      topic,
      question: `Which of the following best describes "${topic}"?`,
      choices: [
        `A) A concept related to ${topic}`,
        `B) Something unrelated to ${topic}`,
        `C) The opposite of ${topic}`,
        `D) A synonym for a different field`
      ],
      correct: 'A'
    });
  }
  return questions;
}

function showMemoryRound() {
  if (memoryRound >= memoryQuestions.length) {
    endMemoryGame();
    return;
  }

  const q = memoryQuestions[memoryRound];
  document.getElementById('memory-round-label').textContent = `Round ${memoryRound + 1} / ${memoryQuestions.length}`;
  document.getElementById('memory-topic-tag').textContent   = q.topic;
  document.getElementById('memory-question').textContent    = q.question;
  document.getElementById('memory-feedback').classList.add('hidden');

  const answersEl = document.getElementById('memory-answers');
  answersEl.innerHTML = '';

  q.choices.forEach(choice => {
    const btn     = document.createElement('button');
    const letter  = choice.charAt(0); // 'A', 'B', 'C', 'D'
    btn.className = 'memory-answer-btn';
    btn.textContent = choice;
    btn.addEventListener('click', () => handleMemoryAnswer(letter, q.correct, q.topic, btn));
    answersEl.appendChild(btn);
  });
}

async function handleMemoryAnswer(chosen, correct, topic, clickedBtn) {
  // Disable all buttons
  document.querySelectorAll('.memory-answer-btn').forEach(b => {
    b.disabled = true;
    if (b.textContent.charAt(0) === correct) b.classList.add('memory-answer-correct');
  });

  const isCorrect = chosen === correct;

  if (isCorrect) {
    clickedBtn.classList.add('memory-answer-correct');
    gems += 50;
    localStorage.setItem('curio_gems', String(gems));
    const gemsEl = document.getElementById('gems-count');
    if (gemsEl) gemsEl.textContent = gems;
    memoryScore++;
    updateMemoryScoreDisplay();
    playMemorySound('success');
    cloudSave();

    document.getElementById('memory-feedback-text').textContent = '+50 gems! Correct!';
    document.getElementById('memory-feedback').classList.remove('hidden');
  } else {
    clickedBtn.classList.add('memory-answer-wrong');
    playMemorySound('error');
    // Trigger a random mini-game as penalty
    document.getElementById('memory-feedback-text').textContent = 'Wrong! Survive the mini-game to continue...';
    document.getElementById('memory-feedback').classList.remove('hidden');
    document.getElementById('memory-next-btn').classList.add('hidden');

    await runMemoryMinigame();

    document.getElementById('memory-next-btn').classList.remove('hidden');
  }
}

function updateMemoryScoreDisplay() {
  const el = document.getElementById('memory-score-display');
  if (el) el.textContent = `Score: ${memoryScore}/${memoryQuestions.length || MEMORY_ROUNDS}`;
}

function nextMemoryRound() {
  memoryRound++;
  showMemoryRound();
}

function endMemoryGame() {
  mgClearAll();
  document.getElementById('memory-game').classList.add('hidden');
  document.getElementById('memory-gameover').classList.remove('hidden');

  const total = memoryQuestions.length;
  const pct   = total > 0 ? Math.round((memoryScore / total) * 100) : 0;
  const icon  = pct >= 80 ? '\\o/' : pct >= 50 ? ':^)' : ':(';

  document.getElementById('memory-gameover-icon').textContent  = icon;
  document.getElementById('memory-gameover-title').textContent = pct >= 80 ? 'NICE WORK!' : pct >= 50 ? 'NOT BAD!' : 'KEEP PRACTICING!';
  document.getElementById('memory-gameover-result').textContent = `You scored ${memoryScore} out of ${total} (${pct}%)`;
  document.getElementById('memory-gameover-stats').textContent  = `+${memoryScore * 50} <> gems earned this round`;
}

// ── Memory Mini-Games (20 games, Mac-themed, no emoji) ────────

function runMemoryMinigame() {
  return new Promise(resolve => {
    memoryMgResolve = resolve;
    mgClearAll();

    const overlay = document.getElementById('memory-minigame-overlay');
    const arena   = document.getElementById('memory-mg-arena');
    arena.innerHTML = '';
    overlay.classList.remove('hidden');

    const games = [
      mgGameClickTarget, mgGameSimon, mgGameHacker, mgGameAimLab,
      mgGameStopwatch, mgGameHold, mgGameDefuse, mgGameRhythm,
      mgGameClickArena, mgGameMemoryMatch, mgGameFreeze, mgGameDodge,
      mgGameOsu, mgGameMaze, mgGameFindImposter
    ];
    const game = games[Math.floor(Math.random() * games.length)];
    game();
  });
}

function resolveMemoryMinigame() {
  mgClearAll();
  window.onkeydown = null; // clear any keyboard listener from rhythm game
  const arena = document.getElementById('memory-mg-arena');
  if (arena) {
    arena.innerHTML = '<div class="mg-cleared">CLEARED</div>';
  }
  mgAddTimeout(() => {
    const overlay = document.getElementById('memory-minigame-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (memoryMgResolve) { memoryMgResolve(); memoryMgResolve = null; }
  }, 700);
}

function setMgInfo(title, desc) {
  const t = document.getElementById('memory-mg-title');
  const d = document.getElementById('memory-mg-desc');
  if (t) t.textContent = title;
  if (d) d.textContent = desc;
  // Wire skip button
  const skip = document.getElementById('memory-skip-minigame');
  if (skip) {
    skip.onclick = resolveMemoryMinigame;
  }
}

function getMgArena() {
  return document.getElementById('memory-mg-arena');
}

// 1. Click the target
function mgGameClickTarget() {
  setMgInfo('HIT THE TARGET', 'Click the target 5 times before it moves!');
  const arena = getMgArena();
  let clicks  = 0;
  const target = document.createElement('div');
  target.className = 'mg-target';
  target.textContent = '[ x ]';
  const moveTarget = () => {
    target.style.top  = (10 + Math.random() * 65) + '%';
    target.style.left = (10 + Math.random() * 65) + '%';
  };
  moveTarget();
  target.addEventListener('mousedown', () => {
    playMemorySound('pop');
    clicks++;
    moveTarget();
    if (clicks >= 5) resolveMemoryMinigame();
  });
  arena.appendChild(target);
  // Auto-move every 1.2s
  mgAddInterval(moveTarget, 1200);
}

// 2. Simon Says
function mgGameSimon() {
  setMgInfo('SIMON SAYS', 'Repeat the pattern exactly!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-simon-grid">
      <div id="mg-s0" class="mg-simon-btn mg-simon-red"></div>
      <div id="mg-s1" class="mg-simon-btn mg-simon-blue"></div>
      <div id="mg-s2" class="mg-simon-btn mg-simon-yellow"></div>
      <div id="mg-s3" class="mg-simon-btn mg-simon-green"></div>
    </div>`;
  const sequence = [Math.floor(Math.random()*4), Math.floor(Math.random()*4), Math.floor(Math.random()*4)];
  let playerStep = 0;

  const flash = async () => {
    for (const i of sequence) {
      await new Promise(r => mgAddTimeout(r, 300));
      const el = document.getElementById(`mg-s${i}`);
      if (!el) return;
      el.style.filter = 'brightness(3)';
      playMemorySound('beep');
      await new Promise(r => mgAddTimeout(r, 300));
      if (el) el.style.filter = '';
    }
  };
  mgAddTimeout(flash, 400);

  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`mg-s${i}`);
    if (!btn) continue;
    btn.addEventListener('mousedown', function() {
      this.style.filter = 'brightness(3)';
      mgAddTimeout(() => { this.style.filter = ''; }, 150);
      if (i === sequence[playerStep]) {
        playerStep++;
        if (playerStep === sequence.length) mgAddTimeout(resolveMemoryMinigame, 300);
      } else {
        playMemorySound('error');
        playerStep = 0;
        mgAddTimeout(flash, 500);
      }
    });
  }
}

// 3. Type the code
function mgGameHacker() {
  setMgInfo('OVERRIDE CODE', 'Type the exact code shown!');
  const arena = getMgArena();
  const codes  = ['CURIO', 'LEARN', 'SIGMA', 'SKIBIDI', 'RIZZ'];
  const target = codes[Math.floor(Math.random() * codes.length)];
  arena.innerHTML = `
    <div class="mg-hacker">
      <div class="mg-hacker-code">${target}</div>
      <input type="text" id="mg-hack-input" class="mg-hacker-input" autocomplete="off" placeholder="TYPE HERE" />
      <div class="mg-hacker-bar-wrap"><div id="mg-hack-bar" class="mg-hacker-bar"></div></div>
    </div>`;
  const input   = document.getElementById('mg-hack-input');
  const bar     = document.getElementById('mg-hack-bar');
  let timeLeft  = 100;
  mgAddTimeout(() => { if (input) input.focus(); }, 80);
  input.addEventListener('input', () => {
    playMemorySound('beep');
    if (input.value.toUpperCase() === target) {
      input.disabled = true;
      resolveMemoryMinigame();
    }
  });
  mgAddInterval(() => {
    timeLeft -= 2.5;
    if (bar) bar.style.width = Math.max(0, timeLeft) + '%';
    if (timeLeft <= 0) {
      playMemorySound('error');
      mgGameHacker();
    }
  }, 100);
}

// 4. Aim Lab
function mgGameAimLab() {
  setMgInfo('AIM LAB', 'Shoot all 5 targets!');
  const arena = getMgArena();
  let count   = 5;
  for (let i = 0; i < 5; i++) {
    const t   = document.createElement('div');
    t.className = 'mg-target mg-target-small';
    t.textContent = '(X)';
    t.style.top  = (10 + Math.random() * 65) + '%';
    t.style.left = (10 + Math.random() * 65) + '%';
    t.style.transition = 'all 0.6s ease-in-out';
    mgAddInterval(() => {
      t.style.top  = (10 + Math.random() * 65) + '%';
      t.style.left = (10 + Math.random() * 65) + '%';
    }, 700 + Math.random() * 500);
    t.addEventListener('mousedown', function() {
      playMemorySound('pop'); this.remove();
      if (--count <= 0) resolveMemoryMinigame();
    });
    arena.appendChild(t);
  }
}

// 5. Stopwatch
function mgGameStopwatch() {
  setMgInfo('STOPWATCH', 'Stop the clock between 2.0s and 2.5s!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-stopwatch">
      <div id="mg-sw-time" class="mg-sw-time">0.0</div>
      <button id="mg-sw-btn" class="mg-btn">STOP</button>
    </div>`;
  let t = 0;
  mgAddInterval(() => { t += 0.1; const el = document.getElementById('mg-sw-time'); if (el) el.textContent = t.toFixed(1); }, 100);
  document.getElementById('mg-sw-btn').addEventListener('mousedown', () => {
    if (t >= 2.0 && t <= 2.5) resolveMemoryMinigame();
    else { playMemorySound('error'); mgGameStopwatch(); }
  });
}

// 6. Hold
function mgGameHold() {
  setMgInfo('HOLD STEADY', 'Hold the button for 3 seconds!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-hold-wrap">
      <button id="mg-hold-btn" class="mg-btn mg-hold-btn">HOLD</button>
      <div class="mg-hold-bar-wrap"><div id="mg-hold-bar" class="mg-hold-bar"></div></div>
    </div>`;
  let t = 0; let interval;
  const btn = document.getElementById('mg-hold-btn');
  const bar = document.getElementById('mg-hold-bar');
  btn.addEventListener('mousedown', () => {
    interval = mgAddInterval(() => {
      t += 100; if (bar) bar.style.width = (t / 3000 * 100) + '%';
      if (t >= 3000) { clearInterval(interval); resolveMemoryMinigame(); }
    }, 100);
  });
  btn.addEventListener('mouseup',    () => { clearInterval(interval); t = 0; if (bar) bar.style.width = '0'; });
  btn.addEventListener('mouseleave', () => { clearInterval(interval); t = 0; if (bar) bar.style.width = '0'; });
}

// 7. Defuse (wire cutting order)
function mgGameDefuse() {
  setMgInfo('DEFUSE', 'Cut wires in order: BLUE, GREEN, RED!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-defuse">
      <div id="mg-w-red"   class="mg-wire mg-wire-red">RED</div>
      <div id="mg-w-green" class="mg-wire mg-wire-green">GREEN</div>
      <div id="mg-w-blue"  class="mg-wire mg-wire-blue">BLUE</div>
    </div>`;
  const sequence = ['mg-w-blue', 'mg-w-green', 'mg-w-red'];
  let step = 0;
  ['mg-w-red', 'mg-w-green', 'mg-w-blue'].forEach(id => {
    document.getElementById(id).addEventListener('mousedown', function() {
      if (id === sequence[step]) {
        playMemorySound('pop');
        this.style.opacity = '0.2';
        this.style.pointerEvents = 'none';
        step++;
        if (step === 3) mgAddTimeout(resolveMemoryMinigame, 300);
      } else {
        playMemorySound('error');
        mgAddTimeout(mgGameDefuse, 500);
      }
    });
  });
}

// 8. Rhythm (spacebar timing)
function mgGameRhythm() {
  setMgInfo('VIBE CHECK', 'Press SPACE when the cursor is in the [OK] zone!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-rhythm-track">
      <div class="mg-rhythm-zone mg-rhythm-bad"></div>
      <div class="mg-rhythm-zone mg-rhythm-good" id="mg-rhythm-sweet"></div>
      <div class="mg-rhythm-zone mg-rhythm-bad"></div>
      <div id="mg-rhythm-cursor" class="mg-rhythm-cursor"></div>
    </div>
    <div class="mg-rhythm-hint">Press [SPACE]</div>`;
  let pos = 0, dir = 1;
  mgAddInterval(() => {
    pos += 3 * dir;
    if (pos >= 95 || pos <= 0) dir *= -1;
    const c = document.getElementById('mg-rhythm-cursor');
    if (c) c.style.left = pos + '%';
  }, 20);
  window.onkeydown = (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (pos >= 32 && pos <= 64) resolveMemoryMinigame();
      else playMemorySound('error');
    }
  };
}

// 9. Click anywhere 20 times
function mgGameClickArena() {
  setMgInfo('RAGE CLICK', 'Click anywhere in the box 20 times!');
  const arena = getMgArena();
  let c = 20;
  arena.innerHTML = `<div class="mg-click-count">${c}</div>`;
  arena.style.cursor = 'crosshair';
  arena.addEventListener('mousedown', function click() {
    playMemorySound('pop');
    c--;
    const el = arena.querySelector('.mg-click-count');
    if (el) el.textContent = c;
    if (c <= 0) { arena.removeEventListener('mousedown', click); arena.style.cursor = ''; resolveMemoryMinigame(); }
  });
}

// 10. Memory Match (flip pairs)
function mgGameMemoryMatch() {
  setMgInfo('MEMORY MATCH', 'Find a matching pair!');
  const arena  = getMgArena();
  arena.innerHTML = `<div class="mg-match-grid" id="mg-match"></div>`;
  const symbols = ['[A]','[A]','[B]','[B]','[C]','[C]','[D]','[D]'];
  symbols.sort(() => Math.random() - 0.5);
  let picked = [];
  symbols.forEach((sym, i) => {
    const card = document.createElement('div');
    card.className = 'mg-match-card';
    card.dataset.sym = sym;
    card.dataset.idx = i;
    card.textContent = '?';
    card.addEventListener('mousedown', function() {
      if (picked.length >= 2 || this.classList.contains('revealed')) return;
      this.classList.add('revealed');
      this.textContent = sym;
      picked.push(this);
      playMemorySound('pop');
      if (picked.length === 2) {
        if (picked[0].dataset.sym === picked[1].dataset.sym) {
          mgAddTimeout(resolveMemoryMinigame, 400);
        } else {
          playMemorySound('error');
          mgAddTimeout(() => {
            picked.forEach(c => { c.textContent = '?'; c.classList.remove('revealed'); });
            picked = [];
          }, 700);
        }
      }
    });
    document.getElementById('mg-match').appendChild(card);
  });
}

// 11. Don't Move
function mgGameFreeze() {
  setMgInfo('FREEZE!', 'Do not move your mouse for 3 seconds!');
  const arena = getMgArena();
  arena.innerHTML = `<div class="mg-freeze-time" id="mg-fz-t">3.0</div>`;
  let t = 3.0; let armed = false;
  mgAddTimeout(() => { armed = true; }, 500);
  arena.addEventListener('mousemove', (e) => {
    if (!armed) return;
    if (Math.abs(e.movementX) > 0 || Math.abs(e.movementY) > 0) {
      playMemorySound('error');
      t = 3.0;
      const el = document.getElementById('mg-fz-t');
      if (el) el.textContent = '3.0';
    }
  });
  mgAddInterval(() => {
    t -= 0.1;
    const el = document.getElementById('mg-fz-t');
    if (el) el.textContent = Math.max(0, t).toFixed(1);
    if (t <= 0) resolveMemoryMinigame();
  }, 100);
}

// 12. Dodge the wall
function mgGameDodge() {
  setMgInfo('DODGE', 'Hover the green box; don\'t touch the walls!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div id="mg-dg-box" class="mg-dg-box">[ GO ]</div>
    <div class="mg-dg-wall mg-dg-wall-top"></div>
    <div class="mg-dg-wall mg-dg-wall-bot"></div>`;
  const box = document.getElementById('mg-dg-box');
  let reached = false;
  box.style.left = '10%'; box.style.top = '40%';
  box.addEventListener('mouseenter', () => {
    if (reached) return;
    reached = true;
    box.style.left = '75%';
  });
  box.addEventListener('mousedown', () => { if (reached) resolveMemoryMinigame(); });
  arena.querySelectorAll('.mg-dg-wall').forEach(w => {
    w.addEventListener('mouseenter', () => { playMemorySound('error'); reached = false; box.style.left = '10%'; });
  });
}

// 13. Osu! circles
function mgGameOsu() {
  setMgInfo('OSU!', 'Click all the circles before they vanish!');
  const arena = getMgArena();
  let remaining = 4;
  const spawn = () => {
    if (remaining <= 0) return resolveMemoryMinigame();
    const c = document.createElement('div');
    c.className = 'mg-osu-circle';
    c.textContent = remaining;
    c.style.top  = (15 + Math.random() * 55) + '%';
    c.style.left = (15 + Math.random() * 55) + '%';
    let missTimer = mgAddTimeout(() => {
      c.remove(); playMemorySound('error'); remaining = 4; spawn();
    }, 1200);
    c.addEventListener('mousedown', function() {
      clearTimeout(missTimer); playMemorySound('pop'); this.remove(); remaining--; spawn();
    });
    arena.appendChild(c);
  };
  spawn();
}

// 14. Maze (hover path)
function mgGameMaze() {
  setMgInfo('STEADY HAND', 'Go from START to END without touching the red!');
  const arena = getMgArena();
  arena.innerHTML = `
    <div class="mg-maze-bg"></div>
    <div class="mg-maze-path mg-maze-path-top"></div>
    <div class="mg-maze-path mg-maze-path-right"></div>
    <div class="mg-maze-path mg-maze-path-bot"></div>
    <div class="mg-maze-start" id="mg-mz-start">START</div>
    <div class="mg-maze-end"   id="mg-mz-end">END</div>`;
  let tracking = false;
  document.getElementById('mg-mz-start').addEventListener('mouseenter', () => { playMemorySound('beep'); tracking = true; });
  arena.querySelector('.mg-maze-bg').addEventListener('mouseenter', () => {
    if (tracking) { playMemorySound('error'); tracking = false; }
  });
  document.getElementById('mg-mz-end').addEventListener('mouseenter', () => { if (tracking) resolveMemoryMinigame(); });
}

// 15. Find the imposter
function mgGameFindImposter() {
  setMgInfo('IMPOSTER!', 'Click the odd one out!');
  const arena = getMgArena();
  arena.innerHTML = `<div class="mg-imposters" id="mg-imp"></div>`;
  // Use ASCII faces instead of emoji
  const normal = ':^)';
  const odd    = ';^)';
  const items  = Array(23).fill(normal).concat([odd]);
  items.sort(() => Math.random() - 0.5);
  items.forEach(face => {
    const el = document.createElement('div');
    el.className = 'mg-imposter-face';
    el.textContent = face;
    el.addEventListener('mousedown', () => {
      if (face === odd) resolveMemoryMinigame();
      else playMemorySound('error');
    });
    document.getElementById('mg-imp').appendChild(el);
  });
}
