/**
 * 上傳電子譜 → 產出兩支跟譜影片
 * 1) 唱音階  2) 大提琴（自動指法／把位）
 * 固定 ♩=72，畫面音符跟隨 + 指法識別；文案不含 AI / demo
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import toneMidi from "@tonejs/midi";
import ffmpegPath from "ffmpeg-static";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import {
  assignCelloFingerings,
  fingeringLabel,
  positionTier,
} from "./cello-fingering.mjs";
import {
  hasTangtangSolfegeBank,
  renderTangtangSolfege,
  heldBeatCount,
  solfegeBeatLabel,
} from "./tangtang-solfege.mjs";

const { Midi } = toneMidi;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
const CELLO_DIR = path.join(ROOT, "assets/cello-mp3");
const SAMPLE_RATE = 44100;
const W = 720;
const H = 1280;
const FPS_NORMAL = 10;
/** Web / 试听默认：更低帧率，优先速度 */
const FPS_FAST = 6;
const FRAME_CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length || 4));
const FORCE_BPM = 72;
const SING_OCTAVE_UP = 0; // 跟譜同度，保留低音（不再抬高八度）
const VIDEO_CACHE = path.join(ROOT, "output", "video-cache");
const STYLE_TAG = "style45-no-double-accent";
const WATERMARK_PATH = path.join(ROOT, "assets/brand/watermark-tang-tang.png");
/** 按打样：对角线居中；透明度用素材自带 alpha，不再改 */
const WATERMARK_ANGLE = -32;
const WATERMARK_WIDTH_RATIO = 0.72;

/** C=哆 固定唱名；黑键用「升×」（升来=ri、升发=fi） */
const SOLFEGE_ZH = {
  0: "哆",
  1: "升哆",
  2: "来",
  3: "升来",
  4: "咪",
  5: "发",
  6: "升发",
  7: "索",
  8: "升索",
  9: "拉",
  10: "升拉",
  11: "西",
};

const NOTE_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

