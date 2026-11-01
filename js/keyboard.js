'use strict';
// 画面鍵盤：鍵盤の描画・タッチとマウスの操作・PCキーボードでの演奏・画面の大きさが変わったときの作り直し

// ===== 鍵盤の描画 =====
// 2段のときは、下段＝基準の音域（右手）、上段＝そのすぐ下の音域（左手）
const keyboardEl = document.getElementById('keyboard');
const KEY_MIN_WIDTH = { large: 58, medium: 44, small: 32 };
const KEY_RATIO = 6;          // 白鍵の高さ÷幅の上限（実物のピアノに近い比率）
const KEY_MAX_HEIGHT = 420;
const DISPLAY_MIN = 90;       // 音名表示エリアに最低限残す高さ
let octaves = 2;
let rows = 1;
let startOctave = 4;

// 表示エリアに残す高さ。クイズや曲の表示は、中身に必要な高さを測って空ける
function displayMin() {
  const ids = settings.mode === 'keyQuiz' ? ['.keyquiz-panel']
    : settings.mode === 'song' ? ['.song-panel', '#songHint'] : [];
  let h = 0;
  for (const sel of ids) h += document.querySelector(sel).offsetHeight + 4;
  return Math.max(DISPLAY_MIN, h + 16);   // 16：表示エリアの上下の余白
}
let songOctave = null;   // 曲の練習で、オクターブボタンで動かした鍵盤の位置（null なら曲に合わせて自動）

function calcOctaves() {
  const width = keyboardEl.clientWidth || window.innerWidth;
  const minW = KEY_MIN_WIDTH[settings.size];
  return Math.max(1, Math.min(5, Math.floor((width / minW - 1) / 7)));
}

function calcRows(oct) {
  if (settings.rows !== 'auto') return Number(settings.rows);
  // 縦向きで、2段にしても鍵盤が十分な高さを保てるときだけ2段にする
  const whiteW = (keyboardEl.clientWidth || window.innerWidth) / (oct * 7 + 1);
  const available = window.innerHeight - document.querySelector('.controls').offsetHeight - displayMin();
  const portrait = window.innerHeight > window.innerWidth * 1.1;
  return portrait && available / 2 - 30 >= Math.min(whiteW * 4.5, 220) ? 2 : 1;
}

function clampStart(o) {
  const min = rows === 2 ? 1 + octaves : 1;
  return Math.max(min, Math.min(7 - octaves, o));
}

function rangeLabel(low) {
  return 'C' + low + '〜C' + (low + octaves);
}

function renderKeyboard() {
  releaseAll();
  octaves = calcOctaves();
  rows = calcRows(octaves);
  const defaultStart = 4 - Math.floor((octaves - 1) / 2);
  // 曲の練習では、曲の音がなるべく多く鍵盤に入る位置に合わせる（オクターブを動かしても保存しない）
  startOctave = settings.mode === 'song'
    ? clampStart(songOctave ?? fitOctaveForSong())
    : clampStart(settings.startOctave ?? defaultStart);
  lit.clear();   // 鍵盤を作り直したので、光らせている状態を忘れる

  keyboardEl.innerHTML = '';
  if (rows === 2) {
    addRow(startOctave - octaves, '上段（左手）：' + rangeLabel(startOctave - octaves));
    addRow(startOctave, '下段（右手）：' + rangeLabel(startOctave));
  } else {
    addRow(startOctave, null);
  }
  updateLabels();
  if (settings.mode === 'keyQuiz') nextKeyQuestion();   // 鍵盤の範囲が変わったので出題し直す
  if (settings.mode === 'song' && !player.playing) showSong();   // 鍵盤に入りきらない音があるかを表示し直す
  sizeKeyboard();   // 表示エリアの中身が決まってから、鍵盤の高さを決める
  document.getElementById('octLabel').textContent =
    rows === 2 ? 'C' + (startOctave - octaves) + '〜C' + (startOctave + octaves) : rangeLabel(startOctave);
}

function addRow(lowOctave, caption) {
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'kb-caption';
    cap.textContent = caption;
    keyboardEl.appendChild(cap);
  }
  const row = document.createElement('div');
  row.className = 'kb-row';
  const low = 12 * (lowOctave + 1);
  const high = low + 12 * octaves;
  const whiteW = 100 / (octaves * 7 + 1);
  const blackW = whiteW * 0.6;
  let whiteIndex = 0;
  for (let midi = low; midi <= high; midi++) {
    const el = document.createElement('div');
    el.className = 'key ' + (isBlack(midi) ? 'black' : 'white');
    el.dataset.midi = midi;
    if (isBlack(midi)) {
      el.style.left = (whiteIndex * whiteW - blackW / 2) + '%';
      el.style.width = blackW + '%';
    } else {
      whiteIndex++;
      if (midi === 60) {
        const mark = document.createElement('span');
        mark.className = 'c-mark';
        el.appendChild(mark);
      }
    }
    const label = document.createElement('span');
    label.className = 'key-label';
    el.appendChild(label);
    row.appendChild(el);
  }
  keyboardEl.appendChild(row);
}

