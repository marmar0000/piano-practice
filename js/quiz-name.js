'use strict';
// 音名当てクイズ

// ===== 音名当てクイズ =====
// 五線譜に出た音符（♯なしの音）の音名を、ボタンで答える
const RECORD_KEY = 'piano-practice:quiz-records';   // 最高連続正解数（音部記号・出題範囲ごと）
const records = loadJSON(RECORD_KEY);
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ANSWER_NAMES = {
  doremi: ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'],
  cde: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
};
// 五線の外にはみ出す音の数（加線なし＝第1線のすぐ下〜第5線のすぐ上）
const QUIZ_EXT = { staff: 1, ledger1: 3, ledger2: 5 };
const OK_COLOR = '#1e8e3e';
const NG_COLOR = '#c5221f';
// PCキーボードで答える：C〜Bのキー、または1〜7
const QUIZ_KEYS = {
  KeyC: 0, KeyD: 1, KeyE: 2, KeyF: 3, KeyG: 4, KeyA: 5, KeyB: 6,
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6,
};
const diToMidi = (di) => 12 * (Math.floor(di / 7) + 1) + NATURAL_PC[di % 7];

const quizStaffEl = document.getElementById('quizStaff');
const answersEl = document.getElementById('answers');
const quiz = {
  clef: null, di: null, midi: null, answered: false,
  correct: 0, total: 0, streak: 0,
  timer: null, voiceTimer: null,
};

function startQuiz() {
  stopQuiz();
  quiz.correct = quiz.total = quiz.streak = 0;
  quiz.clef = quiz.di = null;
  renderAnswerButtons();
  nextQuestion();
}

function stopQuiz() {
  clearTimeout(quiz.timer);
  clearTimeout(quiz.voiceTimer);
}

function renderAnswerButtons() {
  answersEl.innerHTML = '';
  ANSWER_NAMES[settings.quizNames].forEach((name, step) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.dataset.step = step;
    answersEl.appendChild(btn);
  });
}

function nextQuestion() {
  clearTimeout(quiz.timer);
  const clef = settings.quizClef === 'both'
    ? (Math.random() < 0.5 ? 'treble' : 'bass')
    : settings.quizClef;
  const ext = QUIZ_EXT[settings.quizRange];
  const bottomDi = CLEFS[clef].bottomDi;
  const low = bottomDi - ext;
  const high = bottomDi + 8 + ext;
  let di;
  // 同じ問題が続かないようにする
  do { di = low + Math.floor(Math.random() * (high - low + 1)); }
  while (clef === quiz.clef && di === quiz.di);
  Object.assign(quiz, { clef, di, midi: diToMidi(di), answered: false });
  answersEl.querySelectorAll('button').forEach((b) => b.classList.remove('correct', 'wrong'));
  setFeedback('この音は何？', '');
  drawQuizStaff(INK);
  updateScore();
}

function drawQuizStaff(color) {
  // 出題範囲のいちばん高い音・低い音に合わせて表示範囲を固定する（問題ごとに五線の大きさが変わらないように）
  const ext = QUIZ_EXT[settings.quizRange];
  renderStaff(quizStaffEl, [quiz.midi], quiz.clef, {
    color,
    minY: -ext * S / 2 - 2 * S,
    maxY: 4 * S + ext * S / 2 + 2 * S,
  });
}

function answerQuiz(step) {
  if (quiz.answered) return;
  quiz.answered = true;
  const right = quiz.di % 7;
  const ok = step === right;
  quiz.total++;
  if (ok) { quiz.correct++; quiz.streak++; } else quiz.streak = 0;
  updateRecord(quiz, settings.quizClef + '-' + settings.quizRange);
  const buttons = answersEl.querySelectorAll('button');
  buttons[right].classList.add('correct');
  if (!ok) buttons[step].classList.add('wrong');
  const name = NAMES_DOREMI[quiz.midi % 12] + '（' + NAMES_CDE[quiz.midi % 12] + octaveOf(quiz.midi) + '）';
  setFeedback(ok ? '正解！ ' + name : '正解は ' + name, ok ? 'ok' : 'ng');
  drawQuizStaff(ok ? OK_COLOR : NG_COLOR);
  updateScore();
  playQuizNote(quiz.midi);
  // まちがえたときは正解を確かめられるよう長めに表示してから次へ
  quiz.timer = setTimeout(nextQuestion, ok ? 800 : 2000);
}

function playQuizNote(midi) {
  clearTimeout(quiz.voiceTimer);
  if (ctx) for (const m of [...voices.keys()]) stopVoice(m, 0.03);
  startVoice(midi);
  quiz.voiceTimer = setTimeout(() => stopVoice(midi), 900);
}

function setFeedback(text, cls, id = 'quizFeedback') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'quiz-feedback' + (cls ? ' ' + cls : '');
}

function updateScore() {
  document.getElementById('quizScore').textContent =
    scoreText(quiz, settings.quizClef + '-' + settings.quizRange);
}

// 正解数・正解率・連続正解・最高記録の表示
function scoreText(state, recordKey) {
  let text = '正解 ' + state.correct + ' / ' + state.total + '問';
  if (state.total > 0) text += '（' + Math.round(state.correct / state.total * 100) + '%）';
  return text + '　連続 ' + state.streak + '　最高 ' + (records[recordKey] || 0);
}

// 連続正解の最高記録を更新する
function updateRecord(state, recordKey) {
  if (state.streak > (records[recordKey] || 0)) {
    records[recordKey] = state.streak;
    saveJSON(RECORD_KEY, records);
  }
}

function quizKeydown(e) {
  if (!(e.code in QUIZ_KEYS)) return;
  hideOverlay();
  answerQuiz(QUIZ_KEYS[e.code]);
}

answersEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) answerQuiz(Number(btn.dataset.step));
});

for (const [id, prop] of [['quizClefSelect', 'quizClef'], ['quizRangeSelect', 'quizRange'], ['quizNamesSelect', 'quizNames']]) {
  const sel = document.getElementById(id);
  sel.value = settings[prop];
  sel.addEventListener('change', () => {
    settings[prop] = sel.value;
    saveSettings();
    restartCurrentQuiz();
    sel.blur();
  });
}
document.getElementById('quizResetBtn').addEventListener('click', restartCurrentQuiz);

function restartCurrentQuiz() {
  if (settings.mode === 'nameQuiz') startQuiz();
  else if (settings.mode === 'keyQuiz') { resetKeyQuizScore(); nextKeyQuestion(); }
}
