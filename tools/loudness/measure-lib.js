// 聴感を考えた音の大きさを測る道具（ページに読み込んで使う）
// 重み：小さなスピーカー（250Hzより下が出ない：4次ハイパス）× 人の耳の感度（ISO 226 の 60phon 等ラウドネス曲線のおおよその値）
(function () {
  const SR = 48000, N = 32768;
  const ISO60 = [[20,109.5],[25,104.2],[31.5,99.1],[40,94.2],[50,89.9],[63,85.6],[80,81.6],[100,78.1],[125,74.8],[160,71.9],[200,69.5],[250,67.3],[315,65.6],[400,64.0],[500,62.7],[630,61.7],[800,61.0],[1000,60.0],[1250,61.9],[1600,61.9],[2000,58.8],[2500,55.7],[3150,54.2],[4000,55.4],[5000,59.3],[6300,65.1],[8000,70.0],[10000,72.1],[12500,70.4],[16000,80]];
  function earDb(f) {
    if (f <= ISO60[0][0]) return 60 - ISO60[0][1];
    for (let i = 1; i < ISO60.length; i++) {
      if (f <= ISO60[i][0]) {
        const [f0, l0] = ISO60[i - 1], [f1, l1] = ISO60[i];
        const r = Math.log(f / f0) / Math.log(f1 / f0);
        return 60 - (l0 + (l1 - l0) * r);
      }
    }
    return -40;
  }
  const spk = (f) => { const x = (f / 250) ** 4; return x * x / (1 + x * x); };
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } } }
  }
  // midis を同時に鳴らし、{ level: 重みづけした大きさ dB, peak: 波形の最大値 } を返す
  // chain：'full'（アプリの出力の流れを通す）/ 'bypass'（通さない）
  window.measure = async function (tone, midis, chain) {
    const oc = new OfflineAudioContext(1, N, SR);
    ctx = oc;
    if (chain === 'full') {
      const o = buildOutput(oc);
      master = o.input;
      volumeNode = o.volume;
      applyVolume();
    } else {
      master = oc.createGain(); master.connect(oc.destination);
    }
    for (const m of midis) TONES[tone](midiToFreq(m), 0).out.connect(master);
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0; for (const x of d) peak = Math.max(peak, Math.abs(x));
    const re = Float64Array.from(d), im = new Float64Array(N);
    fft(re, im);
    let p = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * SR / N; p += (re[k] ** 2 + im[k] ** 2) * 10 ** (earDb(f) / 10) * spk(f); }
    return { level: 10 * Math.log10(p / N / N * 2), peak };
  };
})();
