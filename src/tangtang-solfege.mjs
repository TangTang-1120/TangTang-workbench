/**
 * 汤汤唱名跟唱：用修音后的 C 大调切段
 * —— 音高拉到十二平均律；不母音循环（避免「含口水」感）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TANGTANG_VOICE_DIR = path.join(ROOT, "assets/voice/tangtang");
const SOLFEGE_MAP = path.join(TANGTANG_VOICE_DIR, "solfege-map.json");
const RAW_DIR = path.join(TANGTANG_VOICE_DIR, "solfege-raw");
const CORRECTED_DIR = path.join(TANGTANG_VOICE_DIR, "solfege");

const ZH_TO_ID = {
  哆: "do",
  升哆: "do",
  来: "re",
  升来: "re",
  咪: "mi",
  发: "fa",
  升发: "fa",
  索: "so",
  升索: "so",
  拉: "la",
  升拉: "la",
  西: "xi",
  空: "do",
  空空: "do",
};

/** 拍数口唱样本（画面写 234，口唱 二三四五） */
const COUNTS_DIR = path.join(TANGTANG_VOICE_DIR, "counts");

export function heldBeatCount(durationMs, beatMs) {
  if (!beatMs || beatMs <= 0) return 1;
  return Math.max(1, Math.round(durationMs / beatMs));
}

/** 画面标签：哆 / 哆23 / 哆234 */
export function solfegeBeatLabel(solfege, beats) {
  if (!beats || beats <= 1) return solfege || "";
  let s = solfege || "";
  for (let b = 2; b <= beats; b++) s += String(b);
  return s;
}

let _bank = null;
let _countBank = null;

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

export function hasTangtangSolfegeBank() {
  return fs.existsSync(SOLFEGE_MAP);
}

export function clearTangtangBankCache() {
  _bank = null;
  _countBank = null;
}

function loadCountBank() {
  if (_countBank) return _countBank;
  const byDigit = {};
  for (let d = 2; d <= 8; d++) {
    const file = path.join(COUNTS_DIR, `${d}.wav`);
    if (!fs.existsSync(file)) continue;
    byDigit[d] = readWavMono(file);
  }
  _countBank = byDigit;
  return _countBank;
}

/** 口唱拍数 2/3/4…（清晰数字语音） */
function renderDigitSpeech(digit, durationMs, rate) {
  const bank = loadCountBank();
  const sample = bank[digit];
  if (!sample) return null;
  const n = Math.max(1, Math.floor((durationMs / 1000) * rate));
  const pitched = resampleLinear(sample.samples, sample.rate, rate, 1);
  const out = new Float32Array(n);
  const use = Math.min(pitched.length, n);
  const attack = Math.floor(0.008 * rate);
  const release = Math.min(Math.floor(0.04 * rate), Math.floor(n * 0.2));
  for (let i = 0; i < use; i++) {
    let env = 1;
    if (i < attack) env = i / Math.max(1, attack);
    else if (i > use - release) env = (use - i) / Math.max(1, release);
    out[i] = pitched[i] * env * 1.05;
  }
  return out;
}

