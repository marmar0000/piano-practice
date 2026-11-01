'use strict';
// 音の再生（Web Audio API）：音色の合成・聴感補正・音が止まったときの作り直し

// ===== 音の再生（Web Audio API） =====
let ctx = null;
let master = null;          // 各音をまとめる入口
let volumeNode = null;      // 音量スライダーの値をかける場所
let audioStarted = false;   // 開始画面をタップしたか
let audioStale = false;     // 再開できなかったので作り直しが必要か

function createAudio() {
  // iOSで消音スイッチがオンでも鳴らせるよう試みる（対応環境のみ）
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  const c = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  ({ input: master, volume: volumeNode } = buildOutput(c));
  c.onstatechange = () => { if (c === ctx) watchAudioState(); };
  ctx = c;
  audioStale = false;
  applyVolume();
}

// 出力の流れ：各音 → 入口で小さくする → コンプレッサー（和音で大きくなりすぎないように）→ 音量 → ソフトクリップ（音割れ防止）→ スピーカー
// 音量をコンプレッサーの後ろでかけるので、スライダーを上げた分だけそのまま大きくなる
// 入口で小さくしてからコンプレッサーに入れるので、1つの音だけならほぼ押さえ込まれず（聴感補正がそのまま効く）、
// 和音などで音が重なったときだけ押さえ込まれる。小さくした分は音量（OUTPUT_MAKEUP）で戻す
const OUTPUT_INPUT_GAIN = 0.3;
const OUTPUT_MAKEUP = 2.5;
function buildOutput(c) {
  const input = c.createGain();
  input.gain.value = OUTPUT_INPUT_GAIN;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -8;
  comp.knee.value = 4;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.25;
  const volume = c.createGain();
  // 0.8を超えたところから、なめらかに1.0へ近づける（急に音が割れないように）
  const pre = c.createGain();
  pre.gain.value = 0.5;
  const shaper = c.createWaveShaper();
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1) * 2 - 1) * 2;
    const a = Math.abs(x);
    curve[i] = a < 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  // 最後の守り（リミッター）：音量を上げて和音を弾いたときなどに、ソフトクリップに入る前に音量を素早く押さえる
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  input.connect(comp).connect(volume).connect(limiter).connect(pre).connect(shaper).connect(c.destination);
  return { input, volume };
}

function resetAudio() {
  if (player.playing) stopPlayback();
  const old = ctx;
  ctx = null;
  master = null;
  volumeNode = null;
  voices.clear();
  try { old.close(); } catch (e) {}
}

// タップなどの操作の中で呼ぶ。止まっていたら再開し、再開できない状態なら作り直す
function initAudio() {
  // iOSではアプリ切り替えなどで「中断（interrupted）」になり、resume() では戻らないことがある
  if (ctx && (audioStale || ctx.state === 'closed' || ctx.state === 'interrupted')) resetAudio();
  if (!ctx) createAudio();
  if (ctx.state === 'running') return;
  ctx.resume().catch(() => {});
  playSilence();
  const c = ctx;
  setTimeout(() => {
    if (c === ctx && c.state !== 'running') {
      audioStale = true;
      showOverlay(true);
    }
  }, 600);
}

// iOSで音の出力を確実に始めるため、無音を一瞬再生する
function playSilence() {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
}

// 使っている途中で音が止まったら、再開用の画面を出す
function watchAudioState() {
  if (!audioStarted || document.hidden || ctx.state === 'running') return;
  const c = ctx;
  setTimeout(() => {
    if (c === ctx && c.state !== 'running' && !document.hidden) showOverlay(true);
  }, 400);
}

function applyVolume() {
  if (!volumeNode) return;
  const v = settings.volume / 100;
  volumeNode.gain.setTargetAtTime(OUTPUT_MAKEUP * 1.6 * Math.pow(v, 1.5), ctx.currentTime, 0.02);
}

// 止める時刻を決める。早めに止めると決めてある発振器（stopLimit）は、それより遅くしない
function stopOsc(o, time) {
  try { o.stop(Math.min(time, o.stopLimit ?? Infinity)); } catch (e) {}
}

function osc(type, freq, t) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  return o;
}

