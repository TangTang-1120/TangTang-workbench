/**
 * 从「汤汤音色」录音提取可复用的歌声颗粒，供唱名跟唱合成。
 * 用法：
 *   node scripts/build-tangtang-voicebank.mjs [m4a或wav路径]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "assets", "voice", "tangtang");
const SRC_WAV = path.join(OUT_DIR, "source.wav");
const BANK_JSON = path.join(OUT_DIR, "bank.json");
const GRAINS_DIR = path.join(OUT_DIR, "grains");

const RATE = 48000;
const GRAIN_MS = 380;

function readWavMono(file) {
  const buf = fs.readFileSync(file);
  const rate = buf.readUInt32LE(24);
  const ch = buf.readUInt16LE(22);
  const bps = buf.readUInt16LE(34);
  if (bps !== 16) throw new Error(`需要 16-bit PCM，收到 ${bps}`);
  let dataOffset = 12;
  while (dataOffset < buf.length - 8) {
    const id = buf.toString("ascii", dataOffset, dataOffset + 4);
    const size = buf.readUInt32LE(dataOffset + 4);
    if (id === "data") {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + size;
  }
  const samples = new Float32Array((buf.length - dataOffset) / 2 / ch);
  for (let i = 0, s = 0; i < samples.length; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) {
      acc += buf.readInt16LE(dataOffset + s) / 32768;
      s += 2;
    }
    samples[i] = acc / ch;
  }
  return { rate, samples };
}

function writeWavMono(file, samples, rate) {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function estimateF0(seg, rate) {
  const n = seg.length;
  if (n < rate * 0.08) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += seg[i];
  mean /= n;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = seg[i] - mean;
  // 人声跟唱常用区：约 120–520 Hz（避开过低的次谐波）
  const minP = Math.floor(rate / 520);
  const maxP = Math.floor(rate / 120);
  let bestP = 0;
  let bestC = -1;
  for (let p = minP; p <= maxP; p++) {
    let c = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n - p; i += 2) {
      c += x[i] * x[i + p];
      e0 += x[i] * x[i];
      e1 += x[i + p] * x[i + p];
    }
    if (e0 <= 1e-8 || e1 <= 1e-8) continue;
    c /= Math.sqrt(e0 * e1);
    if (c > bestC) {
      bestC = c;
      bestP = p;
    }
  }
  if (!bestP || bestC < 0.45) return null;
  return { f0: rate / bestP, conf: Math.min(1, bestC) };
}

function rms(seg) {
  let e = 0;
  for (let i = 0; i < seg.length; i++) e += seg[i] * seg[i];
  return Math.sqrt(e / Math.max(1, seg.length));
}

function ensureSourceWav(inputPath) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (inputPath) {
    const abs = path.resolve(inputPath);
    if (!fs.existsSync(abs)) throw new Error(`找不到音色文件: ${abs}`);
    const r = spawnSync(
      ffmpegPath,
      ["-y", "-i", abs, "-ac", "1", "-ar", String(RATE), SRC_WAV],
      { encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(r.stderr?.slice(-500) || "ffmpeg 失败");
  } else if (!fs.existsSync(SRC_WAV)) {
    throw new Error("请提供 m4a/wav，或先把 assets/voice/tangtang/source.wav 准备好");
  }
}

function buildBank() {
  const { rate, samples } = readWavMono(SRC_WAV);
  const hop = Math.floor(rate * 0.04);
  const win = Math.floor(rate * (GRAIN_MS / 1000));
  const candidates = [];

  for (let i = 0; i + win < samples.length; i += hop) {
    const seg = samples.subarray(i, i + win);
    const energy = rms(seg);
    if (energy < 0.02) continue;
    const f = estimateF0(seg, rate);
    if (!f) continue;
    candidates.push({
      start: i,
      energy,
      f0: f.f0,
      conf: f.conf,
    });
  }

  candidates.sort((a, b) => b.energy * b.conf - a.energy * a.conf);

  // 按音高分桶，每桶取最好的一粒
  const buckets = new Map();
  for (const c of candidates) {
    const midi = Math.round(69 + 12 * Math.log2(c.f0 / 440));
    const key = midi;
    const prev = buckets.get(key);
    if (!prev || c.energy * c.conf > prev.energy * prev.conf) {
      buckets.set(key, c);
    }
  }

  let grains = [...buckets.values()]
    .sort((a, b) => a.f0 - b.f0)
    .slice(0, 12);

  if (grains.length < 3) {
    grains = candidates.slice(0, 8);
  }

  fs.rmSync(GRAINS_DIR, { recursive: true, force: true });
  fs.mkdirSync(GRAINS_DIR, { recursive: true });

  const bankGrains = grains.map((g, idx) => {
    const seg = samples.subarray(g.start, g.start + win);
    // fade edges
    const fade = Math.floor(rate * 0.012);
    const out = new Float32Array(seg.length);
    for (let i = 0; i < seg.length; i++) {
      let env = 1;
      if (i < fade) env = i / fade;
      else if (i > seg.length - fade) env = (seg.length - i) / fade;
      out[i] = seg[i] * env;
    }
    // normalize
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 1e-6) {
      const gain = 0.9 / peak;
      for (let i = 0; i < out.length; i++) out[i] *= gain;
    }
    const name = `grain-${String(idx).padStart(2, "0")}.wav`;
    writeWavMono(path.join(GRAINS_DIR, name), out, rate);
    return {
      file: `grains/${name}`,
      f0: Math.round(g.f0 * 100) / 100,
      midi: Math.round(69 + 12 * Math.log2(g.f0 / 440)),
      energy: Math.round(g.energy * 10000) / 10000,
      conf: Math.round(g.conf * 1000) / 1000,
      startSec: Math.round((g.start / rate) * 1000) / 1000,
    };
  });

  const bank = {
    name: "tangtang",
    label: "汤汤音色",
    source: "source.wav",
    sampleRate: rate,
    grainMs: GRAIN_MS,
    createdAt: new Date().toISOString(),
    grains: bankGrains,
  };
  fs.writeFileSync(BANK_JSON, JSON.stringify(bank, null, 2));
  console.log(`音色库已写入 ${BANK_JSON}`);
  console.log(`颗粒 ${bankGrains.length} 个：`);
  for (const g of bankGrains) {
    console.log(`  midi≈${g.midi}  f0=${g.f0}Hz  conf=${g.conf}  @${g.startSec}s`);
  }
  return bank;
}

const input = process.argv[2] || "/Users/tangtang/Downloads/汤汤音色.m4a";
ensureSourceWav(input);
buildBank();
