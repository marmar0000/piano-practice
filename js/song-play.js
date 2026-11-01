'use strict';
// 曲の練習：曲データの読み取り・お手本再生＋光る鍵盤・片手ずつ練習・部分ループ・テンポ

const NOTE_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parseNote(text) {
  const m = /^([A-G])(#?)(\d)$/.exec(text);
  return m ? 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] ? 1 : 0) : null;
}

// 片手分の文字列を、音の並び { midis, beat（何拍目から）, dur（拍数）, hand } にする
function parsePart(song, hand) {
  const events = [];
  let beat = 0;
  let barStart = 0;
  let bar = 1;
  const warn = (msg) => console.warn(`曲データ「${song.title}」${hand === 'right' ? '右手' : '左手'} ${bar}小節目：${msg}`);
  const checkBar = () => {
    if (Math.abs(beat - barStart - song.beatsPerBar) > 1e-6) warn(`小節の長さが${beat - barStart}拍です`);
  };
  for (const tok of song[hand].trim().split(/\s+/)) {
    if (tok === '|') { checkBar(); barStart = beat; bar++; continue; }
    const [pitch, durText] = tok.split(':');
    const dur = Number(durText);
    if (!(dur > 0)) { warn(`「${tok}」の拍数が読めません`); continue; }
    if (pitch !== 'R') {
      const midis = pitch.split('+').map(parseNote);
      if (midis.includes(null)) warn(`「${tok}」の音名が読めません`);
      else events.push({ midis, beat, dur, hand });
    }
    beat += dur;
  }
  checkBar();
  return { events, beats: beat };
}

const parsedSongs = new Map();
function getSong(id) {
  const song = SONGS.find((s) => s.id === id) || SONGS[0];
  if (!parsedSongs.has(song.id)) {
    const r = parsePart(song, 'right');
    const l = parsePart(song, 'left');
    const totalBeats = Math.max(r.beats, l.beats);
    parsedSongs.set(song.id, {
      ...song,
      events: [...r.events, ...l.events].sort((a, b) => a.beat - b.beat),
      totalBeats,
      bars: Math.ceil(totalBeats / song.beatsPerBar - 1e-6),
    });
  }
  return parsedSongs.get(song.id);
}

const currentSong = () => getSong(settings.songId);
const songTempo = (song) => settings.songTempos[song.id] || song.tempo;

// 練習する区間（小節の番号）。保存した区間が曲の長さに合わなければ直す
function songRange(song) {
  const r = settings.songRanges[song.id] || {};
  const from = Math.min(song.bars, Math.max(1, r.from || 1));
  const to = Math.min(song.bars, Math.max(from, r.to || song.bars));
  return { from, to, whole: from === 1 && to === song.bars };
}

// 区間に入っている音と、区間の始まり・終わりの拍。区間の終わりをはみ出す音は、区間の終わりで切る
function rangeEvents(song, range = songRange(song)) {
  const start = (range.from - 1) * song.beatsPerBar;
  const end = Math.min(song.totalBeats, range.to * song.beatsPerBar);
  const events = song.events
    .filter((e) => e.beat >= start - 1e-6 && e.beat < end - 1e-6)
    .map((e) => (e.beat + e.dur > end ? { ...e, dur: end - e.beat } : e));
  return { start, end, events };
}

// 鍵盤の位置（下段の左端のオクターブ）を、曲の音がいちばん多く入る位置にする
// 2段のときは、右手の音は下段、左手の音は上段に入っている数で比べる
// 片手練習のときは、練習する手の音を優先する（10倍の重みで数える）。区間を決めているときは区間の音だけで数える
function fitOctaveForSong() {
  const events = rangeEvents(currentSong()).events;
  const practice = settings.songHand === 'both' ? null : settings.songHand;
  const inRange = (m, lowOct) => m >= 12 * (lowOct + 1) && m <= 12 * (lowOct + 1 + octaves);
  let best = null;
  let bestCount = -1;
  for (let o = 1; o <= 7; o++) {
    if (clampStart(o) !== o) continue;
    let count = 0;
    for (const ev of events) {
      for (const m of ev.midis) {
        const weight = practice && ev.hand === practice ? 10 : 1;
        if (rows === 2) count += inRange(m, ev.hand === 'right' ? o : o - octaves) ? weight : 0;
        else count += inRange(m, o) ? weight : 0;
      }
    }
    if (count > bestCount) { best = o; bestCount = count; }
  }
  return best ?? 4;
}

