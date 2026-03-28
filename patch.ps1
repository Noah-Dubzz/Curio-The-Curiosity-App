
# patch.ps1 — applies all 7 bug fixes to app.js
Set-Location "c:\Users\ntdou\Downloads\Curio-The-Curiosity-App"
$appPath = (Resolve-Path app.js).Path
[string[]]$lines = [System.IO.File]::ReadAllLines($appPath, [System.Text.Encoding]::UTF8)
Write-Host "Loaded $($lines.Length) lines"

# ── Replacement blocks (use single-quoted here-strings so JS ${} is literal) ──

# 1. closeQuiz  (0-based 463..480)
$closeQuiz = @'
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
'@

# 2. submitQuiz  (0-based 417..462)  — fix querySelector, gems only on correct
$submitQuiz = @'
async function submitQuiz() {
  const answer    = document.getElementById('quiz-answer').value.trim();
  const submitBtn = document.getElementById('quiz-submit-btn');
  const skipBtn   = document.getElementById('quiz-skip-btn');

  if (!answer) {
    document.getElementById('quiz-answer').style.borderColor = '#ef4444';
    setTimeout(() => { document.getElementById('quiz-answer').style.borderColor = ''; }, 1500);
    return;
  }

  submitBtn.textContent = 'Checking…';
  submitBtn.disabled    = true;

  try {
    const data     = await geminiRequest({
      contents: [{
        role: 'user',
        parts: [{ text: `Quiz question: "${currentQuizQuestion}"\nStudent answer: "${answer}"\n\nBriefly evaluate in 2–3 encouraging sentences. Tell them if their understanding is correct or where they went slightly wrong. Be supportive. End with exactly one word on a new line: CORRECT or INCORRECT.` }]
      }]
    });
    const feedback = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Determine correctness — CORRECT must appear and INCORRECT must not
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
      `<div style="font-size:26px;text-align:center;margin-bottom:10px">${isCorrect ? '&#x1F389;' : '&#x1F4A1;'}</div>` +
      formatMessage(feedback.replace(/\b(CORRECT|INCORRECT)\b\s*$/, '').trim());

    submitBtn.classList.add('hidden');
    skipBtn.textContent = 'Close';
  } catch (_) {
    closeQuiz();
  }
}
'@

# 3. openQuiz  (0-based 379..405)  — fix querySelector, topic label stays (moved in HTML)
$openQuiz = @'
async function openQuiz(topic) {
  currentQuizQuestion = '';

  document.getElementById('quiz-topic-label').textContent = `Test your knowledge of ${topic}`;
  document.getElementById('quiz-question-text').textContent = 'Loading question…';
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

'@

# 4. renderKnowledgeBank  (0-based 353..367)  — items clickable
$renderKB = @'
function renderKnowledgeBank() {
  const container = document.getElementById('knowledge-bank');
  if (knowledgeBank.length === 0) {
    container.innerHTML = '<div class="empty-state">Nothing learned yet.<br>Start a conversation!</div>';
    return;
  }
  container.innerHTML = knowledgeBank
    .map(item => `<div class="knowledge-item" data-topic="${escapeHtml(item)}" style="cursor:pointer" title="Tap to attempt challenge">
      <span class="k-check">&#x2713;</span>
      <span>${escapeHtml(item)}</span>
      <span style="margin-left:auto;font-size:11px;opacity:0.45">&#9658;</span>
    </div>`)
    .join('');
  container.querySelectorAll('.knowledge-item').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.dataset.topic;
      if (t) { currentQuizTopic = t; openQuiz(t); }
    });
  });
}

'@

# 5. handleLearned + NEW showLearnedPopup  (0-based 333..352)
$handleLearned = @'
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
        <div style="font-size:40px;margin-bottom:10px">&#x1F9E0;</div>
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

'@

# 6. newConversation  (0-based 200..221)  — add speechSynthesis.cancel()
$newConvo = @'
function newConversation() {
  speechSynthesis.cancel();
  conversationHistory = [];
  const msgs = document.getElementById('messages');
  msgs.innerHTML = '';

  const welcome = document.createElement('div');
  welcome.className = 'welcome-message';
  welcome.id        = 'welcome-msg';
  welcome.innerHTML = `
    <div class="welcome-icon">&#x1F9E0;</div>
    <h2>Hi again, ${escapeHtml(userName)}!</h2>
    <p>Ready for a new topic?<br />What would you like to learn?</p>
  `;
  msgs.appendChild(welcome);
}
'@

