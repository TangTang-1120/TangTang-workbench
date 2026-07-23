/**
 * 从汤汤音色录音中识别 do re mi fa so la xi do，并导出标注样本
 *   node scripts/identify-solfege-from-voice.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICE = path.join(ROOT, "assets", "voice", "tangtang");
const SRC_WAV = path.join(VOICE, "source.wav");
const SRC_M4A = "/Users/tangtang/Downloads/汤汤音色.m4a";
const OUT_DIR = path.join(VOICE, "solfege");
const MAP_JSON = path.join(VOICE, "solfege-map.json");

const DEGREE_NAMES = ["do", "re", "mi", "fa", "so", "la", "xi", "do2"];
const DEGREE_ZH = {
  do: "哆",
  re: "来",
  mi: "咪",
  fa: "发",
  so: "索",
  la: "拉",
  xi: "西",
  do2: "哆↑",
};
const MAJOR_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12]; // semitones from do

function ensureSource() {
  fs.mkdirSync(VOICE, { recursive: true });
  if (!fs.existsSync(SRC_WAV)) {
    const r = spawnSync(
      ffmpegPath,
      ["-y", "-i", SRC_M4A, "-ac", "1", "-ar", "48000", SRC_WAV],
      { encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(r.stderr?.slice(-400) || "ffmpeg fail");
  }
}

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
  energy /= n;
  if (energy < 0.00035) return null;

  const minP = Math.floor(rate / 520);
  const maxP = Math.floor(rate / 120);
  let bestP = 0;
  let bestC = -1;
  // 步进加速
  for (let p = minP; p <= maxP; p++) {
    let c = 0;
    let e0 = 0;
    let e1 = 0;
    for (let i = 0; i < n - p; i += 3) {
      c += x[i] * x[i + p];
      e0 += x[i] * x[i];
      e1 += x[i + p] * x[i + p];
    }
    if (e0 < 1e-10 || e1 < 1e-10) continue;
    c /= Math.sqrt(e0 * e1);
    if (c > bestC) {
      bestC = c;
      bestP = p;
    }
  }
  if (!bestP || bestC < 0.5) return null;
  return { f0: rate / bestP, conf: Math.min(1, bestC), energy };
}

function midiOf(f0) {
  return 69 + 12 * Math.log2(f0 / 440);
}

function analyzeSegments(samples, rate) {
  const hop = Math.floor(rate * 0.02);
  const win = Math.floor(rate * 0.05);
  const frames = [];
  for (let i = 0; i + win < samples.length; i += hop) {
    const r = estimateF0(samples.subarray(i, i + win), rate);
    frames.push({
      t: i / rate,
      f0: r?.f0 ?? null,
      conf: r?.conf ?? 0,
      energy: r?.energy ?? 0,
    });
  }

  const segs = [];
  let cur = null;
  for (const fr of frames) {
    if (!fr.f0 || fr.conf < 0.55) {
      if (cur && cur.end - cur.start >= 0.15) segs.push(cur);
      cur = null;
      continue;
    }
    const midi = midiOf(fr.f0);
    if (!cur) {
      cur = {
        start: fr.t,
        end: fr.t + hop / rate,
        f0s: [fr.f0],
        midis: [midi],
        energy: fr.energy,
      };
      continue;
    }
    const med = cur.midis.slice().sort((a, b) => a - b)[Math.floor(cur.midis.length / 2)];
    if (Math.abs(midi - med) < 0.75 && fr.t - cur.end < 0.1) {
      cur.end = fr.t + hop / rate;
      cur.f0s.push(fr.f0);
      cur.midis.push(midi);
      cur.energy = Math.max(cur.energy, fr.energy);
    } else {
      if (cur.end - cur.start >= 0.15) segs.push(cur);
      cur = {
        start: fr.t,
        end: fr.t + hop / rate,
        f0s: [fr.f0],
        midis: [midi],
        energy: fr.energy,
      };
    }
  }
  if (cur && cur.end - cur.start >= 0.15) segs.push(cur);

  return segs.map((s) => {
    const f0 = s.f0s.reduce((a, b) => a + b, 0) / s.f0s.length;
    return {
      start: s.start,
      end: s.end,
      dur: s.end - s.start,
      f0,
      midi: midiOf(f0),
      energy: s.energy,
    };
  });
}

/** 从前段上行音阶提取 8 级：取上升过程中的稳定台阶 */
function extractAscendingScale(segs) {
  const early = segs
    .filter((s) => s.start < 11 && s.dur >= 0.14 && s.midi >= 55 && s.midi <= 72)
    .sort((a, b) => a.start - b.start);

  // 按时间合并连续同音（但单级最多保留 ~0.55s，避免拖进下一句）
  const steps = [];
  for (const s of early) {
    const last = steps[steps.length - 1];
    if (last && Math.abs(s.midi - last.midi) < 0.55) {
      if (last.dur < 0.55 && s.start - last.start < 0.55) {
        const newEnd = Math.min(s.end, last.start + 0.55);
        if (s.dur * s.energy > last.dur * last.energy * 0.8) {
          // 用更清晰的一段替换，仍限制长度
          const dur = Math.min(0.5, s.dur);
          steps[steps.length - 1] = {
            ...s,
            start: s.start,
            end: s.start + dur,
            dur,
          };
        } else {
          last.end = newEnd;
          last.dur = last.end - last.start;
        }
      }
      // 已够长则忽略后续同音
    } else {
      const dur = Math.min(0.55, s.dur);
      steps.push({ ...s, end: s.start + dur, dur });
    }
  }

  // 找最长的严格上行子序列（允许轻微回落 < 0.4 半音）
  let bestRun = [];
  for (let i = 0; i < steps.length; i++) {
    const run = [steps[i]];
    for (let j = i + 1; j < steps.length; j++) {
      const prev = run[run.length - 1];
      const cur = steps[j];
      const rise = cur.midi - prev.midi;
      if (rise >= 0.7 && rise <= 3.2) {
        run.push(cur);
      } else if (rise < -0.8) {
        // 明显下行，结束
        break;
      } else if (Math.abs(rise) < 0.7) {
        // 同级，保留更长
        if (cur.dur > prev.dur) run[run.length - 1] = cur;
      }
    }
    if (run.length > bestRun.length) bestRun = run;
  }

  return bestRun;
}