// ===== お手本再生＋光る鍵盤 =====
// 音は Web Audio API の時刻で少し先まで予約して鳴らす（タイマーのずれの影響を受けないように）
const SCHEDULE_AHEAD = 0.12;   // 何秒先まで予約するか
const player = {
  playing: false,
  song: null,
  tempo: 100,
  // 区間：曲全体か、指定した小節だけ。くり返すときは、拍を区間の長さ（len）ずつ足して数える
  //   （2回目の区間の始まり＝ start + len 拍目。音の拍＝曲の中の拍 + 何回目 × len）
  events: [],          // 区間に入っている音
  start: 0,            // 区間の始まりの拍
  end: 0,              // 区間の終わりの拍
  len: 0,
  loop: false,         // 区間をくり返すか
  whole: true,         // 曲全体か
  idx: 0,              // 次に予約する音の番号
  pass: 0,             // 次に予約する音が何回目の区間か（0から数える）
  anchorTime: 0,       // テンポの基準：この時刻に anchorBeat 拍目
  anchorBeat: 0,
  scheduled: [],       // 予約した音（停止したときに消すため）
  timer: null,
  raf: null,
  lastStatus: '',
  // 片手練習
  practice: null,      // 練習する手（right / left）。両手なら null
  wait: false,         // 弾くまで待つか
  muteOther: false,    // もう片方の手を鳴らさないか
  steps: [],           // 練習する手の「弾くところ」：{ beat, midis }（同じ拍の音はまとめる）
  stepIdx: 0,          // 次に弾くところの番号
  stepPass: 0,         // 次に弾くところが何回目の区間か
  passMissStart: 0,    // いまの回が始まったときのミスの数
  lastPassMisses: null,  // 前の回のミスの数
  pressed: new Set(),  // 次に弾くところのうち、もう押した音（和音は全部押したら進む）
  misses: 0,
  // 判定つき（タイミングを判定する）
  judge: false,
  g: 0,                // まだ終わっていない最初の「弾くところ」の通し番号（くり返しの回をまたいで数える）
  jstate: new Map(),   // 通し番号 → { pressed: Set（押した音）, missed: true（判定の幅を過ぎた）}
  counts: null,        // 今回の判定の数 { perfect, great, good, miss }
  passStart: null,     // いまの回が始まったときの counts
  lastPassAcc: null,   // 前の回の正確さ
  showAfter: 0,        // 次に弾く鍵盤を光らせ始める時刻（同じ鍵盤が続くときに光り直して見えるように）
  result: null,        // 最後の回の結果（止まったときに表示）
  // 音の長さの判定
  holding: new Map(),  // 押している鍵盤 → { start: 押した時刻（ミリ秒）, expected: 楽譜の長さ（秒）}
  lengths: null,       // 今回の音の長さの判定の数 { just, short, long }
};
const lit = new Map();   // 光らせている鍵盤：midi → 'right' / 'left'

const beatToTime = (beat) => player.anchorTime + (beat - player.anchorBeat) * 60 / player.tempo;
const timeToBeat = (time) => player.anchorBeat + (time - player.anchorTime) * player.tempo / 60;

// 次に弾くところ（拍はくり返しの回数を足したもの）。くり返すときは、区間の最後まで弾いたら最初に戻る
function currentStep() {
  if (!player.wait) return undefined;
  if (player.stepIdx >= player.steps.length && player.loop && player.steps.length) {
    player.stepIdx = 0;
    player.stepPass++;
    player.lastPassMisses = player.misses - player.passMissStart;
    player.passMissStart = player.misses;
  }
  const s = player.steps[player.stepIdx];
  return s && { beat: s.beat + player.stepPass * player.len, midis: s.midis };
}

