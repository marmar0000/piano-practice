'use strict';
// 部品をつなぐ部分：押している鍵盤の管理・表示エリア・操作パネル・モード切り替え・開始画面・画面全体の操作・最初の起動
// いちばん最後に読み込む（最後の applyMode() で画面を作る）

// ===== 押している鍵盤・サスティン（ペダル）の管理 =====
const pressCount = new Map();   // midi -> 押している指・キーの数
let sustain = false;
// 押さえている間だけサスティンを効かせているもの：ペダル欄に触れている指（pointerId）・スペースキー（'space'）
const sustainHolds = new Set();

function noteOn(midi) {
  const n = (pressCount.get(midi) || 0) + 1;
  pressCount.set(midi, n);
  startVoice(midi);
  setKeyActive(midi, true);
  updateDisplay();
  if (settings.mode === 'song') songNoteOn(midi);
}

// perfMs：離した瞬間の時刻（イベントの timeStamp）。音の長さの判定に使う
function noteOff(midi, perfMs) {
  const n = (pressCount.get(midi) || 0) - 1;
  if (n > 0) { pressCount.set(midi, n); return; }
  pressCount.delete(midi);
  if (settings.mode === 'song') songLengthRelease(midi, perfMs ?? performance.now());
  setKeyActive(midi, false);
  if (!sustain) stopVoice(midi);
  updateDisplay();
}

function setSustain(on) {
  sustain = on;
  const btn = document.getElementById('sustainBtn');
  btn.classList.toggle('on', on);
  btn.textContent = 'サスティン：' + (on ? 'オン' : 'オフ');
  pedalEl.classList.toggle('on', on);
  pedalEl.setAttribute('aria-pressed', String(on));
  pedalEl.textContent = on ? 'ペダル：踏んでいます' : 'ペダル（押さえている間だけ効く）';
  if (!on) {
    sustainHolds.clear();   // モードの切り替えなどで切ったときは、押さえていた指・キーも離した扱いにする
    for (const midi of [...voices.keys()]) {
      if (!pressCount.has(midi)) stopVoice(midi);
    }
  }
}

// 押さえている間だけ効かせる（ペダル欄・スペースキー）。どれか1つでも押さえていれば効き、全部離したら切る
function holdSustain(source, on) {
  if (on) { sustainHolds.add(source); setSustain(true); return; }
  if (!sustainHolds.delete(source)) return;
  if (sustainHolds.size === 0) setSustain(false);
}

// ペダル欄：指で押さえている間だけサスティン。鍵盤とは別の場所なので、触れた指で鍵盤は鳴らない
// 指がペダル欄の外に出ても、離すまでは踏んでいる扱い（setPointerCapture）。ほかの指で鍵盤を弾ける
const pedalEl = document.getElementById('pedal');
pedalEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pedalEl.setPointerCapture(e.pointerId);
  holdSustain(e.pointerId, true);
});
const pedalUp = (e) => holdSustain(e.pointerId, false);
pedalEl.addEventListener('pointerup', pedalUp);
pedalEl.addEventListener('pointercancel', pedalUp);
pedalEl.addEventListener('lostpointercapture', pedalUp);
pedalEl.addEventListener('contextmenu', (e) => e.preventDefault());

// 大きい画面かどうかが変わったら（PCでウィンドウの大きさを変えたときなど）、ペダル欄・ボタンを出し直す
let largeScreen = isLargeScreen();
function updatePedalForScreen() {
  if (isLargeScreen() === largeScreen) return;
  largeScreen = !largeScreen;
  setSustain(false);
  updateVisibility();
}

function releaseAll() {
  pointerNotes.clear();
  keyNotes.clear();
  pressCount.clear();
  if (ctx) for (const midi of [...voices.keys()]) stopVoice(midi);
  document.querySelectorAll('.key.active').forEach((el) => el.classList.remove('active'));
  updateDisplay();
}

// ===== 表示エリア（音名・五線譜） =====
let lastShown = null;
function updateDisplay() {
  if (settings.mode !== 'piano') return;
  const displayEl = document.getElementById('display');
  const nameEl = document.getElementById('noteName');
  const subEl = document.getElementById('noteSub');
  const staffMode = settings.display !== 'names';
  displayEl.classList.toggle('staff-mode', staffMode);
  const held = [...pressCount.keys()].sort((a, b) => a - b);
  const idle = held.length === 0;
  if (!idle) lastShown = held;
  nameEl.classList.toggle('idle', idle);
  if (staffMode) renderStaff(document.getElementById('staff'), lastShown || [], settings.display, { dim: idle });
  if (!lastShown) return;
  nameEl.textContent = lastShown.map((m) => nameOf(m, 'doremi')).join(' ');
  const cde = lastShown.map((m) => NAMES_CDE[m % 12] + octaveOf(m)).join(' ');
  subEl.textContent = staffMode ? nameEl.textContent + '（' + cde + '）' : cde;
}