/** 优先用修音版（solfege/），没有才退回原切 */
function resolveSampleFile(degree) {
  const id = degree.id;
  const mapped = path.join(TANGTANG_VOICE_DIR, degree.file);
  if (fs.existsSync(mapped)) return { file: mapped, fromRaw: false };
  const corrected = path.join(CORRECTED_DIR, `${id}.wav`);
  if (fs.existsSync(corrected)) return { file: corrected, fromRaw: false };
  const raw = path.join(RAW_DIR, `${id}.wav`);
  if (fs.existsSync(raw)) return { file: raw, fromRaw: true };
  return null;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function loadTangtangSolfegeBank() {
  if (_bank) return _bank;
  if (!fs.existsSync(SOLFEGE_MAP)) return null;
  const map = JSON.parse(fs.readFileSync(SOLFEGE_MAP, "utf8"));
  const byId = {};
  for (const d of map.degrees) {
    const resolved = resolveSampleFile(d);
    if (!resolved) continue;
    const { rate, samples } = readWavMono(resolved.file);
    // 修音版：对准律上的 target；原切才用实测 src
    const naturalMidi = resolved.fromRaw
      ? d.srcMidi ?? d.midi ?? d.targetMidi ?? 60
      : d.targetMidi ?? d.midi ?? 60;
    const naturalF0 = resolved.fromRaw
      ? d.srcF0 ?? d.f0 ?? midiToFreq(naturalMidi)
      : d.f0 || midiToFreq(naturalMidi);
    byId[d.id] = {
      ...d,
      rate,
      samples,
      fromRaw: resolved.fromRaw,
      midi: naturalMidi,
      f0: naturalF0,
    };
  }
  if (!byId.do) return null;
  _bank = { map, byId, useRaw: false };
  return _bank;
}

/** 把谱面音高挪到最接近样本原音高的八度，变调幅度最小 */
function nearestOctaveMidi(targetMidi, sampleMidi) {
  let best = targetMidi;
  let bestDist = Math.abs(targetMidi - sampleMidi);
  for (const oct of [-24, -12, 0, 12, 24]) {
    const cand = targetMidi + oct;
    const d = Math.abs(cand - sampleMidi);
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

function resampleLinear(src, srcRate, dstRate, pitchRatio) {
  const outLen = Math.max(1, Math.floor(src.length / pitchRatio));
  const pitched = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const x = i * pitchRatio;
    const i0 = Math.floor(x);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const t = x - i0;
    pitched[i] = src[i0] * (1 - t) + src[i1] * t;
  }
  if (Math.abs(srcRate - dstRate) < 1) return pitched;
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

function pickSample(byId, solfegeZh, targetMidi) {
  const id = ZH_TO_ID[solfegeZh] || "do";
  if (id === "do" && byId.do2) {
    const d0 = Math.abs(targetMidi - (byId.do.midi || 60));
    const d2 = Math.abs(targetMidi - (byId.do2.midi || 72));
    if (d2 < d0) return byId.do2;
  }
  return byId[id] || byId.do;
}

/**
 * 播修音切段：对准谱面音高，但不母音循环（避免含糊）。
 * 半音差 < 约 15¢ 时不再二次拉音。
 */
function renderFromSample(sample, targetMidi, durationMs, rate) {
  const srcF0 = sample.f0 || midiToFreq(sample.midi || 60);
  const targetF0 = midiToFreq(targetMidi);
  let ratio = targetF0 / srcF0;
  if (Math.abs(Math.log2(ratio)) < 15 / 1200) ratio = 1;

  const pitched = resampleLinear(sample.samples, sample.rate, rate, ratio);
  const want = Math.max(1, Math.floor((durationMs / 1000) * rate));
  const n = Math.min(want, pitched.length);
  const attack = Math.floor(0.022 * rate);
  const release = Math.min(Math.floor(0.05 * rate), Math.floor(n * 0.25));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attack) env = i / Math.max(1, attack);
    else if (i > n - release) env = (n - i) / Math.max(1, release);
    // 短音略收，避免一串十六分听成「砸重音」
    const shortGate = durationMs < 260 ? 0.82 : 1;
    out[i] = pitched[i] * env * 0.92 * shortGate;
  }
  return out;
}

function kongSpeakMidi(bank) {
  return bank.map?.scale?.doMidi ?? bank.byId.do?.midi ?? 60;
}

/** 拍数用同一唱名短触，不再叠另一路 TTS（会听成重音/两个人） */
function renderBeatCount(sample, digit, targetMidi, durationMs, rate) {
  const dur = Math.min(durationMs, 200);
  return renderFromSample(sample, targetMidi, dur, rate);
}

/**
 * @param {Array<{midi:number,solfege:string,startMs:number,durationMs:number}>} notes
 */
export function renderTangtangSolfege(
  notes,
  totalMs,
  countInMs,
  sampleRate,
  opts = {}
) {
  const bank = loadTangtangSolfegeBank();
  if (!bank) return null;
  const octaveUp = opts.octaveUp ?? 0;
  const beatMs = opts.beatMs || 60000 / 72;
  const totalSamples = Math.ceil(
    ((totalMs + countInMs + 1000) / 1000) * sampleRate
  );
  const out = new Float32Array(totalSamples);

  for (const note of notes) {
    if (
      note.isRest ||
      note.solfege === "空" ||
      /^空+$/.test(note.solfege || "")
    ) {
      const sample = bank.byId.do;
      const speakMidi = kongSpeakMidi(bank);
      const sylDur = Math.min(
        Math.max(160, (note.durationMs || beatMs) * 0.55),
        beatMs * 0.9
      );
      const t0 = Math.floor(((note.startMs + countInMs) / 1000) * sampleRate);
      const syl = renderFromSample(sample, speakMidi, sylDur, sampleRate);
      for (let i = 0; i < syl.length; i++) {
        const idx = t0 + i;
        if (idx >= out.length) break;
        out[idx] += syl[i] * 0.85;
      }
      continue;
    }

    const scoreMidi = (note.midi || 60) + octaveUp;
    const sample = pickSample(bank.byId, note.solfege, scoreMidi);
    const sampleMidi = sample.midi ?? 60;
    const singMidi = nearestOctaveMidi(scoreMidi, sampleMidi);
    const beats =
      note.heldBeats || heldBeatCount(note.durationMs || beatMs, beatMs);

    for (let b = 0; b < beats; b++) {
      const t0 = Math.floor(
        ((note.startMs + b * beatMs + countInMs) / 1000) * sampleRate
      );
      if (b === 0) {
        // 整段录音咬字，最多占一拍多一点，绝不循环拉长
        const sylDur = Math.min(
          beatMs * 0.95,
          Math.max(220, (sample.samples.length / sample.rate) * 1000)
        );
        const syl = renderFromSample(sample, singMidi, sylDur, sampleRate);
        for (let i = 0; i < syl.length; i++) {
          const idx = t0 + i;
          if (idx >= out.length) break;
          out[idx] += syl[i];
        }
      } else {
        const digit = b + 1;
        const syl = renderBeatCount(
          sample,
          digit,
          singMidi,
          beatMs * 0.4,
          sampleRate
        );
        for (let i = 0; i < syl.length; i++) {
          const idx = t0 + i;
          if (idx >= out.length) break;
          out[idx] += syl[i] * 0.55;
        }
      }
    }
  }
  return out;
}