// 次に予約する音の拍（くり返しの回数を足したもの）。もうなければ Infinity
function peekBeat() {
  if (player.idx >= player.events.length) {
    if (!player.loop || !player.events.length) return Infinity;
    player.idx = 0;
    player.pass++;
  }
  return player.events[player.idx].beat + player.pass * player.len;
}

// いまの拍。弾くまで待つときは次に弾くところで、判定つきのときはまだ弾いていない音の判定の幅の終わりで止まる
function playbackBeat(time) {
  const beat = timeToBeat(time);
  const cap = player.judge ? judgeCapBeat() : currentStep()?.beat;
  return cap !== undefined && beat > cap ? cap : beat;
}

// 練習する手の音を、同じ拍ごとにまとめる
function buildSteps(events, hand) {
  const steps = [];
  for (const ev of events) {
    if (ev.hand !== hand) continue;
    const last = steps[steps.length - 1];
    // durs：それぞれの音の長さ（拍）。音の長さの判定に使う
    if (last && Math.abs(last.beat - ev.beat) < 1e-6) {
      last.midis.push(...ev.midis);
      last.durs.push(...ev.midis.map(() => ev.dur));
    } else {
      steps.push({ beat: ev.beat, midis: [...ev.midis], durs: ev.midis.map(() => ev.dur) });
    }
  }
  return steps;
}

function startPlayback() {
  initAudio();
  const song = currentSong();
  const practice = settings.songHand === 'both' ? null : settings.songHand;
  const wait = !!practice && settings.songAdvance === 'wait';
  const judge = !!practice && settings.songAdvance === 'judge';
  const range = songRange(song);
  const { start, end, events } = rangeEvents(song, range);
  Object.assign(player, {
    playing: true,
    song,
    tempo: songTempo(song),
    events,
    start,
    end,
    len: end - start,
    loop: settings.songLoop,
    whole: range.whole,
    idx: 0,
    pass: 0,
    // 判定つきのときは、1小節分のカウントを入れてから始める
    anchorTime: ctx.currentTime + 0.15,
    anchorBeat: judge ? start - song.beatsPerBar : start,
    scheduled: [],
    practice,
    wait,
    judge,
    muteOther: !!practice && settings.songOther === 'mute',
    steps: wait || judge ? buildSteps(events, practice) : [],
    stepIdx: 0,
    stepPass: 0,
    passMissStart: 0,
    lastPassMisses: null,
    pressed: new Set(),
    misses: 0,
    g: 0,
    jstate: new Map(),
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    passStart: { perfect: 0, great: 0, good: 0, miss: 0 },
    lastPassAcc: null,
    showAfter: 0,
    result: null,
    counting: judge,
    holding: new Map(),
    lengths: { just: 0, short: 0, long: 0 },
  });
  if (judge) {
    for (let i = 0; i < song.beatsPerBar; i++) playClick(beatToTime(start - song.beatsPerBar + i), i === 0);
    setJudgeText('', '');
    setLengthText('', '');
  }
  playBtn.textContent = '■ 停止';
  playBtn.classList.add('playing');
  schedule();
  player.timer = setInterval(schedule, 25);
  player.raf = requestAnimationFrame(drawPlayback);
}

