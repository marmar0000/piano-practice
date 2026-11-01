'use strict';
// 鍵盤の位置当てクイズ

// ===== 鍵盤の位置当てクイズ =====
// 出題された音名の鍵盤を、画面の鍵盤（またはPCのキーボード）で押して答える
const keyQuiz = {
  midi: null, answered: false,
  correct: 0, total: 0, streak: 0,
  timer: null,
};

const keyQuizRecordKey = () => 'key-' + settings.keyQuizKeys + '-' + settings.keyQuizOctave;
const quizNoteName = (midi) => (settings.quizNames === 'cde' ? NAMES_CDE : NAMES_DOREMI)[midi % 12];

function resetKeyQuizScore() {
  stopKeyQuiz();
  keyQuiz.correct = keyQuiz.total = keyQuiz.streak = 0;
  keyQuiz.midi = null;
}

function stopKeyQuiz() {
  clearTimeout(keyQuiz.timer);
}

// いま画面に出ている鍵盤の音（重複なし）
function visibleMidis() {
  const set = new Set([...keyboardEl.querySelectorAll('.key')].map((el) => Number(el.dataset.midi)));
  return [...set];
}

function nextKeyQuestion() {
  clearTimeout(keyQuiz.timer);
  const exact = settings.keyQuizOctave === 'exact';
  const allowed = (m) => settings.keyQuizKeys === 'all' || !isBlack(m);
  // オクターブも当てるときは画面にある鍵盤から、そうでなければ12音（または白鍵7音）から選ぶ
  let candidates = exact
    ? visibleMidis().filter(allowed)
    : [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71].filter(allowed);
  const prev = keyQuiz.midi;
  const same = (m) => prev !== null && (exact ? m === prev : m % 12 === prev % 12);
  if (candidates.length > 1) candidates = candidates.filter((m) => !same(m));   // 同じ問題が続かないように
  keyQuiz.midi = candidates[Math.floor(Math.random() * candidates.length)];
  keyQuiz.answered = false;
  clearKeyMarks();
  updateLabels();
  const name = quizNoteName(keyQuiz.midi);
  document.getElementById('keyQuizPrompt').textContent = exact ? name + octaveOf(keyQuiz.midi) : name;
  setFeedback('この音の鍵盤をタップ', 'guide', 'keyQuizFeedback');
  updateKeyQuizScore();
}

function answerKeyQuiz(midi) {
  if (keyQuiz.answered || keyQuiz.midi === null) return;
  keyQuiz.answered = true;
  const exact = settings.keyQuizOctave === 'exact';
  const isRight = (m) => (exact ? m === keyQuiz.midi : m % 12 === keyQuiz.midi % 12);
  const ok = isRight(midi);
  keyQuiz.total++;
  if (ok) { keyQuiz.correct++; keyQuiz.streak++; } else keyQuiz.streak = 0;
  updateRecord(keyQuiz, keyQuizRecordKey());
  // 正解の鍵盤を緑、押しまちがえた鍵盤を赤にして、正解の鍵盤に音名を出す
  keyboardEl.querySelectorAll('.key').forEach((el) => {
    const m = Number(el.dataset.midi);
    if (isRight(m)) {
      el.classList.add('correct');
      el.querySelector('.key-label').textContent = quizNoteName(m) + (exact || m % 12 === 0 ? octaveOf(m) : '');
    } else if (m === midi) {
      el.classList.add('wrong');
    }
  });
  setFeedback(ok ? '正解！' : 'ざんねん… 正解は緑の鍵盤', ok ? 'ok' : 'ng', 'keyQuizFeedback');
  updateKeyQuizScore();
  // まちがえたときは正解の場所を確かめられるよう長めに表示してから次へ
  keyQuiz.timer = setTimeout(nextKeyQuestion, ok ? 800 : 2200);
}

function clearKeyMarks() {
  keyboardEl.querySelectorAll('.key.correct, .key.wrong').forEach((el) => el.classList.remove('correct', 'wrong'));
}

function updateKeyQuizScore() {
  document.getElementById('keyQuizScore').textContent = scoreText(keyQuiz, keyQuizRecordKey());
}

for (const [id, prop] of [['keyQuizKeysSelect', 'keyQuizKeys'], ['keyQuizOctaveSelect', 'keyQuizOctave']]) {
  const sel = document.getElementById(id);
  sel.value = settings[prop];
  sel.addEventListener('change', () => {
    settings[prop] = sel.value;
    saveSettings();
    restartCurrentQuiz();
    sel.blur();
  });
}
