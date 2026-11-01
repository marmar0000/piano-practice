// 聴感補正の表を計算し、各音の聞こえる大きさを確かめる（開発用。アプリの動作には使わない）
// 使い方：node tools/loudness/check.js        … 出力の流れを通した各音の大きさ（ド5との差）を表示
//         node tools/loudness/check.js table  … 聴感補正の表（LOUDNESS_TABLE）の新しい値を計算して表示
// 必要なもの：Playwright（ヘッドレスのChromium）
const path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..', '..');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('エラー', e.message));
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.addScriptTag({ path: path.join(__dirname, 'measure-lib.js') });
  if (process.argv[2] === 'table') {
    // 聴感補正なし・コンプレッサーなしで測った大きさを、ド5にそろえる値（いまの表の値に差を足す）
    const res = await page.evaluate(async () => {
      const out = {};
      for (const tone of Object.keys(LOUDNESS_TABLE)) {
        const cur = LOUDNESS_TABLE[tone];
        const levels = [];
        for (let i = 0; i < cur.length; i++) levels.push((await measure(tone, [LOUDNESS_MIDI_START + 6 * i], 'bypass')).level);
        const target = levels[(72 - LOUDNESS_MIDI_START) / 6];
        out[tone] = levels.map((l, i) => Math.round(Math.min(15, Math.max(-6, cur[i] + target - l)) * 2) / 2);
      }
      return out;
    });
    for (const [k, v] of Object.entries(res)) console.log(`  ${k}: [${v.join(', ')}],`);
  } else {
    const res = await page.evaluate(async () => {
      const out = {};
      for (const tone of Object.keys(LOUDNESS_TABLE)) {
        const lv = [];
        for (const m of [24, 36, 48, 60, 72, 84, 96]) lv.push((await measure(tone, [m], 'full')).level);
        out[tone] = lv.map((x) => (x - lv[4]).toFixed(1).padStart(6)).join('');
      }
      return out;
    });
    console.log('ド5との差（dB）   ド1   ド2   ド3   ド4   ド5   ド6   ド7（音量スライダー70のとき）');
    for (const [k, v] of Object.entries(res)) console.log(k.padEnd(16), v);
  }
  await browser.close();
})();
