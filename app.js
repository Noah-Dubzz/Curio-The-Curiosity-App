// ============================================================
//  Curio – The Curiosity App
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
let recognition     = null;
let currentQuizTopic    = '';
let currentQuizQuestion = '';
let awaitingResponse    = false;

// ── System Prompt Builder ────────────────────────────────────
function buildSystemPrompt() {
  return `You are Curio, a learning assistant who talks like a knowledgeable friend — casual, sharp, and direct. NOT a tutor, NOT a motivational speaker. Think of how a smart upperclassman would help a friend figure something out.

User Profile:
- Name: ${userName}
- Background: ${userBackground}

Conversation Flow — follow this order every time:

STEP 1 — CLARIFY FIRST
If the user mentions a broad topic ("programming", "math", "science", etc.), do NOT dive in yet.
Acknowledge briefly and ask what specific thing they want to learn.
Bad: "That's awesome, programming is such a powerful skill! When you're designing a level..."
Good: "Sounds good! Programming is pretty broad though — is there a specific topic you're trying to figure out?"

STEP 2 — MAKE A SMART GUESS ABOUT THEIR CONTEXT
Once you know the specific topic, use their background to make a smart assumption about their setup.
State it casually and confirm. Example: "I'm guessing you're working in Python?"

STEP 3 — FIND THE ANCHOR
Ask if they know a closely related concept they probably already understand.
Example: "Alright, so are you familiar with regular Python lists?"

STEP 3b — IF THEY SAY NO TO THE ANCHOR
Don't panic or trail off. Immediately pivot to an even simpler everyday analogy — no jargon.
Teach that simpler thing first in 2–3 sentences, then come back to the original topic.
Example: If they don't know Python lists, explain them using a shopping list or a row of lockers first.
Never leave a thought unfinished. Always complete your sentence and ask a follow-up.

STEP 4 — BRIDGE AND TEACH
Use what they know to introduce what they don't. One idea at a time.
After each step: short check-in like "does that make sense?" or "still with me?"

STEP 5 — GIVE EXAMPLES WHEN ASKED
Don't dump code immediately. Wait until they ask or are clearly stuck.

Tone Rules (CRITICAL):
- 2–3 sentences per reply max, then stop and ask something.
- NEVER open with enthusiasm or compliments. No "That's awesome!", "Great question!", "Programming is such a powerful skill!" — just get to the point.
- Sound like a person texting a friend, not an assistant writing an email.
- Casual language: "yeah", "totally", "alright", "kind of like...", "nah", "fair enough"
- Use ${userName}'s name occasionally, not every message.

Knowledge Bank Signal:
Only after ${userName} has clearly shown they understand the concept (answered correctly, or explicitly said they get it), end your response with this exact tag on its own line:
[LEARNED: <concise topic name>]

Example ending: "Yeah exactly, you got it. [LEARNED: Linked Lists]"

Do NOT emit [LEARNED: ...] until real understanding is shown.`;
}

// ── Helpers ───────────────────────────────────────────────────
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal Markdown → HTML renderer (safe: HTML-escaped first).
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

  // 5. Newlines → <br>
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
  conversationHistory = [];
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'welcome-message';
  welcome.id        = 'welcome-msg';
  welcome.innerHTML = `
    <div class="welcome-icon">🧠</div>
    <h2>Hi again, ${escapeHtml(userName)}!</h2>
    <p>Ready for a new topic?<br />What would you like to learn?</p>
  `;
  msgs.appendChild(welcome);
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

  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errMsg = `API error ${response.status}`;
    try {
      const errData = await response.json();
      errMsg = errData?.error?.message || errMsg;
    } catch (_) { /* ignore */ }
    throw new Error(errMsg);
  }

  const data  = await response.json();
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
      ? 'Curio is a little overloaded right now — give it a second and try again!'
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

  // Award gems and update display
  const earned = 200;
  gems += earned;
  localStorage.setItem('curio_gems', String(gems));
  document.getElementById('gems-count').textContent = gems;

  showToast(`+${earned} 💎 You learned ${topic}!`);

  // Offer a quiz after a short delay
  currentQuizTopic = topic;
  setTimeout(() => openQuiz(topic), 2000);
}