function midiToNoteName(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${oct}`;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(
      `${cmd} failed:\n${(r.stderr || r.stdout || "").slice(0, 2000)}`
    );
  }
  return r;
}

/** 強制樂譜速度為 72，讓繪譜時間軸與音訊一致 */
export function forceTempoInMusicXml(xml, bpm = FORCE_BPM) {
  let s = String(xml);
  if (/<per-minute>/i.test(s)) {
    s = s.replace(
      /<per-minute>\s*[^<]+\s*<\/per-minute>/gi,
      `<per-minute>${bpm}</per-minute>`
    );
  }
  s = s.replace(/\btempo="[\d.]+"/g, `tempo="${bpm}"`);
  if (!/<per-minute>/i.test(s)) {
    const block = `
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>${bpm}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${bpm}"/>
      </direction>`;
    if (/<measure[^>]*number="1"[^>]*>[\s\S]*?<\/attributes>/i.test(s)) {
      s = s.replace(
        /(<measure[^>]*number="1"[^>]*>[\s\S]*?<\/attributes>)/i,
        `$1${block}`
      );
    } else {
      s = s.replace(
        /(<measure[^>]*number="1"[^>]*>)/i,
        `$1${block}`
      );
    }
  }
  return s;
}

export function extractPieceTitle(xml) {
  const m =
    String(xml).match(/<work-title[^>]*>([^<]+)<\/work-title>/i) ||
    String(xml).match(/<movement-title[^>]*>([^<]+)<\/movement-title>/i);
  return (m?.[1] || "跟谱").trim();
}

/** 作者／作曲：优先 composer，其次任意 creator，再试 credit */
export function extractPieceAuthor(xml) {
  const s = String(xml);
  const composer = s.match(
    /<creator[^>]*type=["']composer["'][^>]*>([^<]+)<\/creator>/i
  );
  if (composer?.[1]?.trim()) return composer[1].trim();
  const lyricist = s.match(
    /<creator[^>]*type=["']lyricist["'][^>]*>([^<]+)<\/creator>/i
  );
  if (lyricist?.[1]?.trim()) return lyricist[1].trim();
  const any = s.match(/<creator[^>]*>([^<]+)<\/creator>/i);
  if (any?.[1]?.trim()) return any[1].trim();
  const credit = s.match(
    /<credit-words[^>]*>([^<]+)<\/credit-words>/i
  );
  return (credit?.[1] || "").trim();
}

let _watermarkBufPromise = null;

/** 素材原样：只用自带透明度，旋转缩放到谱面正中 */
async function getWatermarkBuffer() {
  if (_watermarkBufPromise) return _watermarkBufPromise;
  _watermarkBufPromise = (async () => {
    if (!fs.existsSync(WATERMARK_PATH)) return null;
    const targetW = Math.round(W * WATERMARK_WIDTH_RATIO);
    return sharp(WATERMARK_PATH)
      .ensureAlpha()
      .rotate(WATERMARK_ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize({ width: targetW })
      .png()
      .toBuffer();
  })();
  return _watermarkBufPromise;
}

async function loadToolkit(musicxmlPath) {
  const VerovioModule = await createVerovioModule();
  const tk = new VerovioToolkit(VerovioModule);
  tk.setOptions({
    pageWidth: 1350,
    pageHeight: 2200,
    scale: 48,
    adjustPageHeight: true,
    footer: "none",
    header: "none",
    breaks: "auto",
    svgBoundingBoxes: true,
  });
  if (!tk.loadData(fs.readFileSync(musicxmlPath, "utf8"))) {
    throw new Error("MusicXML 加载失败");
  }
  tk.redoLayout();
  return tk;
}

function decodeMidi(tk) {
  const b64 = tk.renderToMIDI();
  const raw = b64.includes(",") ? b64.split(",")[1] : b64;
  return new Midi(Buffer.from(raw, "base64"));
}

function buildTimeline(
  midi,
  forceBpm = FORCE_BPM,
  fingeringMode = "natural",
  musicXml = ""
) {
  const srcTempo = midi.header.tempos[0]?.bpm || forceBpm;
  const scale = srcTempo / forceBpm;
  const tempo = forceBpm;
  const beatMs = 60000 / tempo;
  const ts = midi.header.timeSignatures?.[0];
  const beatsPerBar = ts?.timeSignature?.[0] || ts?.beats || 4;
  const notes = [];
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        name: n.name,
        startMs: n.time * 1000 * scale,
        durationMs: Math.max(90, n.duration * 1000 * scale),
        solfege: SOLFEGE_ZH[((n.midi % 12) + 12) % 12],
        sampleName: midiToNoteName(n.midi),
        isRest: false,
      });
    }
  }
  notes.sort((a, b) => a.startMs - b.startMs);
  for (const n of notes) {
    n.heldBeats = heldBeatCount(n.durationMs, beatMs);
    n.singLabel = solfegeBeatLabel(n.solfege, n.heldBeats);
    n.beatMs = beatMs;
  }
  const withFingering = assignCelloFingerings(notes, fingeringMode);
  // 只认谱面上的休止符，不按音符空隙自动补空拍
  const rests = extractScoreRests(musicXml, beatMs, tempo);
  const merged = [...withFingering, ...rests].sort(
    (a, b) => a.startMs - b.startMs || (a.isRest ? 1 : -1)
  );
  const scoreEndMs = Math.max(
    ...merged.map((n) => n.startMs + n.durationMs),
    1000
  );
  return { notes: merged, tempo, beatMs, scoreEndMs, beatsPerBar };
}

function restSolfegeLabel(beats) {
  return "空".repeat(Math.max(1, beats));
}

/**
 * 只从 MusicXML 里带 <rest/> 的音符提取休止（谱面休止符）
 * 一拍唱一个「空」，两拍「空空」
 */
function extractScoreRests(musicXml, beatMs, tempo = FORCE_BPM) {
  if (!musicXml) return [];
  const xml = String(musicXml);
  let divisions = 2;
  let beatsPerBar = 4;
  let beatType = 4;
  const rests = [];
  let absDiv = 0; // 累计 divisions（含前缀拍号）

  const measureRe = /<measure\b[^>]*>([\s\S]*?)<\/measure>/gi;
  let m;
  while ((m = measureRe.exec(xml))) {
    const body = m[1];
    const divM = body.match(/<divisions>\s*(\d+)\s*<\/divisions>/i);
    if (divM) divisions = Math.max(1, +divM[1]);
    const bM = body.match(/<beats>\s*(\d+)\s*<\/beats>/i);
    const btM = body.match(/<beat-type>\s*(\d+)\s*<\/beat-type>/i);
    if (bM) beatsPerBar = +bM[1];
    if (btM) beatType = +btM[1];

    // 逐个 note（含和弦：chord 不推进时间）
    const noteRe = /<note\b[^>]*>([\s\S]*?)<\/note>/gi;
    let n;
    while ((n = noteRe.exec(body))) {
      const noteBody = n[1];
      const isChord = /<chord\s*\/>/i.test(noteBody);
      const durM = noteBody.match(/<duration>\s*(\d+)\s*<\/duration>/i);
      const dur = durM ? +durM[1] : 0;
      const isRest = /<rest\b/i.test(noteBody);
      if (isRest && dur > 0 && !isChord) {
        // MusicXML: duration 以 divisions 计，四分音符 = divisions
        const quarterDiv = divisions;
        const beatDiv = quarterDiv * (4 / beatType);
        const startMs = (absDiv / quarterDiv) * (60000 / tempo);
        const durationMs = (dur / quarterDiv) * (60000 / tempo);
        // 谱面每一个休止符 → 只唱一声「空」
        rests.push({
          isRest: true,
          fromScore: true,
          midi: 60,
          name: "rest",
          startMs,
          durationMs,
          restBeats: 1,
          heldBeats: Math.max(1, Math.round(dur / beatDiv)),
          beatMs,
          solfege: "空",
          sampleName: null,
          fingering: null,
        });
      }
      if (!isChord && dur > 0) absDiv += dur;
    }
  }
  return rests;
}

function ensureCelloSamples(notes) {
  fs.mkdirSync(CELLO_DIR, { recursive: true });
  const needed = [
    ...new Set(notes.filter((n) => !n.isRest && n.sampleName).map((n) => n.sampleName)),
  ];
  const base =
    "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/cello-mp3";
  // FluidR3 只用降号文件名（Db/Eb…），升号需映射
  const toFlat = {
    "C#": "Db",
    "D#": "Eb",
    "F#": "Gb",
    "G#": "Ab",
    "A#": "Bb",
  };
  for (const name of needed) {
    const dest = path.join(CELLO_DIR, `${name}.mp3`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 500) continue;
    const candidates = [name];
    const sharp = name.match(/^([A-G]#)(\d+)$/);
    if (sharp && toFlat[sharp[1]]) {
      candidates.push(`${toFlat[sharp[1]]}${sharp[2]}`);
    }
    const flat = name.match(/^([A-G]b)(\d+)$/);
    if (flat) {
      const rev = Object.entries(toFlat).find(([, v]) => v === flat[1]);
      if (rev) candidates.push(`${rev[0]}${flat[2]}`);
    }
    let ok = false;
    for (const cand of candidates) {
      const url = `${base}/${encodeURIComponent(cand)}.mp3`;
      const r = spawnSync("curl", ["-fsSL", "-o", dest, url], {
        encoding: "utf8",
      });
      if (
        r.status === 0 &&
        fs.existsSync(dest) &&
        fs.statSync(dest).size > 500
      ) {
        ok = true;
        break;
      }
      try {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch {
        /* noop */
      }
    }
    if (!ok) throw new Error(`无法下载大提琴采样: ${name}`);
  }
}

function wavToFloat(buf) {
  let offset = 12;
  let dataOffset = 44;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      dataOffset = offset + 8;
      break;
    }
    offset += 8 + size;
  }
  const n = Math.floor((buf.length - dataOffset) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return out;
}

function mp3ToFloat(mp3Path, tmpDir) {
  const wav = path.join(tmpDir, `_tmp_${path.basename(mp3Path)}.wav`);
  run(ffmpegPath, [
    "-y",
    "-i",
    mp3Path,
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    wav,
  ]);
  const buf = fs.readFileSync(wav);
  fs.unlinkSync(wav);
  return wavToFloat(buf);
}

function floatToWav(samples) {
  let peak = 1e-6;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = Math.min(1, 0.92 / peak);
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    buffer.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  return buffer;
}

function alloc(totalMs, countInMs) {
  return new Float32Array(
    Math.ceil(((totalMs + countInMs + 1000) / 1000) * SAMPLE_RATE)
  );
}

function renderClick(totalMs, beatMs, countInMs, beatsPerBar = 4) {
  const samples = alloc(totalMs, countInMs);
  const beats = Math.ceil((countInMs + totalMs) / beatMs);
  for (let b = 0; b < beats; b++) {
    const t0 = (b * beatMs) / 1000;
    const down = b % beatsPerBar === 0;
    const freq = down ? 1100 : 880;
    const amp = down ? 0.18 : 0.08;
    const len = Math.floor(0.025 * SAMPLE_RATE);
    for (let i = 0; i < len; i++) {
      const idx = Math.floor(t0 * SAMPLE_RATE) + i;
      if (idx >= samples.length) break;
      const t = i / SAMPLE_RATE;
      samples[idx] += Math.sin(2 * Math.PI * freq * t) * (1 - t / 0.025) * amp;
    }
  }
  return samples;
}

/**
 * 依把位調整音色：一把位偏厚、中把位偏亮、高把／拇指更亮更靠前
 * （用採樣染色區分不同把位，不是同一套「一把位」音色）
 */
function colorSampleForTier(src, tier) {
  if (tier <= 1) return src;
  const out = new Float32Array(src.length);
  let prev = 0;
  const hp = tier >= 3 ? 0.88 : 0.82;
  const bright = tier >= 3 ? 0.42 : 0.22;
  const body = tier >= 3 ? 0.82 : 0.92;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const high = x - prev * hp;
    prev = x * 0.6 + prev * 0.4;
    out[i] = x * body + high * bright;
  }
  return out;
}

function renderCello(notes, totalMs, countInMs, tmpDir) {
  const cache = new Map();
  const samples = alloc(totalMs, countInMs);
  for (const note of notes) {
    if (note.isRest || !note.sampleName) continue;
    const tier = positionTier(note.fingering?.position);
    const cacheKey = `${note.sampleName}|t${tier}`;
    if (!cache.has(cacheKey)) {
      const raw = mp3ToFloat(
        path.join(CELLO_DIR, `${note.sampleName}.mp3`),
        tmpDir
      );
      cache.set(cacheKey, colorSampleForTier(raw, tier));
    }
    const src = cache.get(cacheKey);
    const start = Math.floor(((note.startMs + countInMs) / 1000) * SAMPLE_RATE);
    const want = Math.floor((note.durationMs / 1000) * SAMPLE_RATE * 1.05);
    const n = Math.min(src.length, want);
    const fadeIn = Math.min(Math.floor(0.018 * SAMPLE_RATE), Math.floor(n / 6));
    const fadeOut = Math.min(Math.floor(0.04 * SAMPLE_RATE), Math.floor(n / 4));
    const baseG = tier >= 3 ? 1.02 : tier === 2 ? 0.98 : 0.95;
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      if (idx >= samples.length) break;
      let g = baseG;
      if (i < fadeIn) g *= i / fadeIn;
      if (i > n - fadeOut) g *= (n - i) / fadeOut;
      samples[idx] += src[i] * g;
    }
  }
  return samples;
}

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

const SOLFEGE_FORMANTS = {
  哆: { f: [480, 900, 2600], bw: [80, 100, 140], bright: 0.35 },
  来: { f: [720, 1300, 2500], bw: [90, 110, 150], bright: 0.45 },
  咪: { f: [310, 2200, 3000], bw: [60, 120, 160], bright: 0.55 },
  发: { f: [780, 1200, 2450], bw: [90, 110, 150], bright: 0.5 },
  索: { f: [500, 900, 2550], bw: [80, 100, 140], bright: 0.35 },
  拉: { f: [760, 1250, 2500], bw: [90, 110, 150], bright: 0.48 },
  西: { f: [300, 2150, 3100], bw: [55, 120, 160], bright: 0.55 },
  空: { f: [450, 850, 2400], bw: [70, 90, 140], bright: 0.4 },
  空空: { f: [450, 850, 2400], bw: [70, 90, 140], bright: 0.4 },
};

function makeResonator(freq, bw) {
  const r = Math.exp((-Math.PI * bw) / SAMPLE_RATE);
  const cosT = 2 * r * Math.cos((2 * Math.PI * freq) / SAMPLE_RATE);
  const gain = 1 - r;
  let x1 = 0;
  let x2 = 0;
  return (x) => {
    const y = gain * x + cosT * x1 - r * r * x2;
    x2 = x1;
    x1 = y;
    return y;
  };
}

function synthSungSyllable(solfege, freqHz, durationMs) {
  const cfg = SOLFEGE_FORMANTS[solfege] || SOLFEGE_FORMANTS["哆"];
  const n = Math.max(1, Math.floor((durationMs / 1000) * SAMPLE_RATE));
  const out = new Float32Array(n);
  const res = cfg.f.map((f, i) => makeResonator(f, cfg.bw[i]));
  const attack = Math.floor(0.035 * SAMPLE_RATE);
  const release = Math.min(Math.floor(0.07 * SAMPLE_RATE), Math.floor(n * 0.28));
  const cons = Math.floor(0.016 * SAMPLE_RATE);
  let phase = 0;
  const twoPi = 2 * Math.PI;
  const harms = [1.0, 0.45, 0.22, 0.1, 0.05];

  for (let i = 0; i < n; i++) {
    phase += (twoPi * freqHz) / SAMPLE_RATE;
    if (phase > twoPi) phase -= twoPi * Math.floor(phase / twoPi);
    let src = 0;
    for (let h = 0; h < harms.length; h++) {
      src += Math.sin(phase * (h + 1)) * harms[h];
    }
    src /= 1.8;
    if (i < cons) {
      const noise = (Math.random() * 2 - 1) * (1 - i / cons) * 0.35;
      src = src * (0.35 + 0.65 * (i / cons)) + noise;
    }
    let y = 0;
    for (const r of res) y += r(src);
    y *= 0.28 + cfg.bright * 0.18;
    let env = 1;
    if (i < attack) env = i / attack;
    else if (i > n - release) env = (n - i) / release;
    out[i] = y * Math.pow(Math.max(0, env), 0.9) * 0.95;
  }
  return out;
}

function renderSolfegeSing(notes, totalMs, countInMs, beatMs = 60000 / FORCE_BPM) {
  // 优先：汤汤唱名样本；没有银行时回退合成
  if (hasTangtangSolfegeBank()) {
    const voice = renderTangtangSolfege(
      notes,
      totalMs,
      countInMs,
      SAMPLE_RATE,
      { octaveUp: SING_OCTAVE_UP, beatMs }
    );
    if (voice) return voice;
  }
  const samples = alloc(totalMs, countInMs);
  for (const note of notes) {
    if (note.isRest) {
      const freq = midiToFreq((note.midi || 60) + SING_OCTAVE_UP);
      const beatMsLocal = beatMs;
      const sylDur = Math.min(
        Math.max(160, (note.durationMs || beatMsLocal) * 0.7),
        beatMsLocal * 1.1
      );
      const pitched = synthSungSyllable("空", freq, sylDur);
      const start = Math.floor(((note.startMs + countInMs) / 1000) * SAMPLE_RATE);
      for (let i = 0; i < pitched.length; i++) {
        const idx = start + i;
        if (idx >= samples.length) break;
        samples[idx] += pitched[i];
      }
      continue;
    }
    const beats = note.heldBeats || heldBeatCount(note.durationMs, beatMs);
    const freq = midiToFreq((note.midi || 60) + SING_OCTAVE_UP);
    for (let b = 0; b < beats; b++) {
      const start = Math.floor(
        ((note.startMs + b * beatMs + countInMs) / 1000) * SAMPLE_RATE
      );
      const syl = b === 0 ? note.solfege || "哆" : "空"; // fallback 数拍用短音
      const dur = b === 0 ? Math.min(beatMs * 0.8, 400) : beatMs * 0.5;
      const pitched = synthSungSyllable(syl === "空" ? "索" : syl, freq, dur);
      for (let i = 0; i < pitched.length; i++) {
        const idx = start + i;
        if (idx >= samples.length) break;
        samples[idx] += pitched[i] * (b === 0 ? 1 : 0.85);
      }
    }
  }
  return samples;
}

function mix(tracks, gains) {
  const len = Math.max(...tracks.map((t) => t.length));
  const out = new Float32Array(len);
  for (let t = 0; t < tracks.length; t++) {
    const g = gains[t] ?? 1;
    const src = tracks[t];
    for (let i = 0; i < src.length; i++) out[i] += src[i] * g;
  }
  return out;
}

/** 白底 · 馬卡龍淺色區配深字 */
const PAPER = "#ffffff";
const INK = "#37474f";
const MUTED = "#78909c";
const BEAT_IDLE_FILL = "#f5f7fa";
const BEAT_IDLE_STROKE = "#cfd8dc";
const BEAT_IDLE_INK = "#546e7a";

function escapeCssId(id) {
  return String(id).replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

function hexToRgba(hex, alpha) {
  const h = String(hex).replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 跟譜樣式：高亮色隨把位走；小節底色同色系淡鋪
 */
function injectScoreStyles(svg, noteIds, measureId, highlightInk, measureTint) {
  const parts = [];
  if (measureId && measureTint) {
    const mid = escapeCssId(measureId);
    parts.push(
      `#${mid} g.staff.bounding-box>rect{fill:${measureTint}!important;stroke:none!important}`
    );
  }
  if (noteIds?.length && highlightInk) {
    const sel = noteIds.map((id) => `#${escapeCssId(id)}`).join(",");
    parts.push(
      `${sel},${sel} *{fill:${highlightInk}!important;stroke:${highlightInk}!important}`
    );
  }
  if (!parts.length) return svg;
  const css = `<style>${parts.join("")}</style>`;
  return svg.replace(/(<svg[^>]*>)/, `$1${css}`);
}