# 7. buildSystemPrompt  (0-based 20..72)
$buildSys = @'
function buildSystemPrompt() {
  return `You are Curio, a learning assistant who talks like a knowledgeable friend — casual, sharp, and direct. NOT a tutor, NOT a motivational speaker.

User Profile:
- Name: ${userName}
- Background: ${userBackground}

LANGUAGE RULE (CRITICAL):
Always respond in the same language the user writes in. If they write in Spanish, respond in Spanish. French — French. Creole — Creole. Always match their language and maintain the same casual personality. If they switch languages mid-conversation, switch with them immediately.

TOPIC RULE (CRITICAL):
You will teach ANYTHING without judgment — gaming strategies, Fortnite mechanics, pop culture, slang, memes, history, science, cooking, sports, music, finance, fashion, fitness, coding, math, philosophy, relationships, internet culture, literally anything. Zero gatekeeping. If someone wants to learn how to crank 90s in Fortnite, what baby Gronk means, BBL lingo, how stocks work, anything — same energy and same teaching approach every time.

Conversation Flow — follow this order every time:

STEP 1 — CLARIFY FIRST
If the user mentions a broad topic, do NOT dive in yet.
Acknowledge briefly and ask what specific part they want to learn.
Bad: "That's awesome! There's so much to know!"
Good: "Cool — that's pretty broad though, what specific part are you trying to figure out?"

STEP 2 — MAKE A SMART GUESS ABOUT THEIR CONTEXT
Once you know the specific topic, use their background to make a smart assumption.
State it casually and confirm.

STEP 3 — FIND THE ANCHOR
Ask if they know a closely related concept they probably already understand.

STEP 3b — IF THEY SAY NO TO THE ANCHOR
Don't panic or trail off. Pivot to a simpler everyday analogy — no jargon.
Teach that simpler thing first in 2–3 sentences, then come back to the original topic.
Never leave a thought unfinished. Always complete your sentence and ask a follow-up.

STEP 4 — BRIDGE AND TEACH
Use what they know to introduce what they don't. One idea at a time.
After each step: short check-in like "does that make sense?" or "still with me?"

STEP 5 — GIVE EXAMPLES WHEN ASKED
Don't dump information immediately. Wait until they ask or are clearly stuck.

Tone Rules (CRITICAL):
- 2–3 sentences per reply max, then stop and ask something.
- NEVER open with enthusiasm or compliments. No "That's awesome!", "Great question!" — just get to the point.
- Sound like a person texting a friend, not an assistant writing an email.
- Casual language: "yeah", "totally", "alright", "kind of like...", "nah", "fair enough"
- Use ${userName}'s name occasionally, not every message.

Knowledge Bank Signal:
Only after ${userName} has clearly shown they understand the concept (answered correctly, or explicitly said they get it), end your response with this exact tag on its own line:
[LEARNED: <concise topic name>]

Example ending: "Yeah exactly, you got it. [LEARNED: Fortnite Building Mechanics]"

Do NOT emit [LEARNED: ...] until real understanding is shown.`;
}

'@

# ── Apply replacements from bottom to top ───────────────────────────────────

# 1. closeQuiz 463..480
$lines = $lines[0..462] + ($closeQuiz.TrimEnd() -split "`n") + $lines[481..($lines.Length-1)]
Write-Host "After closeQuiz: $($lines.Length) lines"

# 2. submitQuiz 417..462
$lines = $lines[0..416] + ($submitQuiz.TrimEnd() -split "`n") + $lines[463..($lines.Length-1)]
Write-Host "After submitQuiz: $($lines.Length) lines"

# 3. openQuiz 379..405
$lines = $lines[0..378] + ($openQuiz.TrimEnd() -split "`n") + $lines[406..($lines.Length-1)]
Write-Host "After openQuiz: $($lines.Length) lines"

# 4. renderKnowledgeBank 353..367
$lines = $lines[0..352] + ($renderKB.TrimEnd() -split "`n") + $lines[368..($lines.Length-1)]
Write-Host "After renderKB: $($lines.Length) lines"

# 5. handleLearned 333..352
$lines = $lines[0..332] + ($handleLearned.TrimEnd() -split "`n") + $lines[353..($lines.Length-1)]
Write-Host "After handleLearned+popup: $($lines.Length) lines"

# 6. newConversation 200..221
$lines = $lines[0..199] + ($newConvo.TrimEnd() -split "`n") + $lines[222..($lines.Length-1)]
Write-Host "After newConversation: $($lines.Length) lines"

# 7. buildSystemPrompt 20..72
$lines = $lines[0..19] + ($buildSys.TrimEnd() -split "`n") + $lines[73..($lines.Length-1)]
Write-Host "After buildSystemPrompt: $($lines.Length) lines"

# Write out
[System.IO.File]::WriteAllLines($appPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Host "app.js patched successfully. Final lines: $($lines.Length)"