/** 把上行台阶按顺序直接映射为 do re mi fa so la xi (do2) */
function mapRunToDegrees(run) {
  if (run.length < 5) return null;
  // 取最清晰的最多 8 级（按时长*能量加权，保持时间序）
  const scored = run.map((s, i) => ({
    s,
    i,
    w: s.dur * (0.4 + s.energy * 30),
  }));
  // 若超过 8，去掉中间最弱的
  let keep = scored.slice();
  while (keep.length > 8) {
    // 不删头尾
    let minIdx = 1;
    for (let i = 1; i < keep.length - 1; i++) {
      if (keep[i].w < keep[minIdx].w) minIdx = i;
    }
    keep.splice(minIdx, 1);
  }
  keep.sort((a, b) => a.i - b.i);

  const assigned = Array(8).fill(null);
  for (let d = 0; d < Math.min(8, keep.length); d++) {
    assigned[d] = {
      degree: DEGREE_NAMES[d],
      seg: keep[d].s,
      dist: 0,
    };
  }

  // 根音 = 第一级
  const root = keep[0].s.midi;
  // 若只有 7 级，尝试在全曲补 do2 / xi
  return {
    root,
    total: keep.length * 2,
    hits: keep.length,
    assigned,
  };
}

/** 全曲为每个唱名挑最好样本（优先音阶拟合段，再全局补） */
function pickBestForDegrees(segs, root, preferred = {}) {
  const picks = {};
  for (let d = 0; d < 8; d++) {
    const name = DEGREE_NAMES[d];
    const target = root + MAJOR_OFFSETS[d];
    if (preferred[name]) {
      picks[name] = { ...preferred[name], targetMidi: target, score: 99 };
      continue;
    }
    let best = null;
    let bestScore = -1;
    for (const s of segs) {
      // 避免和已占用段重叠太多
      const occupied = Object.values(preferred).some(
        (p) => p && Math.abs(p.start - s.start) < 0.05
      );
      if (occupied) continue;
      const dist = Math.abs(s.midi - target);
      if (dist > 0.7) continue;
      const durScore = Math.min(s.dur, 0.85);
      const score = (1.05 - dist) * (0.45 + durScore) * (0.35 + s.energy * 22);
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    picks[name] = best
      ? { ...best, targetMidi: target, score: bestScore }
      : null;
  }
  return picks;
}

function exportClips(samples, rate, picks) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const exported = [];
  for (const name of DEGREE_NAMES) {
    const p = picks[name];
    if (!p) continue;
    // 每个唱名取清晰中段，最长 0.5s，避免拖到下一音
    const ideal = Math.min(0.5, Math.max(0.22, p.dur * 0.85));
    const mid = (p.start + p.end) / 2;
    let start = mid - ideal / 2;
    let end = mid + ideal / 2;
    start = Math.max(p.start + 0.03, start);
    end = Math.min(p.end - 0.02, end);
    if (end - start < 0.18) {
      start = p.start + 0.03;
      end = Math.min(p.end - 0.02, start + 0.45);
    }
    const i0 = Math.floor(Math.max(0, start) * rate);
    const i1 = Math.floor(Math.min(samples.length / rate, end) * rate);
    const clip = samples.subarray(i0, Math.max(i0 + 1, i1));
    const file = path.join(OUT_DIR, `${name}.wav`);
    writeWavMono(file, clip, rate);
    exported.push({
      id: name,
      solfege: DEGREE_ZH[name],
      file: `solfege/${name}.wav`,
      startSec: Math.round(start * 1000) / 1000,
      endSec: Math.round(end * 1000) / 1000,
      f0: Math.round(p.f0 * 10) / 10,
      midi: Math.round(p.midi * 100) / 100,
      targetMidi: Math.round(p.targetMidi * 100) / 100,
    });
  }

  // 高音 do：若原录音没有，用低音 do 升八度生成（标注 derived）
  if (!exported.find((x) => x.id === "do2") && exported.find((x) => x.id === "do")) {
    const doClip = readWavMono(path.join(OUT_DIR, "do.wav"));
    // 简单升八度：每 2 个采样取 1 个再插值拉回时长的一半反复
    const src = doClip.samples;
    const up = new Float32Array(src.length);
    for (let i = 0; i < up.length; i++) {
      const x = (i * 2) % (src.length - 1);
      const i0 = Math.floor(x);
      const t = x - i0;
      up[i] = src[i0] * (1 - t) + src[Math.min(src.length - 1, i0 + 1)] * t;
    }
    writeWavMono(path.join(OUT_DIR, "do2.wav"), up, doClip.rate);
    const doEnt = exported.find((x) => x.id === "do");
    exported.push({
      id: "do2",
      solfege: "哆↑",
      file: "solfege/do2.wav",
      startSec: doEnt.startSec,
      endSec: doEnt.endSec,
      f0: Math.round(doEnt.f0 * 2 * 10) / 10,
      midi: Math.round((doEnt.midi + 12) * 100) / 100,
      targetMidi: Math.round((doEnt.midi + 12) * 100) / 100,
      derived: "octave-up-from-do",
    });
  }
  return exported;
}