function injectHighlight(svg, noteIds) {
  const c = tierColor(1);
  return injectScoreStyles(svg, noteIds, null, c.bg, null);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tierColor(tier) {
  // 馬卡龍：一把位紫、中把青、高把藍 —— 淺底深字；高亮隨把位
  if (tier >= 3)
    return {
      bg: "#64b5f6",
      fg: "#0d47a1",
      soft: "#e3f2fd",
      stroke: "#42a5f5",
      highlight: "#1e88e5",
    }; // 高把 · 藍
  if (tier === 2)
    return {
      bg: "#4dd0e1",
      fg: "#006064",
      soft: "#e0f7fa",
      stroke: "#26c6da",
      highlight: "#00acc1",
    }; // 中把 · 青
  return {
    bg: "#b39ddb",
    fg: "#4527a0",
    soft: "#ede7f6",
    stroke: "#9575cd",
    highlight: "#7e57c2",
  }; // 一把位 · 紫
}

async function renderFrames(tk, timeline, countInMs, framesDir, opts) {
  const { title, subtitle, mode, fps = FPS_NORMAL, jpegQuality = 72 } = opts;
  const isCello = mode === "cello";
  const foot = isCello
    ? `♩=${Math.round(timeline.tempo)} · 音符跟随 · 指法识别`
    : `♩=${Math.round(timeline.tempo)} · 音符跟随`;
  const paper = isCello ? PAPER : "#ffffff";
  const titleFill = isCello ? INK : "#1a2e24";
  const subFill = isCello ? MUTED : "#5c6670";
  const footFill = isCello ? "#9a8d7c" : "#8a9199";
  const watermarkBuf = await getWatermarkBuffer();
  let watermarkMeta = null;
  let watermarkLeft = 0;
  let watermarkTop = 0;
  if (watermarkBuf) {
    watermarkMeta = await sharp(watermarkBuf).metadata();
    watermarkLeft = Math.max(
      0,
      Math.round((W - (watermarkMeta.width || 0)) / 2)
    );
    // 贴在谱面区域正中，再上移 30px
    const scoreTop = 330;
    const scoreBottom = H - 70;
    watermarkTop = Math.round(
      scoreTop +
        (scoreBottom - scoreTop - (watermarkMeta.height || 0)) / 2 -
        30
    );
  }

  for (const f of fs.readdirSync(framesDir)) {
    fs.unlinkSync(path.join(framesDir, f));
  }

  const pageCount = tk.getPageCount();
  const pageSvgs = {};
  for (let p = 1; p <= pageCount; p++) pageSvgs[p] = tk.renderToSVG(p);

  const totalMs = countInMs + timeline.scoreEndMs + 1000;
  const frameCount = Math.ceil((totalMs / 1000) * fps);
  const bpb = timeline.beatsPerBar || 4;
  const beatGap = isCello ? 86 : 90;
  const beatR = isCello ? 24 : 26;
  const beatSpan = (bpb - 1) * beatGap + beatR * 2;

  const jobs = [];
  for (let f = 0; f < frameCount; f++) {
    const absMs = (f / fps) * 1000;
    const scoreMs = absMs - countInMs;
    const inCountIn = scoreMs < 0;

    let svg = pageSvgs[1];
    let label = "";
    let subLabel = "";
    let tier = 1;
    let atNotes = [];
    let atMeasure = null;
    if (!inCountIn) {
      const at = tk.getElementsAtTime(Math.max(0, Math.floor(scoreMs)));
      if (at?.page && pageSvgs[at.page]) svg = pageSvgs[at.page];
      atNotes = at?.notes || [];
      atMeasure = at?.measure || null;
      const cur = timeline.notes.find(
        (n) => scoreMs >= n.startMs && scoreMs < n.startMs + n.durationMs
      );
      if (cur) {
        if (isCello) {
          if (cur.isRest) {
            label = "空拍";
            subLabel = "";
          } else {
            const fl = fingeringLabel(cur.fingering);
            label = `拉：${cur.name}`;
            subLabel = fl;
            tier = positionTier(cur.fingering?.position);
          }
        } else {
          if (cur.isRest) {
            label = `唱：空`;
            subLabel = "";
          } else {
            const beats =
              cur.heldBeats ||
              heldBeatCount(cur.durationMs, timeline.beatMs);
            const full =
              cur.singLabel || solfegeBeatLabel(cur.solfege, beats);
            // 长音：画面一次写清「哆234」
            label = `唱：${full}`;
            if (!cur.isRest && cur.fingering && beats <= 1) {
              subLabel = `对照指法 ${fingeringLabel(cur.fingering)}`;
            } else {
              subLabel = "";
            }
            if (cur.fingering) {
              tier = positionTier(cur.fingering?.position);
            }
          }
        }
      }
    }

    const colors = tierColor(tier);
    if (!inCountIn) {
      svg = injectScoreStyles(
        svg,
        atNotes,
        atMeasure,
        colors.highlight || colors.bg,
        hexToRgba(colors.highlight || colors.bg, 0.16)
      );
    }

    const beatIdx = inCountIn
      ? (((Math.floor(scoreMs / timeline.beatMs) % bpb) + bpb) % bpb)
      : Math.floor(scoreMs / timeline.beatMs) % bpb;
    const beats = Array.from({ length: bpb }, (_, i) => {
      const on = i === beatIdx;
      const cx = beatR + i * beatGap;
      if (isCello) {
        const fill = on ? colors.soft : BEAT_IDLE_FILL;
        const stroke = on ? colors.stroke || colors.bg : BEAT_IDLE_STROKE;
        const ink = on ? colors.fg : BEAT_IDLE_INK;
        return (
          `<circle cx="${cx}" cy="36" r="${beatR}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>` +
          `<text x="${cx}" y="43" text-anchor="middle" font-size="22" font-family="Palatino,'Palatino Linotype',Georgia,serif" font-weight="600" fill="${ink}">${i + 1}</text>`
        );
      }
      const fill = on ? colors.bg : "#ececec";
      const ink = on ? colors.fg : "#6b7280";
      return (
        `<circle cx="${cx}" cy="36" r="${beatR}" fill="${fill}"/>` +
        `<text x="${cx}" y="44" text-anchor="middle" font-size="26" font-family="Georgia,serif" font-weight="700" fill="${ink}">${i + 1}</text>`
      );
    }).join("");

    const hook = inCountIn
      ? `预备拍 ${beatIdx + 1}`
      : label || "音符跟随";
    const bannerH = subLabel ? 96 : 64;
    const bannerFill = isCello ? colors.soft : colors.soft;
    const bannerInk = colors.fg; // 淺底深字
    const bannerStroke = isCello
      ? `<rect x="48" y="230" width="${W - 96}" height="${bannerH}" rx="14" fill="none" stroke="${colors.stroke || colors.bg}" stroke-width="2"/>`
      : "";
    const titleFont = isCello
      ? "Palatino,'Palatino Linotype',Georgia,'Songti SC',serif"
      : "Georgia,'Songti SC',serif";
    const bodyFont = isCello
      ? "'Songti SC','PingFang SC',Palatino,serif"
      : "'PingFang SC','Songti SC',serif";

    const overlay = Buffer.from(`<?xml version="1.0"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="${paper}"/>
  ${
    isCello
      ? `<rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="6" fill="none" stroke="#b2ebf2" stroke-width="1.5"/>`
      : ""
  }
  <text x="${W / 2}" y="88" text-anchor="middle" font-size="${isCello ? 30 : 32}" font-family="${titleFont}" font-weight="700" fill="${titleFill}">${escapeXml(title)}</text>
  <text x="${W / 2}" y="128" text-anchor="middle" font-size="17" font-family="${bodyFont}" fill="${subFill}">${escapeXml(subtitle)}</text>
  <g transform="translate(${(W - beatSpan) / 2}, 150)">${beats}</g>
  <rect x="48" y="230" width="${W - 96}" height="${bannerH}" rx="${isCello ? 14 : 8}" fill="${bannerFill}"/>
  ${bannerStroke}
  <text x="${W / 2}" y="${subLabel ? 268 : 272}" text-anchor="middle" font-size="21" font-family="${bodyFont}" fill="${bannerInk}">${escapeXml(hook)}</text>
  ${
    subLabel
      ? `<text x="${W / 2}" y="302" text-anchor="middle" font-size="16" font-family="${bodyFont}" fill="${bannerInk}">${escapeXml(subLabel)}</text>`
      : ""
  }
  <text x="${W / 2}" y="${H - 48}" text-anchor="middle" font-size="15" font-family="${titleFont}" fill="${footFill}">${escapeXml(foot)}</text>
</svg>`);

    jobs.push({
      f,
      svg,
      overlay,
      out: path.join(framesDir, `frame_${String(f).padStart(5, "0")}.jpg`),
    });
  }

  let cursor = 0;
  const workers = Array.from({ length: FRAME_CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const scorePng = await sharp(Buffer.from(job.svg))
        .resize({ width: W - 100, fit: "inside", background: paper })
        .png()
        .toBuffer();
      const meta = await sharp(scorePng).metadata();
      const top = 330;
      const left = Math.max(24, Math.round((W - (meta.width || W)) / 2));
      const layers = [{ input: scorePng, top, left }];
      if (watermarkBuf) {
        layers.push({
          input: watermarkBuf,
          left: watermarkLeft,
          top: watermarkTop,
        });
      }
      await sharp(job.overlay)
        .composite(layers)
        .jpeg({ quality: jpegQuality, mozjpeg: true })
        .toFile(job.out);
    }
  });
  await Promise.all(workers);
  return frameCount;
}