// finished：曲の最後まで行って止まったとき
function stopPlayback(finished = false) {
  if (!player.playing) return;
  // 最後まで弾いて止まったとき、まだ押している音は、いまの時点の長さで判定する（短めにはしない）
  if (finished && player.judge) {
    for (const [, h] of player.holding) {
      const grade = lengthGrade((performance.now() - h.start) / 1000, h.expected);
      player.lengths[grade === 'short' ? 'just' : grade]++;
    }
  }
  player.holding.clear();
  player.playing = false;
  clearInterval(player.timer);
  cancelAnimationFrame(player.raf);
  // 予約済みの音・鳴っている音をすぐに消す
  if (ctx) {
    const now = ctx.currentTime;
    for (const v of player.scheduled) {
      if (v.end <= now) continue;
      const g = v.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setTargetAtTime(0, now, 0.02);
      v.oscs.forEach((o) => stopOsc(o, now + 0.2));
    }
  }
  player.scheduled = [];
  setLit(new Map());
  playBtn.textContent = '▶ 再生';
  playBtn.classList.remove('playing');
  showSong();
  if (finished && player.wait) {
    setSongStatus(`${player.whole ? '最後まで' : '区間を'}弾けました！　ミス ${player.misses}回`);
  }
  if (finished && player.judge && player.result) {
    const r = player.result;
    setSongStatus(`パーフェクト ${r.perfect}　グレート ${r.great}　グッド ${r.good}　ミス ${r.miss}`);
    setJudgeText(`正確さ ${r.acc}%`, r.newRecord ? 'j-perfect' : '', r.newRecord ? '新記録！' : r.best !== undefined ? `最高 ${r.best}%` : '');
    const l = player.lengths;
    if (l.just + l.short + l.long) setLengthText(`音の長さ　ちょうど ${l.just}　短め ${l.short}　長め ${l.long}`, 'j-info');
  }
}

function schedule() {
  if (!player.playing || !ctx) return;
  const now = ctx.currentTime;
  // 弾くまで待つときは、次に弾くところより前の音だけ予約する（同じ拍の音は、弾いたときに鳴らす）
  // 判定つきのときは、まだ弾いていない音の判定の幅の終わりまでだけ予約する（大きく遅れたら止まって待つ）
  if (player.judge) judgeUpdate();
  const step = currentStep();
  const cap = player.judge ? judgeCapBeat() : undefined;
  const limit = step ? step.beat - 1e-6 : cap !== undefined ? cap : Infinity;
  for (let b = peekBeat(); b < limit && beatToTime(b) < now + SCHEDULE_AHEAD; b = peekBeat()) {
    const ev = player.events[player.idx++];
    // 練習する手の音は鳴らさない（自分で弾く）。もう片方を鳴らさない設定ならそれも鳴らさない
    if (ev.hand === player.practice || player.muteOther) continue;
    const t = Math.max(now, beatToTime(b));
    // 同じ音が続いても聞き分けられるよう、少しだけ短く鳴らす
    const dur = Math.max(0.05, ev.dur * 60 / player.tempo - 0.03);
    ev.midis.forEach((m) => playScheduled(m, t, dur));
  }
  player.scheduled = player.scheduled.filter((v) => v.end > now);
  // くり返さないときは、区間の終わりまで行ったら止める（くり返すときは停止ボタンで止める）
  if (!player.loop && peekBeat() === Infinity && !step && !judgeStep(player.g) &&
      now > beatToTime(player.end) + 0.3) stopPlayback(true);
}

function playScheduled(midi, t, dur) {
  const v = TONES[settings.tone](midiToFreq(midi), t);
  v.out.connect(master);
  const end = t + dur;
  v.out.gain.setValueAtTime(1, end);
  v.out.gain.setTargetAtTime(0, end, v.release);
  const stopAt = Math.min(end + v.release * 8, t + v.maxDur);
  v.oscs.forEach((o) => stopOsc(o, stopAt));
  v.oscs[0].onended = () => v.out.disconnect();
  player.scheduled.push({ out: v.out, oscs: v.oscs, end: stopAt });
}

