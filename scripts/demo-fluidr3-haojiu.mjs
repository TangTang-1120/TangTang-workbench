/**
 * 經典 FluidR3 模式：對譜重渲《好久不見》大提琴 demo
 */
import fs from "node:fs";
import path from "node:path";
import { generatePair, ROOT } from "../src/pair-engine.mjs";

const score =
  process.argv[2] ||
  path.join(ROOT, "output/jobs/hao-jiu-bu-jian/score.musicxml");
const workDir = path.join(ROOT, "output", "demo-fluidr3-haojiu");
const deskMp4 = path.join(
  process.env.HOME || "",
  "Desktop",
  "好久不见-FluidR3大提琴跟谱demo.mp4"
);
const deskWav = path.join(
  process.env.HOME || "",
  "Desktop",
  "好久不见-FluidR3大提琴跟谱demo.wav"
);

console.log("模式: FluidR3 经典 · 对谱跟拉");
console.log("乐谱:", score);

const result = await generatePair({
  musicXmlPath: score,
  workDir,
  fast: true,
  fingeringMode: "multi",
  onProgress: ({ percent, message }) => console.log(`[${percent}%] ${message}`),
});

fs.copyFileSync(result.files.cello, deskMp4);
const stem = path.join(workDir, "stems", "大提琴.wav");
if (fs.existsSync(stem)) fs.copyFileSync(stem, deskWav);

console.log("完成:");
console.log(" ", deskMp4);
if (fs.existsSync(deskWav)) console.log(" ", deskWav);
console.log(" ", result.files.cello);