function noteName(midi) {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const m = Math.round(midi * 2) / 2; // 半音精度
  const rounded = Math.round(midi);
  const oct = Math.floor(rounded / 12) - 1;
  return `${names[((rounded % 12) + 12) % 12]}${oct}`;
}

ensureSource();
const { rate, samples } = readWavMono(SRC_WAV);
console.log(`分析音色: ${(samples.length / rate).toFixed(2)}s @ ${rate}Hz`);

const segs = analyzeSegments(samples, rate);
console.log(`检出稳定音段 ${segs.length} 个`);

const run = extractAscendingScale(segs);
console.log(
  `前段上行台阶 ${run.length} 级:`,
  run.map((s) => `${s.midi.toFixed(1)}@${s.start.toFixed(2)}s`).join(" → ")
);

const fit = mapRunToDegrees(run);
if (!fit || fit.hits < 5) {
  console.error("未能稳定识别出完整音阶，请确认录音里有唱 do-re-mi…");
  process.exit(1);
}

const root = fit.root;
const preferred = {};
for (const a of fit.assigned) {
  if (a) preferred[a.degree] = a.seg;
}

// 缺 xi / do2 时从后段补
if (!preferred.xi) {
  const target = root + 11;
  const cand = segs
    .filter((s) => s.start > 8 && Math.abs(s.midi - target) < 0.85)
    .sort((a, b) => b.dur * b.energy - a.dur * a.energy)[0];
  if (cand) preferred.xi = cand;
}
if (!preferred.do2) {
  const target = root + 12;
  const cand = segs
    .filter((s) => s.start > 7 && Math.abs(s.midi - target) < 0.9)
    .sort((a, b) => b.dur * b.energy - a.dur * a.energy)[0];
  // 也可接受略低的高八度附近
  const cand2 = segs
    .filter((s) => s.start > 7 && s.midi > root + 10.5 && s.midi < root + 13.5)
    .sort((a, b) => b.dur * b.energy - a.dur * a.energy)[0];
  preferred.do2 = cand || cand2 || null;
}