function encodeVideo(framesDir, wavPath, outMp4, fps = FPS_NORMAL, fast = false) {
  const args = [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(framesDir, "frame_%05d.jpg"),
    "-i",
    wavPath,
    "-c:v",
    "libx264",
    "-preset",
    fast ? "ultrafast" : "veryfast",
    "-crf",
    fast ? "28" : "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    fast ? "128k" : "160k",
    "-threads",
    "0",
    "-shortest",
    "-movflags",
    "+faststart",
    outMp4,
  ];
  run(ffmpegPath, args);
}

function scoreCacheKey(musicXmlPath, fast, fingeringMode = "natural") {
  const raw = fs.readFileSync(musicXmlPath);
  return crypto
    .createHash("sha1")
    .update(raw)
    .update(
      fast
        ? `|fast${FPS_FAST}|${STYLE_TAG}|${fingeringMode}`
        : `|norm${FPS_NORMAL}|${STYLE_TAG}|${fingeringMode}`
    )
    .digest("hex")
    .slice(0, 16);
}

function tryLoadVideoCache(cacheKey, workDir) {
  const dir = path.join(VIDEO_CACHE, cacheKey);
  const sol = path.join(dir, "唱音阶.mp4");
  const cel = path.join(dir, "大提琴.mp4");
  const fin = path.join(dir, "fingerings.json");
  const meta = path.join(dir, "meta.json");
  if (![sol, cel, fin, meta].every((p) => fs.existsSync(p))) return null;
  fs.copyFileSync(sol, path.join(workDir, "唱音阶.mp4"));
  fs.copyFileSync(cel, path.join(workDir, "大提琴.mp4"));
  fs.copyFileSync(fin, path.join(workDir, "fingerings.json"));
  const info = JSON.parse(fs.readFileSync(meta, "utf8"));
  return {
    title: info.title,
    author: info.author || "",
    tempo: FORCE_BPM,
    noteCount: info.noteCount,
    durationSec: info.durationSec,
    fingerings: JSON.parse(fs.readFileSync(fin, "utf8")).notes || [],
    files: {
      solfege: path.join(workDir, "唱音阶.mp4"),
      cello: path.join(workDir, "大提琴.mp4"),
      score: path.join(workDir, "score.musicxml"),
      fingerings: path.join(workDir, "fingerings.json"),
    },
    fromCache: true,
  };
}