function updateLabels() {
  keyboardEl.querySelectorAll('.key').forEach((el) => {
    const midi = Number(el.dataset.midi);
    const label = el.querySelector('.key-label');
    // 位置当てクイズ中は答えが分かってしまうので音名を出さない
    if (settings.labels === 'none' || settings.mode === 'keyQuiz') { label.textContent = ''; return; }
    let text = nameOf(midi, settings.labels);
    if (midi % 12 === 0) text += octaveOf(midi);
    label.textContent = text;
  });
}

function sizeKeyboard() {
  // 白鍵の幅に合わせた高さにする（縦長の画面で鍵盤が伸びすぎないように）
  const whiteW = keyboardEl.clientWidth / (octaves * 7 + 1);
  const controlsH = document.querySelector('.controls').offsetHeight;
  const extra = rows === 2 ? 50 : 0;   // 段の見出しと間隔
  const available = (window.innerHeight - controlsH - displayMin() - extra) / rows;
  const h = Math.max(100, Math.min(available, whiteW * KEY_RATIO, KEY_MAX_HEIGHT));
  keyboardEl.querySelectorAll('.kb-row').forEach((row) => { row.style.height = h + 'px'; });
}

function setKeyActive(midi, on) {
  // 2段のときは同じ音の鍵盤が両方の段にあることがある
  keyboardEl.querySelectorAll('[data-midi="' + midi + '"]').forEach((el) => el.classList.toggle('active', on));
}

// ===== タッチ・マウス操作（指を滑らせると隣の鍵盤に移る） =====
const pointerNotes = new Map();   // pointerId -> midi

function midiAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const key = el && el.closest('.key');
  return key && keyboardEl.contains(key) ? Number(key.dataset.midi) : null;
}

keyboardEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  keyboardEl.setPointerCapture(e.pointerId);
  const midi = midiAt(e.clientX, e.clientY);
  if (midi === null) return;
  pointerNotes.set(e.pointerId, midi);
  noteOn(midi);
  if (settings.mode === 'keyQuiz') answerKeyQuiz(midi);
  if (settings.mode === 'song') songJudgePress(midi, eventPerfTime(e));
});

keyboardEl.addEventListener('pointermove', (e) => {
  if (!pointerNotes.has(e.pointerId)) return;
  const midi = midiAt(e.clientX, e.clientY);
  const prev = pointerNotes.get(e.pointerId);
  if (midi === prev) return;
  if (prev !== null) noteOff(prev, eventPerfTime(e));
  pointerNotes.set(e.pointerId, midi);
  if (midi !== null) noteOn(midi);
});

function endPointer(e) {
  if (!pointerNotes.has(e.pointerId)) return;
  const midi = pointerNotes.get(e.pointerId);
  pointerNotes.delete(e.pointerId);
  if (midi !== null) noteOff(midi, eventPerfTime(e));
}
keyboardEl.addEventListener('pointerup', endPointer);
keyboardEl.addEventListener('pointercancel', endPointer);
keyboardEl.addEventListener('contextmenu', (e) => e.preventDefault());

// ===== PCキーボード操作 =====
const KEY_MAP = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
  KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
};
const keyNotes = new Map();   // code -> midi

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (calib.open) { calibKeydown(e); return; }
  if (settings.mode === 'nameQuiz') { quizKeydown(e); return; }
  if (e.code === 'Space') { e.preventDefault(); if (settings.mode === 'piano') setSustain(true); return; }
  if (e.code === 'KeyZ') { shiftOctave(-1); return; }
  if (e.code === 'KeyX') { shiftOctave(1); return; }
  if (!(e.code in KEY_MAP) || keyNotes.has(e.code)) return;
  hideOverlay();
  const midi = 12 * (startOctave + 1) + KEY_MAP[e.code];
  keyNotes.set(e.code, midi);
  noteOn(midi);
  if (settings.mode === 'keyQuiz') answerKeyQuiz(midi);
  if (settings.mode === 'song') songJudgePress(midi, eventPerfTime(e));
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { setSustain(false); return; }
  if (!keyNotes.has(e.code)) return;
  const midi = keyNotes.get(e.code);
  keyNotes.delete(e.code);
  noteOff(midi, eventPerfTime(e));
});

// ===== 画面の大きさが変わったとき =====
// 画面の向き・サイズが変わったら鍵盤の数を計算し直す
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(refitKeyboard, 150);
});

// 使える広さが変わったとき：鍵盤の数・段数が変わるなら作り直し、変わらなければ高さだけ合わせる
function refitKeyboard() {
  if (settings.mode === 'nameQuiz') return;   // 音名当てクイズ中は鍵盤を出していない（戻ったときに作り直す）
  const oct = calcOctaves();
  if (oct !== octaves || calcRows(oct) !== rows) renderKeyboard();
  else sizeKeyboard();
}
