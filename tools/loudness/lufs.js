// 開発用：ITU-R BS.1770 のラウドネス（LUFS。動画・音楽配信で使う物差し）を測る。アプリの出力の流れを通し、音量スライダー100
// 使い方：node tools/loudness/lufs.js
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('file://' + path.join(__dirname, '..', '..', 'index.html'));
  const r = await page.evaluate(async () => {
    const SR = 48000;
    function biquad(x, b, a) {
      const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) { const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
      return y;
    }
    function kweight(x) {
      const s1 = biquad(x, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
      return biquad(s1, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
    }
    // 左右に同じ音が出る（モノラル→ステレオ）ので、2チャンネル分として +3.01dB
    function loudness(d) {
      const k = kweight(d);
      const block = 0.4 * SR, hop = 0.1 * SR;
      const blocks = [];
      for (let s = 0; s + block <= k.length; s += hop) { let m = 0; for (let i = s; i < s + block; i++) m += k[i] * k[i]; blocks.push(2 * m / block); }
      const L = (z) => -0.691 + 10 * Math.log10(z);
      let g = blocks.filter((z) => L(z) > -70);
      const rel = L(g.reduce((a, b) => a + b, 0) / g.length) - 10;
      g = g.filter((z) => L(z) > rel);
      const integrated = L(g.reduce((a, b) => a + b, 0) / g.length);
      const momentaryMax = Math.max(...blocks.map(L));
      let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
      return { integrated, momentaryMax, peakDb: 20 * Math.log10(pk) };
    }
    async function render(seconds, play) {
      const oc = new OfflineAudioContext(1, Math.round(seconds * SR), SR);
      ctx = oc; const o = buildOutput(oc); master = o.input; volumeNode = o.volume;
      settings.volume = 100; settings.tone = 'piano'; applyVolume();
      play(oc);
      return (await oc.startRendering()).getChannelData(0);
    }
    const note = (m, t, dur) => { const v = TONES.piano(midiToFreq(m), t); v.out.connect(master); const end = t + dur; v.out.gain.setValueAtTime(1, end); v.out.gain.setTargetAtTime(0, end, v.release); };
    const out = {};
    // ド5を1回（2秒）
    out['ド5を1回弾いて2秒'] = loudness(await render(2, () => note(72, 0.01, 1.9)));
    // ド5を4分音符で連打（♩=100、8秒）
    out['ド5を連打（♩=100）'] = loudness(await render(8, () => { for (let i = 0; i < 13; i++) note(72, 0.01 + i * 0.6, 0.57); }));
    // きらきら星（両手、♩=100、最初の8小節）
    const song = getSong('twinkle');
    out['きらきら星（両手）'] = loudness(await render(19.5, () => { for (const ev of song.events) { if (ev.beat >= 32) continue; for (const m of ev.midis) note(m, 0.01 + ev.beat * 0.6, ev.dur * 0.6 - 0.03); } }));
    // 和音を鳴らし続ける（ド3+ミ3+ソ3+ド5+ミ5+ソ5 を1拍ごと）
    out['両手の和音を連打'] = loudness(await render(8, () => { for (let i = 0; i < 13; i++) for (const m of [48, 52, 55, 72, 76, 79]) note(m, 0.01 + i * 0.6, 0.57); }));
    const res = {};
    for (const [k, v] of Object.entries(out)) res[k] = { 'ラウドネス(LUFS)': v.integrated.toFixed(1), '瞬間最大(LUFS)': v.momentaryMax.toFixed(1), 'ピーク(dBFS)': v.peakDb.toFixed(1), 'ピーク−ラウドネス(dB)': (v.peakDb - v.integrated).toFixed(1) };
    return res;
  });
  console.table(r);
  await browser.close();
})();
