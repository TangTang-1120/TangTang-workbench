/**
 * 用已识别的 do/re/mi/fa/so/la/xi 样本重唱《好久不见》
 * 时间轴与 pair-engine 完全一致（countIn = 1 小节）
 *   node scripts/demo-tangtang-voice-haojiu.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import toneMidi from "@tonejs/midi";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";

const { Midi } = toneMidi;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOICE = path.join(ROOT, "assets", "voice", "tangtang");
const SOLFEGE_MAP = path.join(VOICE, "solfege-map.json");
const JOB = path.join(ROOT, "output", "jobs", "hao-jiu-bu-jian");
const SCORE_XML = path.join(JOB, "score.musicxml");
const VIDEO_IN = path.join(JOB, "唱音阶.mp4");
const CELLO_WAV = path.join(JOB, "stems", "大提琴.wav");
const OUT_DIR = path.join(ROOT, "output", "voice-demo");
const OUT_WAV = path.join(OUT_DIR, "hao-jiu-bu-jian-tangtang-voice.wav");
const OUT_MP4 = path.join(OUT_DIR, "hao-jiu-bu-jian-tangtang-voice.mp4");
const DESKTOP = path.join(
  process.env.HOME || "",
  "Desktop",
  "好久不见-汤汤音色跟唱样片.mp4"
);

const RATE = 44100;
const FORCE_BPM = 72;
const SING_OCTAVE_UP = 12;
/** 整体再抬高一点（用户反馈偏低） */
const PITCH_LIFT_SEMITONES = 4;
/** 交叠缩短，避免字糊在一起 */
const LEGATO_MS = 35;

/** 唱名共振峰：拉开哆来咪发索拉西听感 */
const SOLFEGE_FORMANTS = {
  哆: { f: [500, 920, 2550], bw: [60, 80, 120], bright: 0.42, cons: 0.5, consMs: 38 },
  来: { f: [740, 1350, 2480], bw: [70, 95, 130], bright: 0.55, cons: 0.62, consMs: 42 },
  咪: { f: [300, 2250, 3050], bw: [50, 100, 140], bright: 0.7, cons: 0.4, consMs: 28 },
  发: { f: [800, 1250, 2400], bw: [75, 95, 130], bright: 0.6, cons: 0.85, consMs: 48 },
  索: { f: [520, 950, 2600], bw: [60, 85, 125], bright: 0.45, cons: 0.9, consMs: 50 },
  拉: { f: [780, 1280, 2500], bw: [70, 95, 130], bright: 0.58, cons: 0.65, consMs: 40 },
  西: { f: [290, 2200, 3150], bw: [45, 105, 145], bright: 0.72, cons: 0.55, consMs: 32 },
};

