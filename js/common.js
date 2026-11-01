'use strict';
// 共通：設定の保存・読み込み、音名

// ===== 設定の保存・読み込み =====
const STORAGE_KEY = 'piano-practice:settings';
const settings = Object.assign({
  tone: 'piano',
  volume: 70,
  startOctave: null,   // null なら画面に合わせて自動
  labels: 'doremi',
  size: 'medium',
  rows: 'auto',        // auto: 縦向きで余裕があれば2段
  display: 'names',    // names / grand（大譜表）/ treble / bass
  mode: 'piano',       // piano（鍵盤ピアノ）/ nameQuiz（音名当てクイズ）/ keyQuiz（鍵盤の位置当てクイズ）
  quizClef: 'treble',  // treble / bass / both
  quizRange: 'staff',  // staff（加線なし）/ ledger1 / ledger2
  quizNames: 'doremi', // クイズの音名の表記：doremi / cde
  keyQuizKeys: 'white',  // 位置当てで出題する音：white（白鍵だけ）/ all（黒鍵も）
  keyQuizOctave: 'any',  // any（どのオクターブでも正解）/ exact（オクターブも当てる）
  songId: null,          // 曲の練習で選んでいる曲
  songTempos: {},        // 曲ごとに変えたテンポ（曲のid → ♩の数）
  songHand: 'both',      // 練習する手：both（両手＝お手本を聴く）/ right / left
  songAdvance: 'wait',   // 片手練習の進み方：wait（弾くまで待つ）/ tempo（テンポ通り）/ judge（判定つき）
  songOther: 'play',     // 片手練習のもう片方の手：play（自動で鳴らす）/ mute（鳴らさない）
  songRanges: {},        // 曲ごとの練習する区間（曲のid → { from, to }：小節の番号。全体なら記録しない）
  songLoop: false,       // 区間をくり返すか
  timingOffset: 0,       // タイミング調整：この端末で、押してから判定に届くまでの遅れ（秒）。判定のときに差し引く
  controlsOpen: null,    // 設定を開いているか（null なら画面の大きさで決める）
}, loadJSON(STORAGE_KEY));

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch (e) { return {}; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}
function saveSettings() { saveJSON(STORAGE_KEY, settings); }

// ===== 音名 =====
const NAMES_DOREMI = ['ド', 'ド♯', 'レ', 'レ♯', 'ミ', 'ファ', 'ファ♯', 'ソ', 'ソ♯', 'ラ', 'ラ♯', 'シ'];
const NAMES_CDE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK = [1, 3, 6, 8, 10];
const isBlack = (midi) => BLACK.includes(midi % 12);
const octaveOf = (midi) => Math.floor(midi / 12) - 1;
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const nameOf = (midi, style) => (style === 'cde' ? NAMES_CDE : NAMES_DOREMI)[midi % 12];