function renderKnowledgeBank() {
  const container = document.getElementById('knowledge-bank');
  if (knowledgeBank.length === 0) {
    container.innerHTML = '<div class="empty-state">Nothing learned yet.<br>Start a conversation!</div>';
    return;
  }
  container.innerHTML = knowledgeBank
    .map(item => `<div class="knowledge-item">
      <span class="k-check">✓</span>
      <span>${escapeHtml(item)}</span>
    </div>`)
    .join('');
}

// ── Toast ─────────────────────────────────────────────────────
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
  document.getElementById('quiz-question-text').textContent = 'Loading question…';
  document.getElementById('quiz-answer').value = '';
  document.getElementById('quiz-answer').style.display = '';

  const submitBtn = document.getElementById('quiz-submit-btn');
  const skipBtn   = document.querySelector('.modal-ghost-btn');
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
  const resp = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `Write one short quiz question (one sentence) to test a student's understanding of "${topic}". The question should require a short paragraph answer showing conceptual understanding. Return ONLY the question text, nothing else.` }]
      }]
    })
  });
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
    `Explain ${topic} in your own words.`;
}

async function submitQuiz() {
  const answer    = document.getElementById('quiz-answer').value.trim();
  const submitBtn = document.getElementById('quiz-submit-btn');
  const skipBtn   = document.querySelector('.modal-ghost-btn');

  if (!answer) {
    document.getElementById('quiz-answer').style.borderColor = '#ef4444';
    setTimeout(() => { document.getElementById('quiz-answer').style.borderColor = ''; }, 1500);
    return;
  }

  submitBtn.textContent = 'Checking…';
  submitBtn.disabled    = true;

  try {
    const resp = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: `Quiz question: "${currentQuizQuestion}"\nStudent answer: "${answer}"\n\nBriefly evaluate in 2–3 encouraging sentences. Tell them if their understanding is correct or where they went slightly wrong. Be supportive. End with exactly one word on a new line: CORRECT or INCORRECT.` }]
        }]
      })
    });

    const data     = await resp.json();
    const feedback = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Determine correctness — CORRECT must appear and INCORRECT must not (as separate word)
    const isCorrect = /\bCORRECT\b/.test(feedback) && !/\bINCORRECT\b/.test(feedback);

    if (isCorrect) {
      gems += 200;
      localStorage.setItem('curio_gems', String(gems));
      document.getElementById('gems-count').textContent = gems;
      showToast('+200 💎 Bonus gems! Great answer!');
    }

    // Show feedback in place of the textarea
    document.getElementById('quiz-answer').style.display = 'none';
    document.getElementById('quiz-question-text').innerHTML =
      `<div style="font-size:26px;text-align:center;margin-bottom:10px">${isCorrect ? '🎉' : '💡'}</div>` +
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

  document.querySelector('.modal-ghost-btn').textContent = 'Skip';

  document.getElementById('quiz-answer').style.display      = '';
  document.getElementById('quiz-answer').style.borderColor  = '';
  document.getElementById('quiz-question-text').textContent = '';
  currentQuizQuestion = '';
}

// ── Text-to-Speech ────────────────────────────────────────────
function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  document.getElementById('tts-btn').classList.toggle('active', ttsEnabled);
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

// ── Voice Input ───────────────────────────────────────────────
function toggleMic() {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert('Voice input is not supported in this browser. Please use Chrome.');
    return;
  }

  if (isRecording) {
    recognition?.stop();
    return;
  }

  recognition            = new SpeechRecognition();
  recognition.continuous     = false;
  recognition.interimResults = false;
  recognition.lang           = 'en-US';

  recognition.onstart  = () => {
    isRecording = true;
    document.getElementById('mic-btn').classList.add('recording');
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    document.getElementById('chat-input').value = transcript;
    document.getElementById('chat-input').focus();
  };

  recognition.onend    = () => {
    isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
    recognition = null;
  };

  recognition.onerror  = () => {
    isRecording = false;
    document.getElementById('mic-btn').classList.remove('recording');
    recognition = null;
  };

  recognition.start();
}

// ── Sidebar Toggle ────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

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