// ===== 操作パネル =====
function shiftOctave(delta) {
  const next = clampStart(startOctave + delta);
  if (next === startOctave) return;
  if (settings.mode === 'song') { songOctave = next; renderKeyboard(); return; }
  settings.startOctave = next;
  saveSettings();
  renderKeyboard();
}

const toneSelect = document.getElementById('toneSelect');
const volumeInput = document.getElementById('volume');
const labelSelect = document.getElementById('labelSelect');
const sizeSelect = document.getElementById('sizeSelect');
const rowsSelect = document.getElementById('rowsSelect');
const displaySelect = document.getElementById('displaySelect');
const pedalSelect = document.getElementById('pedalSelect');

// 外した音色を選んでいたときは、近い音色に置きかえる（録音・やわらかい → 録音・ふつう）
if (!(settings.tone in TONES)) {
  settings.tone = settings.tone === 'sample2' ? 'sample3' : 'piano';
  saveSettings();
}
toneSelect.value = settings.tone;
volumeInput.value = settings.volume;
labelSelect.value = settings.labels;
sizeSelect.value = settings.size;
rowsSelect.value = settings.rows;
displaySelect.value = settings.display;
pedalSelect.value = settings.pedalMode;

toneSelect.addEventListener('change', () => {
  settings.tone = toneSelect.value;
  saveSettings();
  useSamplesFor(settings.tone);
  updateToneStatus();
  toneSelect.blur();
});

// 録音のピアノを読み込んでいる間・読み込めなかったときに、音色の横に知らせる（その間は合成のピアノで鳴らす）
function updateToneStatus() {
  const el = document.getElementById('toneStatus');
  const state = isSampleTone(settings.tone) ? sampleState(settings.tone) : 'none';
  el.textContent = state === 'loading' ? '読み込み中…'
    : state === 'error' ? '読み込めませんでした（合成のピアノで鳴らします）' : '';
}
// 録音のピアノを選んでいたら、開始画面のタップを待たずに読み込みを始める
useSamplesFor(settings.tone);
updateToneStatus();
volumeInput.addEventListener('input', () => {
  settings.volume = Number(volumeInput.value);
  applyVolume();
  saveSettings();
});
labelSelect.addEventListener('change', () => {
  settings.labels = labelSelect.value;
  saveSettings();
  updateLabels();
  labelSelect.blur();
});
sizeSelect.addEventListener('change', () => {
  settings.size = sizeSelect.value;
  saveSettings();
  renderKeyboard();
  sizeSelect.blur();
});
displaySelect.addEventListener('change', () => {
  settings.display = displaySelect.value;
  saveSettings();
  updateDisplay();
  displaySelect.blur();
});
rowsSelect.addEventListener('change', () => {
  settings.rows = rowsSelect.value;
  saveSettings();
  renderKeyboard();
  rowsSelect.blur();
});
document.getElementById('octDown').addEventListener('click', () => shiftOctave(-1));
document.getElementById('octUp').addEventListener('click', () => shiftOctave(1));
document.getElementById('sustainBtn').addEventListener('click', () => setSustain(!sustain));
// ペダルの種類を変えたら、サスティンは切っておく（ボタンでオンのままペダル欄に変わる・その逆を防ぐ）
pedalSelect.addEventListener('change', () => {
  settings.pedalMode = pedalSelect.value;
  saveSettings();
  setSustain(false);
  updateVisibility();
  refitKeyboard();   // ペダル欄の分だけ、鍵盤に使える高さが変わる
  pedalSelect.blur();
});

// ===== モード切り替え =====
const modeSelect = document.getElementById('modeSelect');
modeSelect.value = settings.mode;
modeSelect.addEventListener('change', () => {
  settings.mode = modeSelect.value;
  saveSettings();
  applyMode();
  modeSelect.blur();
});

// data-modes に書いたモードのときだけ出す。片手練習・判定つきのときだけ出す項目もある
// ペダル：大きい画面だけの項目（data-large-only）。data-pedal="hold" はペダル欄（大きい画面で「押している間」のとき）、
// data-pedal="toggle" は切り替え式のボタン（スマホ、または大きい画面で「切り替え」のとき）
function updateVisibility() {
  const mode = settings.mode;
  const judge = settings.songHand !== 'both' && settings.songAdvance === 'judge';
  const holdPedal = largeScreen && settings.pedalMode === 'hold';
  document.querySelectorAll('[data-modes]').forEach((el) => {
    el.hidden = !el.dataset.modes.split(' ').includes(mode) ||
      ('practiceOnly' in el.dataset && settings.songHand === 'both') ||
      ('judgeOnly' in el.dataset && !judge) ||
      ('largeOnly' in el.dataset && !largeScreen) ||
      (el.dataset.pedal === 'hold' && !holdPedal) ||
      (el.dataset.pedal === 'toggle' && holdPedal);
  });
}