// ===== 聴感補正（どの高さの音も同じくらいの大きさに聞こえるように） =====
// 人の耳は低い音ほど感じにくく、iPad・スマホの小さなスピーカーは低い音（おおよそ250Hzより下）がほとんど出ない。
// そのため、同じ強さで鳴らしても低い音ほど小さく聞こえる。次の3つで補う：
//  1. 低い音は倍音を増やす（スピーカーで出やすい高さの倍音で、音の高さと大きさが伝わるように）
//  2. スピーカーから出ない低い成分（250Hzより下）を弱める（聞こえないのに音量の余裕を使い、音割れの元になるため）
//  3. 倍音の鳴り始めを少しずつずらし（位相をずらす）、波形のとがり（ピーク）を小さくする
//     → 同じ大きさに聞こえる音でも、音割れ防止の仕組み（コンプレッサー）に押さえ込まれにくくなる
//  4. 音色ごとの「聴感補正の表」で、音の高さに応じて音量を上げ下げする
//     表は、耳の感度（ISO 226 の等ラウドネス曲線・60phon）と小さなスピーカーの特性で重みづけして
//     各音の大きさを測り、ド5と同じ大きさに聞こえるように決めた値（dB）。docs/technical-notes.md に測り方を書いている
const LOUDNESS_MIDI_START = 24;   // 表の最初の音（ド1）。そこから半オクターブ（6半音）ごと
const LOUDNESS_TABLE = {
  piano: [15, 11.5, 7, 5.5, 5.5, 5.5, 5, 1.5, 0, -1, -2, -2, -2.5],
  epiano: [15, 15, 11.5, 8.5, 6.5, 6, 5.5, 1.5, 0, -0.5, -2, -2.5, -2.5],
  organ: [15, 15, 12, 9, 7, 5.5, 4.5, 1.5, 0, -1, -2.5, -3, -3.5],
  synth: [15, 12.5, 11, 9.5, 7.5, 6, 4.5, 1.5, 0, -1, -2.5, -2, -2.5],
};
const freqToMidi = (freq) => 69 + 12 * Math.log2(freq / 440);
function loudnessGain(tone, freq) {
  const table = LOUDNESS_TABLE[tone];
  const x = Math.min(table.length - 1, Math.max(0, (freqToMidi(freq) - LOUDNESS_MIDI_START) / 6));
  const i = Math.min(table.length - 2, Math.floor(x));
  const db = table[i] + (table[i + 1] - table[i]) * (x - i);
  return Math.pow(10, db / 20);
}
// ド4より下で、どれだけ低いか（0：ド4以上 〜 1：ド2以下）。倍音の増やし方に使う
function lowness(freq) {
  return Math.min(1, Math.max(0, Math.log2(261.6 / freq) / 2));
}
// 1つの音の出口：聴感補正の音量 →（低い音だけ）低すぎる成分を弱めるフィルター → out（鳴らし始め・止める音量）
// 音色の合成はここで返すノードにつなぐ
function voiceBus(tone, freq, out) {
  const g = ctx.createGain();
  g.gain.value = loudnessGain(tone, freq);
  if (freq < 300) {
    // 250Hzより下を12dB弱め（ヘッドホンで聞いても薄くなりすぎないよう、ゼロにはしない）、80Hzより下は切る
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'lowshelf';
    shelf.frequency.value = 250;
    shelf.gain.value = -12;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 80;
    hp.Q.value = 0.7;
    g.connect(shelf).connect(hp).connect(out);
  } else {
    g.connect(out);
  }
  return g;
}

// 倍音 n（1から）の鳴り始めを、位相がずれるだけ遅らせる時間（秒）。
// シュレーダー位相（n² に比例）を使うと、倍音を重ねても波形のピークが大きくなりにくい
function partialDelay(n, count, f) {
  const phase = Math.PI * n * n / count;   // ラジアン
  return (phase % (2 * Math.PI)) / (2 * Math.PI * f);
}

