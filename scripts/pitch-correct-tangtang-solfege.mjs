/**
 * 修音：把汤汤唱名样本拉到标准 C 大调音高（平均律）
 *   node scripts/pitch-correct-tangtang-solfege.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICE = path.join(ROOT, "assets/voice/tangtang");
const MAP_JSON = path.join(VOICE, "solfege-map.json");
const OUT_DIR = path.join(VOICE, "solfege");

/** C 大调：哆=C4 … 哆↑=C5 */
const TARGETS = {
  do: { midi: 60, note: "C4", solfege: "哆" },
  re: { midi: 62, note: "D4", solfege: "来" },
  mi: { midi: 64, note: "E4", solfege: "咪" },
  fa: { midi: 65, note: "F4", solfege: "发" },
  so: { midi: 67, note: "G4", solfege: "索" },
  la: { midi: 69, note: "A4", solfege: "拉" },
  xi: { midi: 71, note: "B4", solfege: "西" },
  do2: { midi: 72, note: "C5", solfege: "哆↑" },
};

function readWavMono(file) {
  const buf = fs.readFileSync(file);
  const rate = buf.readUInt32LE(24);
  const ch = buf.readUInt16LE(22);
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
  const n = Math.floor((buf.length - dataOffset) / 2 / ch);
  const samples = new Float32Array(n);
  for (let i = 0, s = 0; i < n; i++) {
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
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const g = peak > 1e-6 ? 0.92 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * g));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function estimateF0(seg, rate) {
  const n = seg.length;
  if (n < rate * 0.05) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += seg[i];
  mean /= n;
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = seg[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy / n < 1e-4) return null;
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
    if (e0 < 1e-12 || e1 < 1e-12) continue;
    c /= Math.sqrt(e0 * e1);
    if (c > bestC) {
      bestC = c;
      bestP = p;
    }
  }
  if (!bestP || bestC < 0.45) return null;
  return rate / bestP;
}

/** 变调：ratio = targetF0/srcF0（>1 升调，输出变短） */
function pitchShift(samples, srcRate, srcF0, targetF0) {
  const ratio = targetF0 / srcF0;
  const outLen = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return { samples: out, rate: srcRate };
}

function main() {
  if (!fs.existsSync(MAP_JSON)) {
    throw new Error("缺少 solfege-map.json，请先跑 identify-solfege-from-voice.mjs");
  }
  const map = JSON.parse(fs.readFileSync(MAP_JSON, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 备份未修音样本
  const bakDir = path.join(VOICE, "solfege-raw");
  if (!fs.existsSync(bakDir)) {
    fs.mkdirSync(bakDir, { recursive: true });
    for (const d of map.degrees) {
      const src = path.join(VOICE, d.file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(bakDir, path.basename(d.file)));
      }
    }
    console.log("已备份原样本 →", bakDir);
  }

  const degrees = [];
  console.log("======== 修音到 C 大调 ========");
  for (const d of map.degrees) {
    const id = d.id;
    const target = TARGETS[id];
    if (!target) {
      degrees.push(d);
      continue;
    }
    const rawPath = path.join(bakDir, path.basename(d.file));
    const srcPath = fs.existsSync(rawPath) ? rawPath : path.join(VOICE, d.file);
    const { rate, samples } = readWavMono(srcPath);
    const measured =
      estimateF0(samples, rate) || d.f0 || midiToFreq(d.midi || target.midi);
    const beforeMidi = 69 + 12 * Math.log2(measured / 440);
    const shifted = pitchShift(samples, rate, measured, midiToFreq(target.midi));
    const outFile = path.join(OUT_DIR, `${id}.wav`);
    writeWavMono(outFile, shifted.samples, shifted.rate);
    const afterF0 =
      estimateF0(shifted.samples, shifted.rate) || midiToFreq(target.midi);
    const afterMidi = 69 + 12 * Math.log2(afterF0 / 440);
    console.log(
      `${target.solfege.padEnd(3)} ${id.padEnd(4)}  ${beforeMidi.toFixed(2)} → ${target.midi} (${target.note})  实测修后 ${afterMidi.toFixed(2)}`
    );
    degrees.push({
      id,
      solfege: target.solfege,
      file: `solfege/${id}.wav`,
      startSec: d.startSec,
      endSec: d.endSec,
      f0: Math.round(midiToFreq(target.midi) * 10) / 10,
      midi: target.midi,
      targetMidi: target.midi,
      note: target.note,
      pitchCorrected: true,
      srcF0: Math.round(measured * 10) / 10,
      srcMidi: Math.round(beforeMidi * 100) / 100,
    });
  }

  const next = {
    ...map,
    label: "汤汤音色 · C大调修音",
    correctedAt: new Date().toISOString(),
    scale: {
      doMidi: 60,
      doNote: "C4",
      mode: "major",
      temperament: "equal",
      fitHits: 8,
      fitScore: 8,
    },
    degrees,
  };
  fs.writeFileSync(MAP_JSON, JSON.stringify(next, null, 2), "utf8");

  // 试听：按修音后顺序拼接
  const chunks = [];
  let rate = 48000;
  for (const id of ["do", "re", "mi", "fa", "so", "la", "xi", "do2"]) {
    const p = path.join(OUT_DIR, `${id}.wav`);
    if (!fs.existsSync(p)) continue;
    const w = readWavMono(p);
    rate = w.rate;
    chunks.push(w.samples);
    chunks.push(new Float32Array(Math.floor(rate * 0.12)));
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  const preview = path.join(
    process.env.HOME || VOICE,
    "Desktop",
    "汤汤音色-C大调修音试听.wav"
  );
  writeWavMono(preview, all, rate);
  writeWavMono(path.join(VOICE, "solfege-preview.wav"), all, rate);
  console.log("\n试听 →", preview);
  console.log("map →", MAP_JSON);
}

main();
