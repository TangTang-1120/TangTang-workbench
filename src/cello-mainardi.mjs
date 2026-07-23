/**
 * Enrico Mainardi 義式大提琴 · 人氣版
 * - Karoryfer 真人演奏乾採樣（遠近麥混合，少電子感）
 * - 揉弦不完美正弦：速率/深度微抖、晚起振
 * - 弓速起音、微時值偏差、輕房間感
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { fileURLToPath } from "node:url";
import { positionTier } from "./cello-fingering.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const KARORYFER_DIR = path.join(ROOT, "assets/cello-karoryfer");
export const FLUID_DIR = path.join(ROOT, "assets/cello-mp3");
export const CELLO_ENGINE_TAG = "mainardi-v3-cello-body";

const SAMPLE_RATE = 44100;
const RAW_MIRRORS = [
  "https://cdn.jsdelivr.net/gh/sfzinstruments/karoryfer-bigcat.cello@master/Samples/sus",
  "https://raw.githubusercontent.com/sfzinstruments/karoryfer-bigcat.cello/master/Samples/sus",
];

const GRID = [
  { name: "C", midiClass: 0 },
  { name: "Eb", midiClass: 3 },
  { name: "Gb", midiClass: 6 },
  { name: "A", midiClass: 9 },
];

function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function noteNameToMidi(name) {
  const m = String(name).match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!m) return null;
  const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = map[m[1]];
  if (m[2] === "#") pc += 1;
  if (m[2] === "b") pc -= 1;
  pc = ((pc % 12) + 12) % 12;
  return (Number(m[3]) + 1) * 12 + pc;
}

function midiToNoteName(midi) {
  const names = [
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
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function nearestGrid(midi) {
  let best = null;
  for (const g of GRID) {
    for (let oct = 0; oct <= 6; oct++) {
      const gm = (oct + 1) * 12 + g.midiClass;
      const dist = Math.abs(gm - midi);
      if (!best || dist < best.dist) best = { midi: gm, name: `${g.name}${oct}`, dist };
    }
  }
  return best;
}

function hash01(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return (h >>> 0) / 4294967295;
}

function wavToFloat(buf) {
  let offset = 12;
  let dataOffset = 44;
  let bits = 16;
  let rate = SAMPLE_RATE;
  let channels = 1;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(offset + 10);
      rate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataOffset = offset + 8;
      break;
    }
    offset += 8 + size;
  }
  const bytes = bits / 8;
  const frames = Math.floor((buf.length - dataOffset) / (bytes * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const o = dataOffset + i * bytes * channels;
    if (bits === 24) {
      let n = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (n & 0x800000) n |= ~0xffffff;
      out[i] = n / 8388608;
    } else {
      out[i] = buf.readInt16LE(o) / 32768;
    }
  }
  if (rate === SAMPLE_RATE) return out;
  const n2 = Math.floor((frames * SAMPLE_RATE) / rate);
  const r = new Float32Array(n2);
  for (let i = 0; i < n2; i++) {
    const x = (i * rate) / SAMPLE_RATE;
    const i0 = Math.floor(x);
    const i1 = Math.min(frames - 1, i0 + 1);
    const f = x - i0;
    r[i] = out[i0] * (1 - f) + out[i1] * f;
  }
  return r;
}

function mp3ToFloat(mp3Path) {
  const wav = path.join(path.dirname(mp3Path), `_tmp_${path.basename(mp3Path)}.wav`);
  const r = spawnSync(
    ffmpegPath,
    ["-y", "-i", mp3Path, "-ac", "1", "-ar", String(SAMPLE_RATE), wav],
    { encoding: "utf8" }
  );
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${mp3Path}`);
  const buf = fs.readFileSync(wav);
  try {
    fs.unlinkSync(wav);
  } catch {
    /* noop */
  }
  return wavToFloat(buf);
}

function tryDownloadKaroryfer(noteKey, dyn, mic) {
  fs.mkdirSync(KARORYFER_DIR, { recursive: true });
  const file = `${noteKey}_${dyn}_${mic}.wav`;
  const dest = path.join(KARORYFER_DIR, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  for (const base of RAW_MIRRORS) {
    const url = `${base}/${encodeURIComponent(file)}`;
    const r = spawnSync(
      "curl",
      ["-fsSL", "--connect-timeout", "8", "--max-time", "50", "-o", dest, url],
      { encoding: "utf8" }
    );
    if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      return dest;
    }
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* noop */
    }
  }
  return null;
}