function saveVideoCache(cacheKey, result) {
  const dir = path.join(VIDEO_CACHE, cacheKey);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(result.files.solfege, path.join(dir, "唱音阶.mp4"));
  fs.copyFileSync(result.files.cello, path.join(dir, "大提琴.mp4"));
  fs.copyFileSync(result.files.fingerings, path.join(dir, "fingerings.json"));
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        title: result.title,
        author: result.author || "",
        noteCount: result.noteCount,
        durationSec: result.durationSec,
        savedAt: Date.now(),
      },
      null,
      2
    ),
    "utf8"
  );
}

/**
 * @param {object} opts
 * @param {string} opts.musicXmlPath
 * @param {string} opts.workDir
 * @param {boolean} [opts.fast] - 手机传图：更低帧率更快出片
 * @param {(p:{stage:string,percent:number,message:string})=>void} [opts.onProgress]
 */
export async function generatePair({
  musicXmlPath,
  workDir,
  onProgress,
  fast = false,
  fingeringMode = "natural",
  /** 跟唱轨：仅人声（无大提琴、无节拍器），适合音阶示范 */
  voiceOnly = false,
  /** 是否唱空拍；音阶示范关掉 */
  singRests = true,
}) {
  const report = (stage, percent, message) => {
    onProgress?.({ stage, percent, message });
  };
  const fps = fast ? FPS_FAST : FPS_NORMAL;
  const jpegQuality = fast ? 50 : 68;

  fs.mkdirSync(workDir, { recursive: true });
  const framesSol = path.join(workDir, "frames-sol");
  const framesCel = path.join(workDir, "frames-cel");
  const stemsDir = path.join(workDir, "stems");
  fs.mkdirSync(framesSol, { recursive: true });
  fs.mkdirSync(framesCel, { recursive: true });
  fs.mkdirSync(stemsDir, { recursive: true });

  report("prepare", 5, "读取乐谱并固定速度 ♩=72");
  const raw = fs.readFileSync(musicXmlPath, "utf8");
  const title = extractPieceTitle(raw);
  const author = extractPieceAuthor(raw);
  const forced = forceTempoInMusicXml(raw, FORCE_BPM);
  const scorePath = path.join(workDir, "score.musicxml");
  fs.writeFileSync(scorePath, forced, "utf8");

  const cacheKey = scoreCacheKey(scorePath, fast, fingeringMode) +
    (voiceOnly ? "|vo" : "") +
    (singRests ? "" : "|nr");
  const cached = tryLoadVideoCache(cacheKey, workDir);
  if (cached) {
    report("cache", 100, "命中成片缓存，秒级完成");
    return cached;
  }

  report("score", 12, fast ? "绘谱（极速出片）" : "绘谱");
  const [tkSol, tkCel] = await Promise.all([
    loadToolkit(scorePath),
    loadToolkit(scorePath),
  ]);
  const midi = decodeMidi(tkSol);
  const timeline = buildTimeline(midi, FORCE_BPM, fingeringMode, forced);
  const countInMs = timeline.beatMs * timeline.beatsPerBar;

  report("fingering", 18, "识别大提琴指法／把位");
  const fingeringPath = path.join(workDir, "fingerings.json");
  const fingeringTable = timeline.notes.map((n, i) => ({
    index: i,
    name: n.name,
    midi: n.midi,
    solfege: n.solfege,
    startMs: Math.round(n.startMs),
    durationMs: Math.round(n.durationMs),
    heldBeats: n.heldBeats || 1,
    singLabel: n.singLabel || n.solfege,
    isRest: !!n.isRest,
    restBeats: n.restBeats || null,
    ...n.fingering,
    label: n.isRest ? n.solfege : fingeringLabel(n.fingering),
  }));
  fs.writeFileSync(
    fingeringPath,
    JSON.stringify(
      { title, author, tempo: FORCE_BPM, notes: fingeringTable },
      null,
      2
    ),
    "utf8"
  );

  report("samples", 22, "准备大提琴采样（FluidR3）");
  ensureCelloSamples(timeline.notes);

  report("audio", 30, "渲染音轨");
  const click = renderClick(
    timeline.scoreEndMs,
    timeline.beatMs,
    countInMs,
    timeline.beatsPerBar
  );
  const cello = renderCello(
    timeline.notes,
    timeline.scoreEndMs,
    countInMs,
    workDir
  );
  const solfegeNotes = singRests
    ? timeline.notes
    : timeline.notes.filter((n) => !n.isRest);
  const solfege = renderSolfegeSing(
    solfegeNotes,
    timeline.scoreEndMs,
    countInMs,
    timeline.beatMs
  );

  // 跟唱：人声为主；大提琴只垫很轻，避免「两个声部砸在一起」像重音
  const solMix = voiceOnly
    ? mix([solfege], [1.12])
    : mix([solfege, cello, click], [1.12, 0.1, 0.025]);
  const celloMix = mix([cello, click], [1.0, 0.06]);
  const solWav = path.join(stemsDir, "唱音阶.wav");
  const celloWav = path.join(stemsDir, "大提琴.wav");
  fs.writeFileSync(solWav, floatToWav(solMix));
  fs.writeFileSync(celloWav, floatToWav(celloMix));

  const solMp4 = path.join(workDir, "唱音阶.mp4");
  const celloMp4 = path.join(workDir, "大提琴.mp4");

  report("video", 42, fast ? "并行合成两支视频（极速）" : "并行合成两支视频");
  const headerSubtitle = author || "";
  await Promise.all([
    (async () => {
      await renderFrames(tkSol, timeline, countInMs, framesSol, {
        title,
        subtitle: headerSubtitle,
        mode: "solfege",
        fps,
        jpegQuality,
      });
      encodeVideo(framesSol, solWav, solMp4, fps, fast);
    })(),
    (async () => {
      await renderFrames(tkCel, timeline, countInMs, framesCel, {
        title,
        subtitle: headerSubtitle,
        mode: "cello",
        fps,
        jpegQuality,
      });
      encodeVideo(framesCel, celloWav, celloMp4, fps, fast);
    })(),
  ]);

  report("done", 100, "完成");
  const result = {
    title,
    author,
    tempo: FORCE_BPM,
    noteCount: timeline.notes.length,
    durationSec: (countInMs + timeline.scoreEndMs) / 1000,
    fingerings: fingeringTable,
    files: {
      solfege: solMp4,
      cello: celloMp4,
      score: scorePath,
      fingerings: fingeringPath,
    },
    fromCache: false,
  };
  try {
    saveVideoCache(cacheKey, result);
  } catch {
    /* 缓存失败不影响出片 */
  }
  return result;
}
