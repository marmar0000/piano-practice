'use strict';
// 五線譜の描画（SVG）

// ===== 五線譜の描画（SVG） =====
// 単位：S = 線と線の間隔。記号は外部フォントを使わずパスで描く（端末によって形が変わらないように）
const S = 10;
const STEP_OF_PC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];   // ♯で表記
const diatonic = (m) => octaveOf(m) * 7 + STEP_OF_PC[m % 12];
const CLEFS = {
  treble: { bottomDi: 30 },   // 第1線＝ミ（E4）
  bass: { bottomDi: 18 },     // 第1線＝ソ（G2）
};
const STAFF_W = 18 * S;
const NOTE_X = 10.5 * S;
const INK = '#222';
const PAPER = '#fbfaf5';
// ト音記号・ヘ音記号（第5線をy=0、第4線をy=1…とする、線間隔1の座標）
const TREBLE_PATH = 'M0.3 3.55C-0.45 3.6-0.6 2.55 0.1 2.4C0.95 2.2 1.35 3.25 0.85 3.85C0.3 4.5-0.95 4.35-1.1 3.35C-1.25 2.3-0.15 1.65 0.45 0.75C0.95 0-0.6 -1.6 0.35 -1.6C0.85 -1.6 0.75 -0.55-0.05 0.35L0.4 5.15C0.5 5.85-0.15 6.1-0.5 5.8';
const BASS_PATH = 'M-0.55 1C-0.6 0.1 1.25 -0.3 1.25 1.15C1.25 2.4 0.2 3.4-0.9 3.95';

// mode: grand（大譜表）/ treble / bass
// opts.dim: 音符を薄く表示する / opts.color: 音符の色 / opts.minY・maxY: 表示範囲の最小値（音符によって広げる）
function renderStaff(svg, midis, mode, opts = {}) {
  const staves = mode === 'grand'
    ? [{ clef: 'treble', top: 0 }, { clef: 'bass', top: 10 * S }]
    : [{ clef: mode, top: 0 }];
  const noteInk = opts.color || INK;
  let minY = Math.min(-3.5 * S, opts.minY ?? 0);
  let maxY = Math.max(staves[staves.length - 1].top + 7.5 * S, opts.maxY ?? 0);
  let body = '';

  for (const st of staves) {
    const bottomDi = CLEFS[st.clef].bottomDi;
    const yOf = (di) => st.top + 4 * S - (di - bottomDi) * S / 2;
    // 五線と音部記号
    for (let i = 0; i < 5; i++) {
      body += `<line x1="${0.5 * S}" x2="${STAFF_W - 0.5 * S}" y1="${st.top + i * S}" y2="${st.top + i * S}" stroke="${INK}" stroke-width="1"/>`;
    }
    const tr = `translate(${2.6 * S} ${st.top}) scale(${S})`;
    if (st.clef === 'treble') {
      body += `<g transform="${tr}"><path d="${TREBLE_PATH}" fill="none" stroke="${INK}" stroke-width="0.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="-0.45" cy="5.6" r="0.28" fill="${INK}"/></g>`;
    } else {
      body += `<g transform="${tr}"><circle cx="-0.5" cy="1" r="0.34" fill="${INK}"/><path d="${BASS_PATH}" fill="none" stroke="${INK}" stroke-width="0.24" stroke-linecap="round"/><circle cx="1.75" cy="0.5" r="0.15" fill="${INK}"/><circle cx="1.75" cy="1.5" r="0.15" fill="${INK}"/></g>`;
    }

    // この段に書く音（大譜表はド4以上をト音記号、それより下をヘ音記号に）
    const notes = midis
      .filter((m) => mode !== 'grand' || (st.clef === 'treble' ? m >= 60 : m < 60))
      .map((m) => ({ m, di: diatonic(m), sharp: isBlack(m) }))
      .sort((a, b) => a.di - b.di || a.m - b.m);
    let notesSvg = '';
    const cols = [];
    for (const n of notes) {
      // 2度以内でぶつかる音は右の列にずらす
      let col = 0;
      while (cols.some((c) => c.col === col && n.di - c.di <= 1)) col++;
      cols.push({ col, di: n.di });
      n.x = NOTE_X + col * 1.5 * S;
      n.y = yOf(n.di);
      // 加線
      const lineDis = [];
      for (let d = bottomDi - 2; d >= n.di; d -= 2) lineDis.push(d);
      for (let d = bottomDi + 10; d <= n.di; d += 2) lineDis.push(d);
      for (const d of lineDis) {
        notesSvg += `<line x1="${n.x - 1.2 * S}" x2="${n.x + 1.2 * S}" y1="${yOf(d)}" y2="${yOf(d)}" stroke="${noteInk}" stroke-width="1"/>`;
      }
      // 全音符
      notesSvg += `<ellipse cx="${n.x}" cy="${n.y}" rx="${0.78 * S}" ry="${0.52 * S}" fill="${noteInk}"/>`;
      notesSvg += `<ellipse cx="${n.x}" cy="${n.y}" rx="${0.4 * S}" ry="${0.24 * S}" fill="${PAPER}" transform="rotate(55 ${n.x} ${n.y})"/>`;
      minY = Math.min(minY, n.y - 2 * S);
      maxY = Math.max(maxY, n.y + 2 * S);
    }
    // ♯（近い音どうしは列をずらす）
    const placed = [];
    for (const n of notes.filter((n) => n.sharp).reverse()) {
      let col = 0;
      while (placed.some((p) => p.col === col && Math.abs(p.di - n.di) < 6)) col++;
      placed.push({ col, di: n.di });
      notesSvg += sharpSvg(NOTE_X - 2 * S - col * 1.3 * S, n.y);
    }
    body += `<g opacity="${opts.dim ? 0.35 : 1}">${notesSvg}</g>`;
  }

  const pad = 0.5 * S;
  svg.setAttribute('viewBox', `0 ${minY - pad} ${STAFF_W} ${maxY - minY + 2 * pad}`);
  svg.innerHTML = `<rect x="0" y="${minY - pad}" width="${STAFF_W}" height="${maxY - minY + 2 * pad}" rx="${S}" fill="${PAPER}"/>` + body;
}

function sharpSvg(cx, cy) {
  const v = 0.3 * S, h = 0.62 * S;
  return `<g stroke="${INK}" stroke-linecap="butt">` +
    `<line x1="${cx - v}" x2="${cx - v}" y1="${cy - 1.3 * S}" y2="${cy + 1.4 * S}" stroke-width="${0.13 * S}"/>` +
    `<line x1="${cx + v}" x2="${cx + v}" y1="${cy - 1.4 * S}" y2="${cy + 1.3 * S}" stroke-width="${0.13 * S}"/>` +
    `<line x1="${cx - h}" x2="${cx + h}" y1="${cy - 0.3 * S}" y2="${cy - 0.55 * S}" stroke-width="${0.28 * S}"/>` +
    `<line x1="${cx - h}" x2="${cx + h}" y1="${cy + 0.55 * S}" y2="${cy + 0.3 * S}" stroke-width="${0.28 * S}"/>` +
    `</g>`;
}