function ensureFluidSample(noteName) {
  fs.mkdirSync(FLUID_DIR, { recursive: true });
  const dest = path.join(FLUID_DIR, `${noteName}.mp3`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 500) return dest;
  const toFlat = { "C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb" };
  const candidates = [noteName];
  const sharp = noteName.match(/^([A-G]#)(\d+)$/);
  if (sharp && toFlat[sharp[1]]) candidates.push(`${toFlat[sharp[1]]}${sharp[2]}`);
  const base =
    "https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/FluidR3_GM/cello-mp3";
  for (const cand of candidates) {
    const url = `${base}/${encodeURIComponent(cand)}.mp3`;
    const r = spawnSync(
      "curl",
      ["-fsSL", "--connect-timeout", "8", "--max-time", "30", "-o", dest, url],
      { encoding: "utf8" }
    );
    if (r.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 500) {
      return dest;
    }
  }
  throw new Error(`无法取得大提琴采样: ${noteName}`);
}

function mixBuffers(a, b, wa, wb) {
  const n = Math.min(a.length, b.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] * wa + b[i] * wb;
  return out;
}

function loadSourceForMidi(midi, cache) {
  const grid = nearestGrid(midi);
  const kKey = `kar:${grid.name}`;
  if (cache.has(kKey)) return cache.get(kKey);

  // 遠麥為主（房間人氣）+ 近麥輕補木頭；避免純近乾麥的電子感
  const far =
    tryDownloadKaroryfer(grid.name, "mf", "d") ||
    tryDownloadKaroryfer(grid.name, "mp", "d");
  const near =
    tryDownloadKaroryfer(grid.name, "mf", "g") ||
    tryDownloadKaroryfer(grid.name, "mp", "g");

  if (far || near) {
    const fBuf = far ? wavToFloat(fs.readFileSync(far)) : null;
    const nBuf = near ? wavToFloat(fs.readFileSync(near)) : null;
    const samples =
      fBuf && nBuf
        ? mixBuffers(fBuf, nBuf, 0.88, 0.2) // 更偏遠麥：厚、暗，少近麥尖亮
        : fBuf || nBuf;
    const entry = { samples, srcMidi: grid.midi, dry: true };
    cache.set(kKey, entry);
    return entry;
  }

  const name = midiToNoteName(midi);
  const fKey = `fluid:${name}`;
  if (!cache.has(fKey)) {
    cache.set(fKey, {
      samples: mp3ToFloat(ensureFluidSample(name)),
      srcMidi: midi,
      dry: false,
    });
  }
  return cache.get(fKey);
}

function colorSampleForTier(src, tier) {
  if (tier <= 1) return src;
  const out = new Float32Array(src.length);
  let prev = 0;
  const hp = tier >= 3 ? 0.86 : 0.8;
  const bright = tier >= 3 ? 0.28 : 0.14;
  const body = tier >= 3 ? 0.88 : 0.95;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const high = x - prev * hp;
    prev = x * 0.55 + prev * 0.45;
    out[i] = x * body + high * bright;
  }
  return out;
}

/** 交叉淡化循環，避免電子感接縫 */
function readLooped(src, pos) {
  const n = src.length;
  if (n < 8) return 0;
  const loopStart = Math.floor(n * 0.28);
  const loopEnd = Math.floor(n * 0.88);
  const loopLen = Math.max(8, loopEnd - loopStart);
  let p = pos;
  if (p >= loopEnd) {
    p = loopStart + ((p - loopStart) % loopLen);
  }
  p = Math.max(0, Math.min(n - 2, p));
  const i0 = Math.floor(p);
  const i1 = i0 + 1;
  const f = p - i0;
  return src[i0] * (1 - f) + src[i1] * f;
}

/**
 * 人氣揉弦：不完美正弦、速率微漂、弓壓微顫
 */
function renderPitchedHuman(src, srcMidi, targetMidi, durationMs, dry, seed) {
  const baseRatio = midiToFreq(targetMidi) / midiToFreq(srcMidi);
  const n = Math.max(1, Math.floor((durationMs / 1000) * SAMPLE_RATE * 1.04));
  const out = new Float32Array(n);

  const r0 = hash01(seed, "r");
  const r1 = hash01(seed, "d");
  const r2 = hash01(seed, "ph");

  // Mainardi：窄、穩，但帶人手不完美
  let vibHz = 5.55 + r0 * 0.55; // 5.55–6.1
  let depthCents = durationMs >= 1000 ? 14 : durationMs >= 500 ? 11 : 6;
  depthCents *= 0.85 + r1 * 0.3;
  if (!dry) depthCents *= 0.35;

  // 真人采样本身已有弓弦质感；再叠程式揉弦容易变电子。干采样默认不叠 LFO。
  const enableVib = false;
  const delaySec = 0.09 + r0 * 0.08;
  const bloomSec = 0.28 + r1 * 0.12;
  const phase0 = r2 * Math.PI * 2;

  let pos = Math.floor(hash01(seed, "atk") * SAMPLE_RATE * 0.012); // 略跳过采样起音尖刺
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // 揉弦速率轻微漂移（人手）
    const hz = vibHz * (1 + 0.035 * Math.sin(2 * Math.PI * 0.37 * t + phase0));
    let depth = 0;
    if (enableVib && t > delaySec) {
      const u = Math.min(1, (t - delaySec) / bloomSec);
      depth = depthCents * (u * u * (3 - 2 * u));
      // 深度也不完全死板
      depth *= 1 + 0.08 * Math.sin(2 * Math.PI * 0.23 * t + 1.1);
    }
    // 非纯正弦：二次谐波一点点，像真实揉弦波形
    const vibWave =
      Math.sin(2 * Math.PI * hz * t + phase0) * 0.92 +
      Math.sin(4 * Math.PI * hz * t + phase0) * 0.08;
    const vibRatio = Math.pow(2, (vibWave * depth) / 1200);
    pos += baseRatio * vibRatio;

    let s = readLooped(src, pos);
    // 弓压微变（慢）+ 极轻噪声纹理
    const bow = 1 + 0.03 * Math.sin(2 * Math.PI * (0.9 + r0) * t + phase0);
    const grit =
      t < 0.05 ? (hash01(seed, i) - 0.5) * 0.012 * (1 - t / 0.05) : 0;
    out[i] = s * bow + grit;
  }
  return out;
}

