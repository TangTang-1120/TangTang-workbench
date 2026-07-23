/**
 * 預覽大提琴義大利復古畫面（幾秒幀 + 桌面樣片圖）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { generatePair, ROOT } from "../src/pair-engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const score =
  process.argv[2] ||
  path.join(ROOT, "scores/first-love.musicxml");
const workDir = path.join(ROOT, "output", "preview-italian-cello");
const desk = path.join(
  process.env.HOME || "",
  "Desktop",
  "大提琴-意大利复古风格预览.jpg"
);

console.log("渲染预览（极速）:", score);
const result = await generatePair({
  musicXmlPath: score,
  workDir,
  fast: true,
  fingeringMode: "multi",
  onProgress: ({ percent, message }) => console.log(`[${percent}%] ${message}`),
});

const cello = result.files.cello;
const shot = path.join(workDir, "style-preview.jpg");
spawnSync(
  ffmpegPath,
  ["-y", "-ss", "8", "-i", cello, "-frames:v", "1", "-q:v", "2", shot],
  { encoding: "utf8" }
);
if (fs.existsSync(shot)) {
  fs.copyFileSync(shot, desk);
  console.log("预览图:", desk);
}
console.log("大提琴样片:", cello);