function applyMode() {
  const mode = settings.mode;
  updateVisibility();
  setSustain(false);
  stopQuiz();
  stopKeyQuiz();
  stopPlayback();
  if (mode === 'song') songOctave = null;
  if (mode === 'nameQuiz') { releaseAll(); startQuiz(); return; }
  if (mode === 'keyQuiz') resetKeyQuizScore();
  renderKeyboard();   // 位置当てクイズのときは、この中で最初の問題を出す
}

// ===== 開始画面 =====
const overlay = document.getElementById('overlay');
// iPad・iPhone（中身がWebKit）かどうか。iPadのSafari・Chromeは「デスクトップ用のサイト」としてMacのふりをすることが多いので、
// 「Macなのに画面に触れられる」ことでも見分ける。CriOS（Chrome）・FxiOS（Firefox）・EdgiOS（Edge）はiOS版のブラウザ
const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod|CriOS|FxiOS|EdgiOS/.test(ua) ||
  ((/Macintosh/.test(ua) || navigator.platform === 'MacIntel') && (navigator.maxTouchPoints > 1 || 'ontouchend' in document));
// 開始画面の下に、版と端末の判定を出す（実機で古い版が表示されていないか・iPadとして動いているかを確かめるため）
// 版（APP_VERSION）は index.html に書いている
document.getElementById('appVersion').textContent =
  `版 ${APP_VERSION}・${isIOS ? 'iPad・iPhone' : 'iPad・iPhone以外'}として動作中`;
if (isIOS) document.getElementById('iosNotice').classList.remove('hidden');

function hideOverlay() {
  audioStarted = true;
  initAudio();
  overlay.classList.add('hidden');
}
function showOverlay(resume) {
  document.getElementById('startBtn').textContent = resume ? 'タップして音を再開' : 'タップして始める';
  overlay.classList.remove('hidden');
}
// iOSでは「指を離した（タップが完了した）」操作でないと音を開始できないことがあるので click で受ける
overlay.addEventListener('click', hideOverlay);

// ===== 画面全体の操作（ダブルタップ・音の再開・画面を離れたとき） =====
// ダブルタップでの拡大を止める予備の処理（iOSではCSSだけでは止めきれないことがある。五線譜のSVGの上など）
// 短い間隔の2回目のタップはブラウザの動作を止め、ボタンの上ならボタンの操作だけ行う
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  const quick = now - lastTouchEnd < 350;
  lastTouchEnd = now;
  if (!quick || e.touches.length > 0) return;
  const t = e.target;
  if (!t.closest || t.closest('.keyboard, .pedal, select, input')) return;   // 鍵盤・ペダル欄は自前で処理、選択欄・スライダーはそのまま
  e.preventDefault();
  const target = t.closest('button, .overlay');
  if (target) target.click();
}, { passive: false });

// 音が止まっていたら、操作のたびに再開を試みる
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  document.addEventListener(type, () => {
    if (!audioStarted) return;
    if (!ctx || ctx.state !== 'running') initAudio();
  }, true);
}

// 画面を離れたら鳴っている音を止める。戻ってきたとき音が止まっていたら再開用の画面を出す
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { setSustain(false); releaseAll(); stopPlayback(); return; }
  if (audioStarted && ctx && ctx.state !== 'running') showOverlay(true);
});

// ===== 設定のたたみ・開き =====
// 最初は、大きい画面（iPadなど）では開き、スマホではたたむ。切り替えたら保存する
const controlsEl = document.querySelector('.controls');
const settingsToggle = document.getElementById('settingsToggle');
function applyControlsOpen() {
  const open = settings.controlsOpen ?? isLargeScreen();
  controlsEl.classList.toggle('collapsed', !open);
  settingsToggle.textContent = open ? '設定を閉じる ▲' : '設定 ▼';
  settingsToggle.setAttribute('aria-expanded', String(open));
}
settingsToggle.addEventListener('click', () => {
  settings.controlsOpen = controlsEl.classList.contains('collapsed');
  saveSettings();
  applyControlsOpen();
  refitKeyboard();
});
applyControlsOpen();

applyMode();
