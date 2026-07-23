/**
 * 快速试听：Mainardi 义式大提琴（只渲音频）
 */
import fs from "node:fs";
import path from "node:path";
import createVerovioModule from "verovio/wasm";
import { VerovioToolkit } from "verovio/esm";
import toneMidi from "@tonejs/midi";
import { forceTempoInMusicXml, ROOT } from "../src/pair-engine.mjs";
import { assignCelloFingerings } from "../src/cello-fingering.mjs";
import {
  renderMainardiCello,
  floatToWavBuffer,
  encodeAudioPreview,
  CELLO_ENGINE_TAG,
} from "../src/cello-mainardi.mjs";

const { Midi } = toneMidi;
const FORCE_BPM = 72;
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

async function loadToolkit(scorePath) {
  const Mod = await createVerovioModule();
  const tk = new VerovioToolkit(Mod);
  tk.setOptions({
    breaks: "auto",
    pageWidth: 1350,
    pageHeight: 2000,
    scale: 40,
    header: "none",
    footer: "none",
  });
  if (!tk.loadData(fs.readFileSync(scorePath, "utf8"))) {
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

function buildNotes(midi) {
  const srcTempo = midi.header.tempos[0]?.bpm || FORCE_BPM;
  const scale = srcTempo / FORCE_BPM;
  const notes = [];
  for (const track of midi.tracks) {
    for (const n of track.notes) {
      notes.push({
        midi: n.midi,
        name: n.name,
        sampleName: midiToNoteName(n.midi),
        solfege: SOLFEGE_ZH[((n.midi % 12) + 12) % 12],
        startMs: n.time * 1000 * scale,
        durationMs: Math.max(90, n.duration * 1000 * scale),
      });
    }
  }
  notes.sort((a, b) => a.startMs - b.startMs);
  return assignCelloFingerings(notes, "multi");
}

const score =
  process.argv[2] || path.join(ROOT, "scores/first-love.musicxml");
const work = path.join(ROOT, "output", "preview-mainardi");
fs.mkdirSync(work, { recursive: true });

const forced = forceTempoInMusicXml(fs.readFileSync(score, "utf8"), FORCE_BPM);
const scorePath = path.join(work, "score.musicxml");
fs.writeFileSync(scorePath, forced, "utf8");

console.log(`引擎: ${CELLO_ENGINE_TAG} · Enrico Mainardi 义式揉弦`);
console.log("绘谱 / 解码 MIDI…");
const tk = await loadToolkit(scorePath);
const midi = decodeMidi(tk);
const notes = buildNotes(midi);
const scoreEndMs = Math.max(
  ...notes.map((n) => n.startMs + n.durationMs),
  1000
);
const countInMs = (60000 / FORCE_BPM) * 4;

console.log(
  `音符 ${notes.length} · ${(scoreEndMs / 1000).toFixed(1)}s · 下载 Karoryfer 并渲染…`
);
const cello = renderMainardiCello(notes, scoreEndMs, countInMs);
const wavPath = path.join(work, "mainardi-cello.wav");
fs.writeFileSync(wavPath, floatToWavBuffer(cello));

const deskWav = path.join(process.env.HOME, "Desktop", "Mainardi大提琴试听.wav");
const deskM4a = path.join(process.env.HOME, "Desktop", "Mainardi大提琴试听.m4a");
fs.copyFileSync(wavPath, deskWav);
encodeAudioPreview(wavPath, deskM4a);
console.log("完成:");
console.log(" ", deskM4a);
console.log(" ", deskWav);