// カウント・タイミング調整のクリック音（短い「プッ」）。accent：1拍目は高めの音
function makeClick(t, accent) {
  const o = osc('sine', accent ? 1760 : 1320, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  o.connect(g);
  g.connect(master);
  o.stop(t + 0.07);
  o.onended = () => g.disconnect();
  return { out: g, oscs: [o], end: t + 0.07 };
}
function playClick(t, accent) {
  player.scheduled.push(makeClick(t, accent));
}

// ===== 曲の練習の画面（弾くまで待つ練習・光る鍵盤・停止中の表示・曲の選択） =====
// 曲の練習中に鍵盤が押されたとき（弾くまで待つ練習の判定）
// 光っている鍵盤と同じ音なら正解。その鍵盤が画面に入っていないときは、同じ音名の鍵盤でも正解にする
function songNoteOn(midi) {
  const step = currentStep();
  if (!player.playing || !step || !ctx) return;
  const visible = new Set(visibleMidis());
  const match = step.midis.find((m) => m === midi || (!visible.has(m) && m % 12 === midi % 12));
  if (match === undefined) {
    if (!step.midis.some((m) => player.pressed.has(m) && m % 12 === midi % 12)) player.misses++;
    return;
  }
  player.pressed.add(match);
  if (!step.midis.every((m) => player.pressed.has(m))) return;
  // 全部押せたので次へ。早めに弾いたときは、その位置まで進める（間の伴奏は飛ばす）
  while (peekBeat() < step.beat - 1e-6) player.idx++;
  player.anchorBeat = step.beat;
  player.anchorTime = ctx.currentTime;
  player.stepIdx++;
  player.pressed.clear();
  schedule();   // 同じ拍のもう片方の手の音を、すぐ鳴らす
}

// 画面の更新：いま鳴っている音の鍵盤を光らせ、小節を表示する
function drawPlayback() {
  if (!player.playing) return;
  // スピーカーから実際に音が出るまでの遅れの分だけ、表示を遅らせる
  const latency = ctx.outputLatency || ctx.baseLatency || 0;
  const vbeat = playbackBeat(ctx.currentTime - latency);
  // 何回目の区間か（0から）と、曲の中の拍
  const pass = player.loop ? Math.max(0, Math.floor((vbeat - player.start) / player.len + 1e-6)) : 0;
  const beat = vbeat - pass * player.len;
  const step = currentStep();
  const next = new Map();
  for (const ev of player.events) {
    if (ev.beat > beat) break;
    if ((player.wait || player.judge) && ev.hand === player.practice) continue;   // 練習する手は「次に弾く鍵盤」として下で光らせる
    if (step && ev.beat + pass * player.len >= step.beat - 1e-6) continue;   // 次に弾くところと同じ拍の音は、弾いてから鳴るので、まだ光らせない
    // 同じ音が続くときに光り直して見えるよう、音の長さの9割だけ光らせる
    if (beat < ev.beat + ev.dur * 0.9) {
      for (const m of ev.midis) if (next.get(m) !== 'right') next.set(m, ev.hand);
    }
  }
  // 弾くまで待つ：次に弾く鍵盤（まだ押していない音）を光らせる。練習する手の色を優先
  if (step) for (const m of step.midis) if (!player.pressed.has(m)) next.set(m, player.practice);
  // 判定つき：次に弾く鍵盤（まだ押していない音）を光らせる。弾いた直後は少しだけ消して、同じ鍵盤が続いてもわかるようにする
  const jst = judgeStep(player.g);
  if (jst && performance.now() >= player.showAfter) {
    const state = judgeState(player.g);
    for (const m of jst.midis) if (!state.pressed.has(m)) next.set(m, player.practice);
  }
  setLit(next);
  const song = player.song;
  const firstBar = player.start / song.beatsPerBar + 1;
  const lastBar = Math.ceil(player.end / song.beatsPerBar - 1e-6);
  const bar = Math.min(lastBar, Math.max(firstBar, Math.floor(beat / song.beatsPerBar + 1e-6) + 1));
  // 判定つきは正確さを出すので、横に長くならないようテンポは出さない（テンポは操作パネルに出ている）
  let text = `${bar} / ${song.bars} 小節` + (player.judge ? '' : `　♩=${player.tempo}`);
  if (player.loop) {
    // くり返すときは、何回目かと、この回のミス（弾くまで待つとき）を出す
    text += `　${(player.wait ? player.stepPass : pass) + 1}回目`;
    if (player.wait) {
      text += `　ミス ${player.misses - player.passMissStart}`;
      if (player.lastPassMisses !== null) text += `（前回 ${player.lastPassMisses}）`;
    }
  } else if (player.wait) {
    text += `　ミス ${player.misses}`;
  }
  if (player.judge) {
    // 正確さ：くり返すときはこの回の分と、前の回の分
    const c = {};
    for (const k of Object.keys(player.counts)) c[k] = player.counts[k] - (player.loop ? player.passStart[k] : 0);
    const acc = judgeAccuracy(c);
    if (acc !== null) text += `　正確さ ${acc}%`;
    if (player.loop && player.lastPassAcc !== null) text += `（前回 ${player.lastPassAcc}%）`;
  }
  if (player.judge) {
    // カウント中は「1・2・3・4」を出す（まだ何も判定していないときだけ）
    if (player.counting) {
      const countStart = player.start - song.beatsPerBar;
      const judged = judgeAccuracy(player.counts) !== null;
      if (vbeat >= player.start || judged) {
        player.counting = false;
        if (!judged) setJudgeText('', '');
      } else {
        setJudgeText(vbeat < countStart ? '' : `カウント ${Math.floor(vbeat - countStart) + 1}`, 'j-info');
      }
    }
  }
  setSongStatus(text);
  player.raf = requestAnimationFrame(drawPlayback);
}

function setLit(next) {
  const apply = (m, hand) => {
    keyboardEl.querySelectorAll('[data-midi="' + m + '"]').forEach((el) => {
      el.classList.toggle('demo-right', hand === 'right');
      el.classList.toggle('demo-left', hand === 'left');
    });
  };
  for (const m of lit.keys()) if (!next.has(m)) apply(m, null);
  for (const [m, hand] of next) if (lit.get(m) !== hand) apply(m, hand);
  lit.clear();
  for (const [m, hand] of next) lit.set(m, hand);
}

function setSongStatus(text) {
  if (text === player.lastStatus) return;
  player.lastStatus = text;
  document.getElementById('songStatus').textContent = text;
}

// 停止中の表示：曲名・小節数・テンポ。鍵盤に入りきらない音があれば知らせる
function showSong() {
  const song = currentSong();
  document.getElementById('songTitle').textContent = song.title;
  songSelect.value = song.id;
  tempoInput.value = songTempo(song);
  document.getElementById('tempoLabel').textContent = '♩=' + songTempo(song);
  const hand = settings.songHand;
  const range = songRange(song);
  showRange(song, range);
  const keys = new Set(visibleMidis());
  const outside = keys.size > 0 && rangeEvents(song, range).events.some((e) =>
    (hand === 'both' || e.hand === hand) && e.midis.some((m) => !keys.has(m)));
  const bars = range.whole ? `全${song.bars}小節` : `${range.from}〜${range.to}小節（全${song.bars}小節）`;
  setSongStatus(`${bars}　♩=${songTempo(song)}` + (outside ? '　※鍵盤に入りきらない音があります' : ''));
  handSelect.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.hand === hand));
  document.getElementById('songHint').textContent = songHintText();
  // 判定つきのときだけ判定の行を出す。止まっているときは最高記録を出す
  const judge = hand !== 'both' && settings.songAdvance === 'judge';
  const judgeEl = document.getElementById('songJudge');
  // 判定つきのときは、色の見本（右手・左手）の代わりに音の長さの判定の行を出す（スマホ横向きで高さが増えないように）
  document.getElementById('songLength').hidden = !judge;
  document.querySelector('.song-legend').hidden = judge;
  if (judge === judgeEl.hasAttribute('data-off')) {
    judgeEl.toggleAttribute('data-off', !judge);
    requestAnimationFrame(refitKeyboard);   // 表示エリアの高さが変わるので、鍵盤の大きさを合わせ直す
  }
  if (judge) {
    const best = songRecords[songRecordKey()];
    setJudgeText(best !== undefined ? `最高記録 ${best}%` : '記録なし', 'j-info');
    setLengthText('音の長さも判定します', 'j-info');
  }
  document.getElementById('calibLabel').textContent = calibText(settings.timingOffset);
}

