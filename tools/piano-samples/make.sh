#!/bin/bash
# 録音のピアノの音（sounds/piano-vl2・vl3・vl4）を作る（開発用。アプリの動作には使わない）
#
# 音源：VCSL（Versilian Community Sample Library）の「Grand Piano, Steinway B」。ライセンスは CC0
#   https://github.com/sgossner/VCSL
# 使い方：tools/piano-samples/make.sh <VCSLの「Chordophones/Zithers/Grand Piano, Steinway B/NoSus」フォルダ>
# 必要なもの：ffmpeg（libmp3lame）
#
# VCSL は全体が大きい（数GB）ので、必要なファイルだけ取り出す例：
#   git clone --filter=blob:none --no-checkout --depth 1 https://github.com/sgossner/VCSL vcsl
#   cd vcsl
#   git sparse-checkout set --no-cone '/Chordophones/Zithers/Grand Piano, Steinway B/NoSus/*_vl[234]_rr1.wav'
#   git checkout HEAD
#
# 作り方：
#   - 使う音：ド1〜ド7の全音ごと（ド・レ・ミ・ファ♯・ソ♯・ラ♯）の37音。間の音はアプリで再生の速さを変えて作る
#   - ペダルなし（NoSus）。サスティンはアプリで行う
#   - 強さ：vl2（やわらかい）・vl3（ふつう）・vl4（明るい）
#   - ステレオの左右を混ぜてモノラルにする。長さは最長8秒（6秒から2秒かけてフェードアウト）
#   - MP3・96kbps・44.1kHz。ファイル名は MIDI の番号（ド4＝60）
#   - 音量は変えない（VCSL で高さ・強さの間の音量がそろえてある）
set -euo pipefail
SRC="${1:?VCSLの「Grand Piano, Steinway B/NoSus」フォルダを指定してください}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAMES=(C C# D D# E F F# G G# A A# B)
for v in 2 3 4; do
  OUT="$ROOT/sounds/piano-vl$v"
  mkdir -p "$OUT"
  for ((m = 24; m <= 96; m += 2)); do
    name="${NAMES[m % 12]}$((m / 12 - 1))"
    in="$SRC/JHPiano_NoSus_Close_${name}_vl${v}_rr1.wav"
    [ -f "$in" ] || { echo "見つかりません：$in" >&2; exit 1; }
    ffmpeg -v error -y -i "$in" -t 8 \
      -af "pan=mono|c0=0.5*c0+0.5*c1,afade=t=out:st=6:d=2" \
      -ar 44100 -c:a libmp3lame -b:a 96k -map_metadata -1 "$OUT/$m.mp3"
  done
  echo "vl$v：$(ls "$OUT" | wc -l)音・$(du -sh "$OUT" | cut -f1)"
done