const picks = pickBestForDegrees(segs, root, preferred);
const exported = exportClips(samples, rate, picks);

const map = {
  label: "汤汤音色 · 唱名识别",
  source: "source.wav",
  detectedAt: new Date().toISOString(),
  scale: {
    doMidi: Math.round(root * 100) / 100,
    doNote: noteName(root),
    mode: "major",
    fitHits: fit.hits,
    fitScore: Math.round(fit.total * 100) / 100,
  },
  degrees: exported,
};

fs.writeFileSync(MAP_JSON, JSON.stringify(map, null, 2));

console.log("\n======== 识别结果 ========");
console.log(`调性根音 do ≈ ${map.scale.doNote} (midi ${map.scale.doMidi})`);
console.log("");
for (const name of DEGREE_NAMES) {
  const d = exported.find((x) => x.id === name);
  if (!d) {
    console.log(`  ${DEGREE_ZH[name].padEnd(3)} (${name})  ✗ 未找到`);
    continue;
  }
  console.log(
    `  ${DEGREE_ZH[name]}  ${name.padEnd(3)}  ${d.startSec.toFixed(2)}–${d.endSec.toFixed(2)}s  f0=${d.f0}Hz  ≈${noteName(d.midi)}`
  );
}
console.log("\n已导出:");
console.log(`  ${MAP_JSON}`);
console.log(`  ${OUT_DIR}/do.wav … do2.wav`);

// 拼一条试听：do re mi fa so la xi do
const concatList = path.join(OUT_DIR, "concat.txt");
const lines = [];
for (const name of DEGREE_NAMES) {
  const f = path.join(OUT_DIR, `${name}.wav`);
  if (fs.existsSync(f)) lines.push(`file '${f.replace(/'/g, "'\\''")}'`);
}
fs.writeFileSync(concatList, lines.join("\n"));
const preview = path.join(VOICE, "solfege-preview.wav");
const r = spawnSync(
  ffmpegPath,
  ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", preview],
  { encoding: "utf8" }
);
if (r.status === 0) {
  const desk = path.join(process.env.HOME || "", "Desktop", "汤汤音色-唱名识别试听.wav");
  fs.copyFileSync(preview, desk);
  console.log(`\n试听（按 do→do 拼接）:\n  ${desk}`);
}