function songHintText() {
  const hand = settings.songHand;
  if (hand === 'both') return 'お手本を聴く：鳴っている音の鍵盤が光ります';
  const name = hand === 'right' ? '右手' : '左手';
  const other = settings.songOther === 'play' ? '（もう片方の手は自動で鳴ります）' : '';
  if (settings.songAdvance === 'wait') {
    return `${name}を練習：光った鍵盤を弾くと進みます${other}`;
  }
  if (settings.songAdvance === 'judge') {
    return `${name}を練習：光った鍵盤をテンポに合わせて弾くと判定します${other}`;
  }
  return `${name}を練習：光る鍵盤に合わせて弾いてください${other}`;
}

const songSelect = document.getElementById('songSelect');
const tempoInput = document.getElementById('tempoInput');
const playBtn = document.getElementById('playBtn');
const handSelect = document.getElementById('handSelect');
for (const song of SONGS) {
  const opt = document.createElement('option');
  opt.value = song.id;
  opt.textContent = song.title;
  songSelect.appendChild(opt);
}

songSelect.addEventListener('change', () => {
  stopPlayback();
  settings.songId = songSelect.value;
  saveSettings();
  songOctave = null;
  renderKeyboard();
  showSong();
  songSelect.blur();
});

handSelect.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.dataset.hand === settings.songHand) return;
  stopPlayback();
  settings.songHand = btn.dataset.hand;
  saveSettings();
  songOctave = null;
  applyMode();   // 片手練習用の項目の表示と、鍵盤の位置を合わせ直す
});