const SOLFEGE_ZH = {
  0: "哆",
  1: "哆",
  2: "来",
  3: "来",
  4: "咪",
  5: "发",
  6: "发",
  7: "索",
  8: "索",
  9: "拉",
  10: "拉",
  11: "西",
};
const ZH_TO_ID = {
  哆: "do",
  来: "re",
  咪: "mi",
  发: "fa",
  索: "so",
  拉: "la",
  西: "xi",
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

function writeWavMono(file, samples, rate = RATE) {
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
  const norm = peak > 1e-6 ? 0.94 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function resampleLinear(src, srcRate, dstRate, ratio) {
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const pitched = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = x - i0;
    pitched[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  if (srcRate === dstRate) return pitched;
  const converted = new Float32Array(
    Math.max(1, Math.floor((pitched.length * dstRate) / srcRate))
  );
  for (let i = 0; i < converted.length; i++) {
    const x = (i * srcRate) / dstRate;
    const i0 = Math.floor(x);
    const i1 = Math.min(pitched.length - 1, i0 + 1);
    const t = x - i0;
    converted[i] = pitched[i0] * (1 - t) + pitched[i1] * t;
  }
  return converted;
}

function loopFill(pitched, n) {
  const out = new Float32Array(n);
  if (pitched.length < 16) return out;
  const a = Math.floor(pitched.length * 0.1);
  const b = Math.floor(pitched.length * 0.9);
  const body = pitched.subarray(a, Math.max(a + 24, b));
  const fade = Math.min(40, Math.floor(body.length / 5));
  const hop = Math.max(18, body.length - fade);
  for (let pos = 0; pos < n; pos += hop) {
    for (let i = 0; i < body.length && pos + i < n; i++) {
      let w = 1;
      if (i < fade) w = i / fade;
      else if (i > body.length - fade) w = (body.length - i) / fade;
      out[pos + i] += body[i] * w;
    }
  }
  return out;
}

async function buildExactTimeline() {
  const VerovioModule = await createVerovioModule();
  const tk = new VerovioToolkit(VerovioModule);
  let xml = fs.readFileSync(SCORE_XML, "utf8");
  // 与 pair-engine 一样强制 72
  if (!/<per-minute>/i.test(xml)) {
    xml = xml.replace(
      /(<measure[^>]*number="1"[^>]*>)/i,
      `$1
      <direction placement="above">
        <direction-type>
          <metronome>
            <beat-unit>quarter</beat-unit>
            <per-minute>${FORCE_BPM}</per-minute>
          </metronome>
        </direction-type>
        <sound tempo="${FORCE_BPM}"/>
      </direction>`
    );
  }
  tk.setOptions({
    pageWidth: 1350,
    pageHeight: 2200,
    scale: 48,
    adjustPageHeight: true,
    footer: "none",
    header: "none",
  });
  if (!tk.loadData(xml)) throw new Error("MusicXML 加载失败");
  tk.redoLayout();
  const b64 = tk.renderToMIDI();
  const raw = b64.includes(",") ? b64.split(",")[1] : b64;
  const midi = new Midi(Buffer.from(raw, "base64"));

  const srcTempo = midi.header.tempos[0]?.bpm || FORCE_BPM;
  const scale = srcTempo / FORCE_BPM;
  const beatMs = 60000 / FORCE_BPM;
  const ts = midi.header.timeSignatures?.[0];
  const beatsPerBar = ts?.timeSignature?.[0] || ts?.beats || 4;
  const notes = [];
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        startMs: n.time * 1000 * scale,
        durationMs: Math.max(90, n.duration * 1000 * scale),
        solfege: SOLFEGE_ZH[((n.midi % 12) + 12) % 12],
      });
    }
  }
  notes.sort((a, b) => a.startMs - b.startMs || b.durationMs - a.durationMs);
  const scoreEndMs = Math.max(...notes.map((n) => n.startMs + n.durationMs));
  const countInMs = beatMs * beatsPerBar;
  return { notes, scoreEndMs, countInMs, beatMs, beatsPerBar };
}

function loadSolfegeBank() {
  const map = JSON.parse(fs.readFileSync(SOLFEGE_MAP, "utf8"));
  const byId = {};
  for (const d of map.degrees) {
    const { rate, samples } = readWavMono(path.join(VOICE, d.file));
    byId[d.id] = { ...d, rate, samples };
  }
  return { map, byId };
}