/** 加厚琴箱低中頻、收掉尖亮 —— 避免聽成小提琴 */
function celloBodyTone(samples) {
  const out = new Float32Array(samples.length);
  // 一階低架：強化 ~100–250Hz 琴箱感
  let lpf = 0;
  const a = 0.12; // 低通係數
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    lpf = lpf + a * (x - lpf);
    const body = lpf * 1.35;
    const mid = x * 0.72; // 略減中高，少「細尖」
    out[i] = body + mid;
  }
  return out;
}

/** 簡易房間：多抽頭回聲，暖一點、少數位感 */
function addRoom(samples) {
  const out = new Float32Array(samples.length);
  const taps = [
    { ms: 22, g: 0.14 },
    { ms: 41, g: 0.09 },
    { ms: 68, g: 0.06 },
    { ms: 105, g: 0.035 },
  ];
  for (let i = 0; i < samples.length; i++) {
    let y = samples[i] * 0.9;
    for (const t of taps) {
      const d = Math.floor((t.ms / 1000) * SAMPLE_RATE);
      if (i >= d) y += samples[i - d] * t.g;
    }
    out[i] = y;
  }
  return celloBodyTone(out);
}

function alloc(totalMs, countInMs) {
  return new Float32Array(
    Math.ceil(((totalMs + countInMs + 1000) / 1000) * SAMPLE_RATE)
  );
}

export function renderMainardiCello(notes, totalMs, countInMs) {
  const cache = new Map();
  let samples = alloc(totalMs, countInMs);
  let usedDry = 0;
  let usedFluid = 0;

  notes.forEach((note, idx) => {
    const midi = note.midi ?? noteNameToMidi(note.sampleName);
    if (midi == null) return;
    const src = loadSourceForMidi(midi, cache);
    if (src.dry) usedDry++;
    else usedFluid++;

    const seed = `${midi}|${Math.round(note.startMs)}|${idx}`;
    const tier = positionTier(note.fingering?.position);
    const pitched = renderPitchedHuman(
      src.samples,
      src.srcMidi,
      midi,
      note.durationMs,
      src.dry,
      seed
    );
    const colored = colorSampleForTier(pitched, tier);

    // 人手微时值：起音略早晚
    const jitMs = (hash01(seed, "t") - 0.5) * 18;
    const start = Math.floor(
      ((note.startMs + countInMs + jitMs) / 1000) * SAMPLE_RATE
    );
    const n = colored.length;
    // 更像弓：起音柔、收音自然
    const fadeIn = Math.min(Math.floor(0.038 * SAMPLE_RATE), Math.floor(n / 5));
    const fadeOut = Math.min(Math.floor(0.07 * SAMPLE_RATE), Math.floor(n / 3));
    const dyn = 0.88 + hash01(seed, "g") * 0.18;
    const baseG = (tier >= 3 ? 1.0 : tier === 2 ? 0.96 : 0.93) * dyn;

    for (let i = 0; i < n; i++) {
      const at = start + i;
      if (at < 0 || at >= samples.length) continue;
      let g = baseG;
      if (i < fadeIn) {
        const u = i / fadeIn;
        g *= u * u * (3 - 2 * u); // smooth bow attack
      }
      if (i > n - fadeOut) g *= (n - i) / fadeOut;
      samples[at] += colored[i] * g;
    }
  });

  samples = addRoom(samples);
  console.log(`Mainardi human cello: Karoryfer音=${usedDry} FluidR3音=${usedFluid}`);
  return samples;
}

export function floatToWavBuffer(samples, sampleRate = SAMPLE_RATE) {
  let peak = 1e-6;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const norm = Math.min(1, 0.88 / peak);
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
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

export function encodeAudioPreview(wavPath, outPath) {
  // 大提琴感：保低中、壓 3–5k 尖刺，避免聽成小提琴
  spawnSync(
    ffmpegPath,
    [
      "-y",
      "-i",
      wavPath,
      "-af",
      "highpass=f=45,lowpass=f=5200,equalizer=f=120:width_type=o:width=1.2:g=4,equalizer=f=3500:width_type=o:width=1.4:g=-5,acompressor=threshold=-16dB:ratio=2.2:attack=25:release=220:makeup=1.5",
      "-codec:a",
      "aac",
      "-b:a",
      "192k",
      outPath,
    ],
    { encoding: "utf8" }
  );
}