for (const [id, prop] of [['songAdvanceSelect', 'songAdvance'], ['songOtherSelect', 'songOther']]) {
  const sel = document.getElementById(id);
  sel.value = settings[prop];
  sel.addEventListener('change', () => {
    stopPlayback();
    settings[prop] = sel.value;
    saveSettings();
    updateVisibility();   // タイミング調整の項目を出す・隠す
    showSong();
    refitKeyboard();
    sel.blur();
  });
}

playBtn.addEventListener('click', () => {
  if (player.playing) stopPlayback();
  else startPlayback();
});

// ===== 部分ループ（区間を決めてくり返す） =====
const loopFrom = document.getElementById('loopFrom');
const loopTo = document.getElementById('loopTo');
const loopBtn = document.getElementById('loopBtn');

// 区間の選択欄とくり返しボタンを、いまの曲・設定に合わせる
function showRange(song, range) {
  for (const sel of [loopFrom, loopTo]) {
    if (sel.options.length !== song.bars) {
      sel.innerHTML = '';
      for (let i = 1; i <= song.bars; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        sel.appendChild(opt);
      }
    }
  }
  loopFrom.value = range.from;
  loopTo.value = range.to;
  loopBtn.textContent = 'くり返し：' + (settings.songLoop ? 'オン' : 'オフ');
  loopBtn.classList.toggle('on', settings.songLoop);
  loopBtn.setAttribute('aria-pressed', String(settings.songLoop));
}

// 区間を変えたら再生を止め、区間の音に合わせて鍵盤の位置を決め直す
// 始まりを終わりより後にしたら終わりを、終わりを始まりより前にしたら始まりを合わせる
function changeRange(changed) {
  stopPlayback();
  const song = currentSong();
  let from = Number(loopFrom.value);
  let to = Number(loopTo.value);
  if (from > to) { if (changed === loopFrom) to = from; else from = to; }
  if (from === 1 && to === song.bars) delete settings.songRanges[song.id];
  else settings.songRanges[song.id] = { from, to };
  saveSettings();
  songOctave = null;
  renderKeyboard();   // この中で停止中の表示も直す
  changed.blur();
}
loopFrom.addEventListener('change', () => changeRange(loopFrom));
loopTo.addEventListener('change', () => changeRange(loopTo));

loopBtn.addEventListener('click', () => {
  stopPlayback();
  settings.songLoop = !settings.songLoop;
  saveSettings();
  showSong();
});

// テンポは再生中でも変えられる（いまの位置を基準にして、そこから先の速さを変える）
tempoInput.addEventListener('input', () => {
  const song = currentSong();
  const tempo = Number(tempoInput.value);
  if (tempo === song.tempo) delete settings.songTempos[song.id];
  else settings.songTempos[song.id] = tempo;
  saveSettings();
  document.getElementById('tempoLabel').textContent = '♩=' + tempo;
  if (player.playing && ctx) {
    const now = ctx.currentTime;
    player.anchorBeat = timeToBeat(now);
    player.anchorTime = now;
    player.tempo = tempo;
  } else {
    showSong();
  }
});