// 音色ごとの合成。戻り値: { out: GainNode, oscs: [...], release: 秒 }
const PIANO_PARTIALS = [1, 0.55, 0.3, 0.16, 0.09, 0.05, 0, 0, 0, 0, 0, 0];
// 低い音用：倍音を多めにする（本物のピアノの低音も倍音が多い）
const PIANO_PARTIALS_LOW = [1, 0.8, 0.65, 0.55, 0.45, 0.38, 0.32, 0.26, 0.21, 0.17, 0.13, 0.1];
const TONES = {
  piano(freq, t) {
    const out = ctx.createGain();
    const bus = voiceBus('piano', freq, out);
    const decay = Math.min(6, Math.max(0.7, 3.2 * Math.sqrt(261.6 / freq)));
    const low = lowness(freq);
    const oscs = [];
    const count = PIANO_PARTIALS.length;
    for (let i = 0; i < count; i++) {
      const n = i + 1;
      const amp = PIANO_PARTIALS[i] + (PIANO_PARTIALS_LOW[i] - PIANO_PARTIALS[i]) * low;
      if (amp < 0.01) continue;
      // 本物のピアノのように高い倍音ほど少し高くずらす（インハーモニシティ）のは第3倍音まで。
      // 第4倍音より上は第3倍音と同じ割合でずらしてそろえ、ずらした位相が崩れないようにする
      // （全部をずらすと位相がばらばらになって波形のピークが大きくなり、同じ大きさに聞こえる音でも音量の余裕を使ってしまう）
      const f = freq * n * (1 + 0.0004 * Math.min(n, 3) ** 2);
      if (f > 12000) break;
      const o = osc('sine', f, t + (n > 1 ? partialDelay(n, count, f) : 0));
      const g = ctx.createGain();
      const tau = decay / Math.pow(n, 0.7);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.22, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, tau);
      o.connect(g).connect(bus);
      // 高い倍音は早く消えるので、聞こえなくなったら止める（低い音で倍音が多いぶんの負担を減らす）
      if (n > 1) { o.stopLimit = t + 0.004 + tau * 7; o.stop(o.stopLimit); }
      oscs.push(o);
    }
    return { out, oscs, release: 0.07, maxDur: decay * 5 };
  },
  epiano(freq, t) {
    const out = ctx.createGain();
    const bus = voiceBus('epiano', freq, out);
    const decay = Math.min(4, Math.max(0.6, 2.2 * Math.sqrt(261.6 / freq)));
    const carrier = osc('sine', freq, t);
    const mod = osc('sine', freq, t);
    const modGain = ctx.createGain();
    // 低い音は変調を強めに残して倍音を増やす
    const low = lowness(freq);
    // （エレピの波形はピークが一定なので、倍音を増やしても音割れしにくい）
    modGain.gain.setValueAtTime(freq * (2.2 + 2.5 * low), t);
    modGain.gain.setTargetAtTime(freq * (0.25 + 3.5 * low), t, 0.25);
    mod.connect(modGain).connect(carrier.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.3, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.003, decay);
    carrier.connect(amp).connect(bus);
    return { out, oscs: [carrier, mod], release: 0.15, maxDur: decay * 5 };
  },
  organ(freq, t) {
    const out = ctx.createGain();
    const bus = voiceBus('organ', freq, out);
    // [倍率, 強さ, 低い音で足す強さ]
    const bars = [[0.5, 0.25, -0.25], [1, 0.5, 0], [2, 0.35, 0.1], [3, 0.2, 0.15], [4, 0.15, 0.15], [5, 0, 0.12], [6, 0.08, 0.1], [8, 0.06, 0.08]];
    const sum = ctx.createGain();
    sum.gain.setValueAtTime(0, t);
    sum.gain.linearRampToValueAtTime(0.3, t + 0.012);
    const low = lowness(freq);
    const oscs = [];
    for (const [n, amp, lowAdd] of bars) {
      const a = amp + lowAdd * low;   // 低い音では、1オクターブ下の音を弱め（スピーカーから出ない）、高い段を強める
      if (freq * n > 12000 || a < 0.01) continue;
      const o = osc('sine', freq * n, t + (n > 1 ? partialDelay(n, bars.length, freq * n) : 0));
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(sum);
      oscs.push(o);
    }
    sum.connect(bus);
    return { out, oscs, release: 0.05, maxDur: Infinity };
  },
  synth(freq, t) {
    const out = ctx.createGain();
    const bus = voiceBus('synth', freq, out);
    const o1 = osc('sawtooth', freq, t);
    const o2 = osc('sawtooth', freq, t);
    o2.detune.setValueAtTime(8, t);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(Math.min(16000, freq * 10), t);
    // 低い音でもこもりすぎないよう、フィルターは900Hzより下げない
    filter.frequency.setTargetAtTime(Math.min(16000, Math.max(900, freq * 3)), t, 0.2);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.22, t + 0.01);
    amp.gain.setTargetAtTime(0.145, t + 0.01, 0.3);
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(amp).connect(bus);
    return { out, oscs: [o1, o2], release: 0.12, maxDur: Infinity };
  },
};

const voices = new Map();   // midi -> 鳴っている音

function startVoice(midi) {
  initAudio();
  stopVoice(midi, 0.015);
  const t = ctx.currentTime;
  const v = TONES[settings.tone](midiToFreq(midi), t);
  v.out.connect(master);
  if (isFinite(v.maxDur)) v.oscs.forEach((o) => stopOsc(o, t + v.maxDur));
  v.oscs[0].onended = () => {
    v.out.disconnect();
    if (voices.get(midi) === v) voices.delete(midi);
  };
  voices.set(midi, v);
}

function stopVoice(midi, releaseTime) {
  const v = voices.get(midi);
  if (!v) return;
  voices.delete(midi);
  const t = ctx.currentTime;
  const r = releaseTime ?? v.release;
  const g = v.out.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
  g.setTargetAtTime(0, t, r);
  v.oscs.forEach((o) => stopOsc(o, t + r * 8));
}