function makeResonator(freq, bw) {
  const r = Math.exp((-Math.PI * bw) / RATE);
  const cosT = 2 * r * Math.cos((2 * Math.PI * freq) / RATE);
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

/** 只循环母音中段，保留字头 */
function vowelLoop(pitched, n, headKeep) {
  const out = new Float32Array(n);
  if (pitched.length < 24) return out;
  // 先放入真实字头（吐字关键）
  const head = Math.min(headKeep, pitched.length, n);
  for (let i = 0; i < head; i++) out[i] = pitched[i];

  if (n <= head) return out;

  // 母音体：避开头尾
  const a = Math.floor(pitched.length * 0.28);
  const b = Math.floor(pitched.length * 0.82);
  const body = pitched.subarray(a, Math.max(a + 32, b));
  const fade = Math.min(36, Math.floor(body.length / 6));
  const hop = Math.max(16, body.length - fade);
  for (let pos = head - fade; pos < n; pos += hop) {
    for (let i = 0; i < body.length && pos + i < n; i++) {
      if (pos + i < 0) continue;
      let w = 1;
      if (i < fade) w = i / fade;
      else if (i > body.length - fade) w = (body.length - i) / fade;
      // 字头区以原样为主，循环只淡入补足
      const idx = pos + i;
      if (idx < head) out[idx] += body[i] * w * 0.25;
      else out[idx] += body[i] * w;
    }
  }
  return out;
}

function pickSample(byId, solfegeZh, targetMidi) {
  const id = ZH_TO_ID[solfegeZh] || "do";
  if (id === "do" && byId.do2) {
    if (Math.abs(targetMidi - byId.do2.midi) < Math.abs(targetMidi - byId.do.midi)) {
      return byId.do2;
    }
  }
  return byId[id] || byId.do;
}

/**
 * 吐字优先：保留样本字头 + 唱名共振峰 + 清晰字头爆破
 */
function renderSyllable(sample, solfegeZh, targetFreq, durationMs) {
  const cfg = SOLFEGE_FORMANTS[solfegeZh] || SOLFEGE_FORMANTS["哆"];
  const n = Math.max(1, Math.floor((durationMs / 1000) * RATE));
  const ratio = sample.f0 / targetFreq;
  const pitched = resampleLinear(sample.samples, sample.rate, RATE, ratio);

  // 字头保留约 90–130ms（随辅音强度）
  const headKeep = Math.min(
    pitched.length,
    Math.floor(((cfg.consMs + 55) / 1000) * RATE)
  );
  const voice = vowelLoop(pitched, n, headKeep);

  const resonators = cfg.f.map((f, i) => makeResonator(f, cfg.bw[i]));
  const consN = Math.floor((cfg.consMs / 1000) * RATE);
  const attack = Math.floor(0.012 * RATE);
  const release = Math.min(Math.floor(0.05 * RATE), Math.floor(n * 0.16));
  const out = new Float32Array(n);

  let phase = 0;
  const twoPi = 2 * Math.PI;
  const harms = [1.0, 0.4, 0.18, 0.08];

  for (let i = 0; i < n; i++) {
    // 音头微上滑，增强起音感
    const scoop = i < consN ? 1 + (1 - i / consN) * 0.035 : 1;
    phase += (twoPi * targetFreq * scoop) / RATE;
    if (phase > twoPi) phase -= twoPi * Math.floor(phase / twoPi);

    let buzz = 0;
    for (let h = 0; h < harms.length; h++) buzz += Math.sin(phase * (h + 1)) * harms[h];
    buzz /= 1.7;

    // 字头：摩擦/爆破噪声（发、索更重）
    if (i < consN) {
      const t = i / consN;
      const noise =
        (Math.random() * 2 - 1) * Math.pow(1 - t, 0.7) * (0.28 + cfg.cons * 0.45);
      buzz = buzz * (0.2 + 0.8 * t) + noise;
    }

    let formant = 0;
    for (const r of resonators) formant += r(buzz);
    formant *= 0.26 + cfg.bright * 0.28;

    // 字头偏样本原声，母音段样本+共振峰更清晰
    const headBlend = i < headKeep ? 0.92 : 0.7;
    const formantBlend = i < headKeep ? 0.35 : 0.65;
    let y = voice[i] * headBlend + formant * formantBlend;

    let env = 1;
    if (i < attack) env = Math.pow(i / Math.max(1, attack), 0.55);
    else if (i > n - release) env = (n - i) / release;

    // 字头加重，后面略收，避免糊成一片
    const punch = i < consN ? 1.35 : i < headKeep ? 1.12 : 0.92;
    out[i] = y * env * punch;
  }
  return out;
}

function addInto(dest, src, at) {
  for (let i = 0; i < src.length; i++) {
    const idx = at + i;
    if (idx >= 0 && idx < dest.length) dest[idx] += src[i];
  }
}

function renderVoice(notes, countInMs, scoreEndMs, byId) {
  const totalMs = countInMs + scoreEndMs + 1000;
  const n = Math.ceil((totalMs / 1000) * RATE);
  const out = new Float32Array(n);
  const used = {};

  for (const note of notes) {
    const targetMidi = note.midi + SING_OCTAVE_UP + PITCH_LIFT_SEMITONES;
    const sample = pickSample(byId, note.solfege, targetMidi);
    used[sample.id] = (used[sample.id] || 0) + 1;
    // 略短于原时值，字与字分开一点，吐字更清
    const dur = Math.max(110, note.durationMs * 0.88 + LEGATO_MS);
    const syl = renderSyllable(
      sample,
      note.solfege,
      midiToFreq(targetMidi),
      dur
    );
    const start = Math.floor(((note.startMs + countInMs) / 1000) * RATE);
    addInto(out, syl, start);
  }

  console.log(
    "样本用量",
    Object.entries(used)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")
  );
  return { out, totalMs };
}

function mixTracks(a, b, ga, gb) {
  const len = Math.max(a.length, b.length);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = (a[i] || 0) * ga + (b[i] || 0) * gb;
  return out;
}

async function main() {
  if (!fs.existsSync(VIDEO_IN)) throw new Error(`缺少视频 ${VIDEO_IN}`);
  if (!fs.existsSync(SOLFEGE_MAP)) {
    throw new Error("请先: node scripts/identify-solfege-from-voice.mjs");
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { map, byId } = loadSolfegeBank();
  const timeline = await buildExactTimeline();
  console.log(
    `时间轴: countIn=${timeline.countInMs.toFixed(0)}ms (${timeline.beatsPerBar}/4 @72) scoreEnd=${timeline.scoreEndMs.toFixed(0)}ms notes=${timeline.notes.length}`
  );
  console.log(`唱名库 do≈${map.scale.doNote}`);

  const { out: voice, totalMs } = renderVoice(
    timeline.notes,
    timeline.countInMs,
    timeline.scoreEndMs,
    byId
  );

  // 校验：第一音应落在 countIn 处
  const firstAt = timeline.countInMs / 1000;
  console.log(`第一音对齐 @ ${firstAt.toFixed(3)}s（原版能量起音约 3.36s）`);

  let mixed = voice;
  if (process.env.SKIP_CELLO !== "1" && fs.existsSync(CELLO_WAV)) {
    const cello = readWavMono(CELLO_WAV);
    let c = cello.samples;
    if (cello.rate !== RATE) c = resampleLinear(c, cello.rate, RATE, 1);
    // 对齐长度
    if (c.length > mixed.length) c = c.subarray(0, mixed.length);
    mixed = mixTracks(mixed, c, 1.22, 0.08);
  } else {
    for (let i = 0; i < mixed.length; i++) mixed[i] = Math.max(-1, Math.min(1, mixed[i] * 1.2));
  }

  writeWavMono(OUT_WAV, mixed, RATE);

  // 校验 onset
  {
    const { samples } = readWavMono(OUT_WAV);
    const win = Math.floor(RATE * 0.02);
    let onset = null;
    for (let i = 0; i < samples.length - win; i += win) {
      let e = 0;
      for (let k = 0; k < win; k++) e += samples[i + k] * samples[i + k];
      if (e / win > 0.0004) {
        onset = i / RATE;
        break;
      }
    }
    console.log(`新音轨起音 @ ${onset?.toFixed(3)}s`);
  }

  const r = spawnSync(
    ffmpegPath,
    [
      "-y",
      "-i",
      VIDEO_IN,
      "-i",
      OUT_WAV,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      OUT_MP4,
    ],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-800));
    process.exit(1);
  }

  fs.copyFileSync(OUT_MP4, DESKTOP);
  fs.copyFileSync(
    OUT_MP4,
    path.join(ROOT, "output", "gallery", "hao-jiu-bu-jian", "solfege-tangtang-voice.mp4")
  );
  console.log("✅ 已重做并对齐:", DESKTOP);
  console.log(`   (totalMs≈${totalMs.toFixed(0)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
