'use strict';
// 曲の練習の判定：タイミングの判定・音の長さの判定・タイミング調整

// ===== タイミングの判定（判定つき） =====
// 押した時刻は、イベントの timeStamp（押した瞬間）を「その瞬間にスピーカーから出ていた音の時刻」に直して、
// 予約した音の時刻と比べる。さらにタイミング調整で測った、この端末の遅れを差し引く
function audioTimeAt(perfMs) {
  if (ctx.getOutputTimestamp) {
    const ts = ctx.getOutputTimestamp();
    if (ts.performanceTime > 0 && ts.contextTime > 0) return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  const latency = ctx.outputLatency || ctx.baseLatency || 0;
  return ctx.currentTime - latency - (performance.now() - perfMs) / 1000;
}
// イベントの timeStamp が performance.now() と同じ基準でない環境に備える
function eventPerfTime(e) {
  const now = performance.now();
  const t = e && e.timeStamp;
  return t > 0 && t <= now + 5 && now - t < 1000 ? t : now;
}

// 判定の幅（秒）。速い曲で幅が音の間隔より広くならないよう、半拍を上限にする
function judgeWindows() {
  const half = 30 / player.tempo;
  const good = Math.min(0.2, half);
  const great = Math.min(0.12, good);
  return { good, great, perfect: Math.min(0.06, great) };
}
const JUDGE_NAMES = { perfect: 'パーフェクト', great: 'グレート', good: 'グッド', miss: 'ミス' };
const JUDGE_SCORE = { perfect: 100, great: 70, good: 40, miss: 0 };

// 通し番号 g の「弾くところ」。拍はくり返しの回数を足したもの。くり返さないときは区間の最後まで
function judgeStep(g) {
  const n = player.steps.length;
  if (!player.judge || !n || (!player.loop && g >= n)) return undefined;
  const s = player.steps[g % n];
  return { beat: s.beat + Math.floor(g / n) * player.len, midis: s.midis, durs: s.durs };
}
function judgeState(g) {
  if (!player.jstate.has(g)) player.jstate.set(g, { pressed: new Set(), missed: false });
  return player.jstate.get(g);
}
// まだ弾き終わっていない最初の音の、判定の幅の終わりの拍（ここで止まって待つ）
function judgeCapBeat() {
  const st = judgeStep(player.g);
  return st && st.beat + judgeWindows().good * player.tempo / 60;
}

// 25ミリ秒ごと：弾き終わった音を進め、判定の幅を過ぎても弾いていない音をミスにする
function judgeUpdate() {
  const nowT = audioTimeAt(performance.now()) - settings.timingOffset;
  for (let st = judgeStep(player.g); st; st = judgeStep(player.g)) {
    const state = judgeState(player.g);
    if (st.midis.every((m) => state.pressed.has(m))) { finishJudgeStep(); continue; }
    if (!state.missed && nowT > beatToTime(st.beat) + judgeWindows().good) {
      state.missed = true;
      for (const m of st.midis) if (!state.pressed.has(m)) addJudge('miss');
      showJudge('miss');
    }
    break;
  }
}

// いちばん前の「弾くところ」を弾き終えた。区間の最後なら、その回の成績をまとめる
function finishJudgeStep() {
  const g = player.g;
  player.jstate.delete(g);
  player.g++;
  if (g % player.steps.length === player.steps.length - 1) finishJudgePass();
}

function judgeAccuracy(c) {
  const total = c.perfect + c.great + c.good + c.miss;
  if (!total) return null;
  return Math.round((c.perfect * JUDGE_SCORE.perfect + c.great * JUDGE_SCORE.great + c.good * JUDGE_SCORE.good) / total);
}

// 区間を1回弾き終えた：その回の正確さを最高記録と比べて保存する
const SONG_RECORD_KEY = 'piano-practice:song-records';   // 曲・練習する手・区間ごとの最高の正確さ（％）
const songRecords = loadJSON(SONG_RECORD_KEY);
function songRecordKey() {
  const r = songRange(currentSong());
  return `${currentSong().id}:${settings.songHand}:${r.from}-${r.to}`;
}
function finishJudgePass() {
  const c = {};
  for (const k of Object.keys(player.counts)) c[k] = player.counts[k] - player.passStart[k];
  const acc = judgeAccuracy(c);
  player.passStart = { ...player.counts };
  if (acc === null) return;
  const key = songRecordKey();
  const best = songRecords[key];
  const newRecord = best === undefined || acc > best;
  if (newRecord) { songRecords[key] = acc; saveJSON(SONG_RECORD_KEY, songRecords); }
  player.lastPassAcc = acc;
  player.result = { ...c, acc, best, newRecord };
}

function addJudge(grade) {
  player.counts[grade]++;
}

// 判定の表示：いちばん新しい判定と、はやい・おそい
function showJudge(grade, delta) {
  const sub = grade === 'miss' || grade === 'perfect' || delta === undefined ? '' : delta < 0 ? 'はやい' : 'おそい';
  setJudgeText(JUDGE_NAMES[grade], 'j-' + grade, sub, true);
}
// pop：判定のたびに少し大きく出す（同じ判定が続いても、弾いたことがわかるように）
function setJudgeText(text, cls, sub = '', pop = false) {
  const el = document.getElementById('songJudge');
  const key = text + '|' + cls + '|' + sub;
  if (!pop && el.dataset.key === key) return;
  el.dataset.key = key;
  el.className = '';
  if (pop) void el.offsetWidth;   // アニメーションを最初からやり直す
  el.className = cls + (pop ? ' pop' : '');
  el.textContent = text;
  if (sub) {
    const span = document.createElement('span');
    span.className = 'sub';
    span.textContent = sub;
    el.appendChild(span);
  }
}

// ===== 音の長さの判定（判定つき） =====
// 押していた時間を、楽譜の長さ（秒）と比べる。タイミングの判定とは別に出し、正確さ（％）には入れない
// ピアノは音の長さの許容が広いので、ゆるめにする：
//   短め＝楽譜の長さの半分より短く、かつ0.1秒以上足りない
//   長め＝楽譜の長さの1.3倍より長く、かつ0.15秒以上はみ出す
// 長さは「押した瞬間と離した瞬間の差」なので、端末の遅れ（タイミング調整の値）は差し引かなくてよい
function lengthGrade(held, expected) {
  if (held < expected * 0.5 && expected - held > 0.1) return 'short';
  if (held > expected * 1.3 && held - expected > 0.15) return 'long';
  return 'just';
}
const LENGTH_NAMES = { just: 'ちょうど', short: '短め', long: '長め' };

function songLengthRelease(midi, perfMs) {
  if (!player.playing || !player.judge) return;
  const h = player.holding.get(midi);
  if (!h) return;
  player.holding.delete(midi);
  const grade = lengthGrade((perfMs - h.start) / 1000, h.expected);
  player.lengths[grade]++;
  setLengthText(`長さ ${LENGTH_NAMES[grade]}`, grade === 'just' ? 'len-just' : 'len-off', true);
}

function setLengthText(text, cls, pop = false) {
  const el = document.getElementById('songLength');
  el.className = '';
  if (pop) void el.offsetWidth;   // アニメーションを最初からやり直す
  el.className = cls + (pop ? ' pop' : '');
  el.textContent = text;
}

// 判定つきで鍵盤が押されたとき（指が触れた瞬間・PCのキーを押した瞬間だけ。指を滑らせて移った鍵盤は判定しない）
// いちばん近い時刻の「弾くところ」の音として判定する。どれにも当たらなければミス
function songJudgePress(midi, perfMs) {
  if (!player.playing || !player.judge || !ctx) return;
  judgeUpdate();
  const pressT = audioTimeAt(perfMs) - settings.timingOffset;
  const win = judgeWindows();
  const visible = new Set(visibleMidis());
  const matchOf = (st, state) => st.midis.find((m) =>
    !state.pressed.has(m) && (m === midi || (!visible.has(m) && m % 12 === midi % 12)));
  // 止まって待っているときは、待っている音だけを受け付ける（もうミスになっているので、弾いたら先へ進むだけ）
  const first = judgeStep(player.g);
  if (first && judgeState(player.g).missed) {
    const state = judgeState(player.g);
    const m = matchOf(first, state);
    if (m === undefined) { addJudge('miss'); showJudge('miss'); return; }
    state.pressed.add(m);
    if (first.midis.every((x) => state.pressed.has(x))) {
      // 止まっていたところから再開する
      const cap = judgeCapBeat();
      player.anchorBeat = Math.min(cap, timeToBeat(ctx.currentTime));
      player.anchorTime = ctx.currentTime;
      player.showAfter = performance.now() + 120;
      finishJudgeStep();
      schedule();
    }
    return;
  }
  let best = null;
  for (let g = player.g, st = judgeStep(g); st; st = judgeStep(++g)) {
    const t = beatToTime(st.beat);
    if (t - win.good > pressT) break;
    const state = judgeState(g);
    const m = matchOf(st, state);
    if (m === undefined) continue;
    const delta = pressT - t;
    if (Math.abs(delta) <= win.good && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { g, m, delta };
  }
  if (!best) { addJudge('miss'); showJudge('miss'); return; }
  const ad = Math.abs(best.delta);
  const grade = ad <= win.perfect ? 'perfect' : ad <= win.great ? 'great' : 'good';
  judgeState(best.g).pressed.add(best.m);
  addJudge(grade);
  showJudge(grade, best.delta);
  // 音の長さ：離したときに、押していた時間を楽譜の長さと比べる（ミスの音は判定しない）
  const st = judgeStep(best.g);
  player.holding.set(midi, { start: perfMs, expected: st.durs[st.midis.indexOf(best.m)] * 60 / player.tempo });
  player.showAfter = performance.now() + 120;
  judgeUpdate();
}

// ===== タイミング調整 =====
// 一定の間隔のクリック音に合わせてタップしてもらい、クリック音とのずれの中央値を、この端末の遅れとして保存する
// （画面に触れてから届くまでの遅れ、Bluetoothイヤホンなどで音が遅れて聞こえる分をまとめて測る）
const CALIB_TAPS = 8;          // 何回タップしてもらうか
const CALIB_INTERVAL = 0.6;    // クリックの間隔（秒）
const CALIB_CLICKS = 30;       // クリックの最大数（足りなければ測り直し）
const calib = { open: false, clicks: [], sounds: [], deltas: [], result: null, timer: null };
const calibOverlay = document.getElementById('calibOverlay');
const calibPad = document.getElementById('calibPad');

function calibText(offset) {
  const ms = Math.round(offset * 1000);
  if (ms === 0) return 'ずれ 0秒';
  return `ずれ ${(Math.abs(offset)).toFixed(2)}秒（${ms > 0 ? '遅め' : '早め'}）`;
}
function setCalibButtons(phase) {
  document.getElementById('calibSave').hidden = phase !== 'done';
  document.getElementById('calibRetry').hidden = phase === 'running';
  calibPad.disabled = phase !== 'running';
}

function openCalib() {
  stopPlayback();
  calib.open = true;
  calibOverlay.classList.remove('hidden');
  startCalib();
}
function startCalib() {
  initAudio();
  stopCalibSounds();
  calib.deltas = [];
  calib.result = null;
  const t0 = ctx.currentTime + 0.5;
  calib.clicks = [];
  for (let i = 0; i < CALIB_CLICKS; i++) {
    const t = t0 + i * CALIB_INTERVAL;
    calib.clicks.push(t);
    calib.sounds.push(makeClick(t, i % 4 === 0));
  }
  document.getElementById('calibText').textContent =
    `「プッ」という音に合わせて、下のボタンを${CALIB_TAPS}回タップしてください（PCはどのキーでも可）。音を聴きながら、いつも通りのタイミングで押すのがコツです`;
  document.getElementById('calibProgress').textContent = `0 / ${CALIB_TAPS}`;
  setCalibButtons('running');
  // クリックが終わっても足りなければ、測り直してもらう
  clearTimeout(calib.timer);
  calib.timer = setTimeout(() => {
    if (!calib.open || calib.result !== null) return;
    document.getElementById('calibText').textContent = 'うまく測れませんでした。「やり直す」を押して、音に合わせてタップしてください';
    setCalibButtons('failed');
  }, (t0 - ctx.currentTime + CALIB_CLICKS * CALIB_INTERVAL + 0.3) * 1000);
}
function stopCalibSounds() {
  if (ctx) {
    const now = ctx.currentTime;
    for (const v of calib.sounds) if (v.end > now) v.oscs.forEach((o) => { try { o.stop(now); } catch (e) {} });
  }
  calib.sounds = [];
}
function closeCalib() {
  calib.open = false;
  clearTimeout(calib.timer);
  stopCalibSounds();
  calibOverlay.classList.add('hidden');
  showSong();
}

// タップした時刻を、いちばん近いクリックと比べる。半間隔より離れたタップ（打ち間違い）は数えない
function calibTap(perfMs) {
  if (!calib.open || calib.result !== null || !ctx) return;
  const t = audioTimeAt(perfMs);
  let delta = Infinity;
  for (const c of calib.clicks) if (Math.abs(t - c) < Math.abs(delta)) delta = t - c;
  calibPad.classList.add('flash');
  setTimeout(() => calibPad.classList.remove('flash'), 90);
  if (Math.abs(delta) > CALIB_INTERVAL * 0.45) return;
  calib.deltas.push(delta);
  document.getElementById('calibProgress').textContent = `${calib.deltas.length} / ${CALIB_TAPS}`;
  if (calib.deltas.length < CALIB_TAPS) return;
  const sorted = [...calib.deltas].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  calib.result = (sorted[Math.floor(mid - 0.5)] + sorted[Math.ceil(mid - 0.5)]) / 2;
  const spread = sorted[sorted.length - 2] - sorted[1];   // いちばん外れた2つを除いたばらつき
  stopCalibSounds();
  document.getElementById('calibText').textContent =
    `測れました：${calibText(calib.result)}。判定のときにこの分を差し引きます` +
    (spread > 0.15 ? '（タップのばらつきが大きめでした。やり直すと正確になるかもしれません）' : '');
  setCalibButtons('done');
}
function calibKeydown(e) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Escape') { closeCalib(); return; }
  e.preventDefault();
  calibTap(eventPerfTime(e));
}

calibPad.addEventListener('pointerdown', (e) => { e.preventDefault(); calibTap(eventPerfTime(e)); });
document.getElementById('calibBtn').addEventListener('click', openCalib);
document.getElementById('calibRetry').addEventListener('click', startCalib);
document.getElementById('calibCancel').addEventListener('click', closeCalib);
document.getElementById('calibSave').addEventListener('click', () => {
  settings.timingOffset = Math.round(calib.result * 1000) / 1000;
  saveSettings();
  closeCalib();
});
