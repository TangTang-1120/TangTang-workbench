/**
 * First Love：去鋼琴旋律譜 → FluidR3 大提琴跟譜 + 湯湯音色跟唱 → 桌面
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { generatePair, ROOT } from "../src/pair-engine.mjs";

const score = path.join(ROOT, "scores/first-love-melody-cello.musicxml");
const workDir = path.join(ROOT, "output", "demo-first-love-melody");
const deskCel = path.join(process.env.HOME, "Desktop", "FirstLove-大提琴跟谱demo.mp4");
const deskSol = path.join(process.env.HOME, "Desktop", "FirstLove-汤汤音色跟唱demo.mp4");

console.log("1/3 对谱渲染（仅旋律·大提琴 FluidR3）…");
const result = await generatePair({
  musicXmlPath: score,
  workDir,
  fast: true,
  fingeringMode: "multi",
  onProgress: ({ percent, message }) => console.log(`  [${percent}%] ${message}`),
});

fs.copyFileSync(result.files.cello, deskCel);
console.log("大提琴:", deskCel);

// Extract solfege guide wav from 唱音阶.mp4 for Seed-VC
const solMp4 = result.files.solfege;
const guideWav = path.join(workDir, "guide-solfege.wav");
spawnSync(
  ffmpegPath,
  ["-y", "-i", solMp4, "-vn", "-ac", "1", "-ar", "44100", guideWav],
  { encoding: "utf8" }
);

const py = path.join(ROOT, "tools/seed-vc/.venv/bin/python");
const batch = path.join(ROOT, "scripts/batch-seedvc-gallery.py");
// Use a tiny inline seed-vc via importing batch helpers
const vcScript = `
import sys
from pathlib import Path
sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "scripts"))})
# load batch module functions by exec
import importlib.util
spec = importlib.util.spec_from_file_location("batch", ${JSON.stringify(batch)})
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)
guide = Path(${JSON.stringify(guideWav)})
vc = Path(${JSON.stringify(path.join(workDir, "vc-tangtang.wav"))})
out = Path(${JSON.stringify(path.join(workDir, "solfege-tangtang.mp4"))})
video = Path(${JSON.stringify(solMp4)})
print("2/3 Seed-VC 汤汤音色…")
batch.seed_vc_convert(guide, vc)
print("3/3 remux…")
batch.remux_voice_only(vc, video, out)
print("ok", out)
`;

const vcPy = path.join(workDir, "_run_vc.py");
fs.writeFileSync(vcPy, vcScript);
console.log("2–3/3 汤汤音色转换…");
const r = spawnSync(py, [vcPy], {
  encoding: "utf8",
  cwd: ROOT,
  env: { ...process.env, SEEDVC_STEPS: "20" },
  maxBuffer: 40 * 1024 * 1024,
});
console.log(r.stdout || "");
if (r.status !== 0) {
  console.error(r.stderr || "");
  // fallback: copy original solfege if VC fails
  fs.copyFileSync(solMp4, deskSol);
  console.log("Seed-VC 失败，已放原唱名轨:", deskSol);
  process.exit(1);
}
const outMp4 = path.join(workDir, "solfege-tangtang.mp4");
fs.copyFileSync(outMp4, deskSol);
console.log("跟唱:", deskSol);
console.log("全部完成");
