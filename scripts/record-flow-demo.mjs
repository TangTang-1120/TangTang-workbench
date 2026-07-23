/**
 * Tang Tang 浅色工作台 Demo（2K · ≤60s · 带录音 · 无字幕）
 *
 * 主线：浅色工作台 = 首页主体
 * 1 侧栏工作台开场
 * 2 首页大力推动音符
 * 3 搜索曲子（展示样式）
 * 4 侧栏「成片」→ 下载跟唱 / 大提琴
 * 5 播放跟唱 + 大提琴短片（原片音轨）
 * 6 侧栏「上传出片」
 * 7 侧栏「琴谱库」浏览下载
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "output", "demo-flow");
const FRAMES = path.join(OUT_DIR, "frames");
const BASE = process.env.DEMO_BASE || "http://127.0.0.1:8787";
const FFMPEG = path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg");
const BANNER_AUDIO = path.join(ROOT, "public", "audio", "first-love-cello.mp3");
const SOL_FALLBACK = path.join(ROOT, "output", "gallery", "moon-river-multi", "solfege.mp4");
const CEL_FALLBACK = path.join(ROOT, "output", "gallery", "moon-river-multi", "cello.mp4");
const W = 2560;
const H = 1440;
const FPS = 12;
const CRF = "17";
const PRESET = "medium";

fs.mkdirSync(FRAMES, { recursive: true });
for (const f of fs.readdirSync(FRAMES)) {
  try {
    fs.unlinkSync(path.join(FRAMES, f));
  } catch {
    /* ignore */
  }
}

let frameIdx = 0;
const markers = { afterUi: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ff(...args) {
  const r = spawnSync(FFMPEG, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-1800));
    throw new Error(`ffmpeg failed: ${args.slice(0, 8).join(" ")}`);
  }
  return r;
}

function probeDuration(file) {
  const r = spawnSync(FFMPEG, ["-i", file], { encoding: "utf8" });
  const m = String(r.stderr || "").match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function snap(page, n = 4) {
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(
      path.join(FRAMES, `f_${String(frameIdx++).padStart(5, "0")}.jpg`),
      buf
    );
  }
}

async function forceLight(page) {
  await page.evaluate(() => {
    localStorage.setItem("tangtang-theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
    document.body.classList.add("is-workbench");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(1100);
}

async function highlightNav(page, key) {
  await page.evaluate((k) => {
    document.querySelectorAll(".wb-nav-item.is-active").forEach((n) => {
      n.classList.remove("is-active");
    });
    const el = document.querySelector(`[data-wb-nav="${k}"]`);
    if (el) el.classList.add("is-active");
  }, key);
}

/** ① 浅色工作台开场：侧栏 + 品牌 */
async function workbenchIntro(page) {
  await page.locator("#wb-sidebar").waitFor({ state: "visible", timeout: 15000 });
  await snap(page, 10);

  const items = ["home", "gallery", "upload", "library"];
  for (const key of items) {
    await highlightNav(page, key);
    await snap(page, 5);
  }
  await highlightNav(page, "home");
  await page.locator(".wb-product").hover().catch(() => {});
  await snap(page, 8);
}

/** ② 首页大力推动音符 */
async function bigPushNotes(page) {
  await highlightNav(page, "home");
  const stage = page.locator("#score-cello-stage");
  await stage.waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#hero-banner").scrollIntoViewIfNeeded();
  await snap(page, 6);

  const box = await stage.boundingBox();
  if (!box) return;
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.48;

  const paths = [
    [
      [cx - 220, cy - 120],
      [cx + 240, cy + 140],
    ],
    [
      [cx + 200, cy - 160],
      [cx - 260, cy + 100],
    ],
    [
      [cx - 100, cy - 180],
      [cx + 120, cy + 200],
    ],
  ];

  for (const [[x0, y0], [x1, y1]] of paths) {
    await page.mouse.move(x0, y0);
    await snap(page, 1);
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t);
      const x = x0 + (x1 - x0) * ease;
      const y = y0 + (y1 - y0) * ease + Math.sin(t * Math.PI * 3) * 28;
      await page.mouse.move(x, y);
      await snap(page, 1);
    }
    await snap(page, 2);
  }
  await snap(page, 4);
}

/** ③ 搜索样式 */
async function searchSong(page) {
  const input = page.locator("#score-search-input");
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.click();
  await snap(page, 4);
  await input.fill("");
  for (const ch of "Moon River") {
    await input.type(ch, { delay: 40 });
    await snap(page, 1);
  }
  await snap(page, 3);
  await page.locator(".score-search-go").hover();
  await snap(page, 4);
  await page.locator("#score-search").evaluate((f) => {
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await sleep(600);
  await snap(page, 6);
}

/** ④ 侧栏成片 + 下载 */
async function galleryAndDownload(page) {
  const galleryNav = page.locator('[data-wb-nav="gallery"]');
  await galleryNav.click();
  await sleep(500);
  await snap(page, 8);

  const panel = page.locator("#home-search-results");
  await panel.waitFor({ state: "visible", timeout: 12000 });
  await panel.scrollIntoViewIfNeeded();
  await snap(page, 8);

  const row = page
    .locator(".home-piece-row")
    .filter({ hasText: "Moon River" })
    .first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  await snap(page, 6);

  const solBtn = row.locator(".home-piece-btn-sol");
  const celBtn = row.locator(".home-piece-btn-cello");

  await solBtn.hover();
  await snap(page, 5);
  const solHref = await solBtn.getAttribute("href");

  await celBtn.hover();
  await snap(page, 5);
  const celHref = await celBtn.getAttribute("href");

  const solPath = path.join(OUT_DIR, "demo-solfege.mp4");
  const celPath = path.join(OUT_DIR, "demo-cello.mp4");

  if (solHref) {
    const r = await page.request.get(new URL(solHref, BASE).toString());
    if (r.ok()) fs.writeFileSync(solPath, await r.body());
    else fs.copyFileSync(SOL_FALLBACK, solPath);
  } else fs.copyFileSync(SOL_FALLBACK, solPath);

  if (celHref) {
    const r = await page.request.get(new URL(celHref, BASE).toString());
    if (r.ok()) fs.writeFileSync(celPath, await r.body());
    else fs.copyFileSync(CEL_FALLBACK, celPath);
  } else fs.copyFileSync(CEL_FALLBACK, celPath);

  await snap(page, 6);
  return { solPath, celPath };
}

/** ⑥ 上传出片 */
async function showUpload(page) {
  await highlightNav(page, "upload");
  await snap(page, 4);

  const panel = page.locator("#upload-panel");
  await panel.scrollIntoViewIfNeeded();
  await sleep(300);
  await snap(page, 8);

  const drop = page.locator("#drop, .upload-panel-compact label, #upload-hint").first();
  await drop.hover().catch(() => {});
  await snap(page, 8);
  await page.locator("#hero-banner").scrollIntoViewIfNeeded().catch(() => {});
}

/** ⑦ 琴谱库 */
async function showLibrary(page) {
  await page.locator('[data-wb-nav="library"]').click();
  await page.waitForURL(/library\.html/, { timeout: 15000 });
  await sleep(900);
  await forceLight(page);
  await page.locator("#library-list").waitFor({ state: "visible", timeout: 15000 });
  await sleep(400);
  await snap(page, 10);

  const card = page.locator(".library-row").first();
  if (await card.count()) {
    await card.hover();
    await snap(page, 8);
    const dl = card.locator("a.library-dl, a.btn-dl").first();
    if (await dl.count()) {
      await dl.hover();
      await snap(page, 6);
    }
  }

  await snap(page, 8);
}

function framesToVideo(dir, out, audioMode = "banner") {
  const silent = out.replace(/\.mp4$/, "-silent.mp4");
  ff(
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    path.join(dir, "f_%05d.jpg"),
    "-c:v",
    "libx264",
    "-preset",
    PRESET,
    "-crf",
    CRF,
    "-pix_fmt",
    "yuv420p",
    silent
  );
  const dur = probeDuration(silent);
  if (audioMode === "banner" && fs.existsSync(BANNER_AUDIO) && dur > 0.2) {
    ff(
      "-y",
      "-i",
      silent,
      "-stream_loop",
      "-1",
      "-i",
      BANNER_AUDIO,
      "-filter_complex",
      `[1:a]volume=0.42,afade=t=in:st=0:d=0.35,afade=t=out:st=${Math.max(0.3, dur - 0.65)}:d=0.65,aformat=sample_rates=48000:channel_layouts=stereo[a]`,
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-ar",
      "48000",
      "-shortest",
      out
    );
  } else {
    ff(
      "-y",
      "-i",
      silent,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      out
    );
  }
}

function clipMedia(src, dest, seconds) {
  ff(
    "-y",
    "-i",
    src,
    "-t",
    String(seconds),
    "-vf",
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0f1a18,setsar=1`,
    "-af",
    "aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0",
    "-c:v",
    "libx264",
    "-preset",
    PRESET,
    "-crf",
    CRF,
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-pix_fmt",
    "yuv420p",
    dest
  );
}

function copyFrameRange(from, to, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  let n = 0;
  for (let i = from; i < to; i++) {
    const src = path.join(FRAMES, `f_${String(i).padStart(5, "0")}.jpg`);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(outDir, `f_${String(n++).padStart(5, "0")}.jpg`));
  }
  return n;
}

async function main() {
  if (!fs.existsSync(FFMPEG)) throw new Error("缺少 ffmpeg-static");
  if (!fs.existsSync(SOL_FALLBACK) || !fs.existsSync(CEL_FALLBACK)) {
    throw new Error("缺少 moon-river-multi 成片");
  }
  const ping = await fetch(BASE).catch(() => null);
  if (!ping?.ok) throw new Error(`服务器未开：${BASE}`);

  console.log("启动 Chrome 2K…");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      `--window-size=${W},${H}`,
    ],
  });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await forceLight(page);

  console.log("1 浅色工作台开场");
  await workbenchIntro(page);

  console.log("2 大力推动音符");
  await bigPushNotes(page);

  console.log("3 搜索样式");
  await searchSong(page);

  console.log("4 成片下载");
  const { solPath, celPath } = await galleryAndDownload(page);
  markers.afterUi = frameIdx;

  // 上传 + 琴谱库也先截帧，再在合成时把成片短片插在「下载」与「上传」之间
  // 为简化时间轴：上传/库放在短片之后继续录
  console.log("6 上传出片");
  await showUpload(page);

  console.log("7 琴谱库");
  await showLibrary(page);

  const afterRest = frameIdx;
  await browser.close();
  console.log(`截帧 ${frameIdx}，合成 ≤60s…`);

  // 分段：开场→下载 | 上传→库（中间插入成片短片）
  const dirA = path.join(OUT_DIR, "segA");
  const dirC = path.join(OUT_DIR, "segC");
  copyFrameRange(0, markers.afterUi, dirA);
  copyFrameRange(markers.afterUi, afterRest, dirC);

  const partA = path.join(OUT_DIR, "partA.mp4");
  const partC = path.join(OUT_DIR, "partC.mp4");
  const solClip = path.join(OUT_DIR, "sol-10s.mp4");
  const celClip = path.join(OUT_DIR, "cel-10s.mp4");
  framesToVideo(dirA, partA, "banner");
  framesToVideo(dirC, partC, "banner");
  clipMedia(solPath, solClip, 10);
  clipMedia(celPath, celClip, 10);

  const finalMp4 = path.join(OUT_DIR, "tangtang-workbench-demo-2k.mp4");
  const desktop = path.join(
    process.env.HOME || "",
    "Desktop",
    "TangTang-工作台操作Demo-2K.mp4"
  );

  const pad = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0f1a18,setsar=1,fps=${FPS}`;
  ff(
    "-y",
    "-i",
    partA,
    "-i",
    solClip,
    "-i",
    celClip,
    "-i",
    partC,
    "-filter_complex",
    `[0:v]${pad}[v0];[1:v]${pad}[v1];[2:v]${pad}[v2];[3:v]${pad}[v3];` +
      `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[a0];` +
      `[1:a]aformat=sample_rates=48000:channel_layouts=stereo[a1];` +
      `[2:a]aformat=sample_rates=48000:channel_layouts=stereo[a2];` +
      `[3:a]aformat=sample_rates=48000:channel_layouts=stereo[a3];` +
      `[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[v][a]`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    PRESET,
    "-crf",
    CRF,
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    finalMp4
  );

  let dur = probeDuration(finalMp4);
  let outFinal = finalMp4;
  if (dur > 59.5) {
    const sped = path.join(OUT_DIR, "demo-under60.mp4");
    const factor = dur / 58;
    const atempo =
      factor <= 2
        ? `atempo=${factor.toFixed(4)}`
        : `atempo=2.0,atempo=${(factor / 2).toFixed(4)}`;
    ff(
      "-y",
      "-i",
      finalMp4,
      "-filter_complex",
      `[0:v]setpts=PTS/${factor.toFixed(4)}[v];[0:a]${atempo}[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      PRESET,
      "-crf",
      CRF,
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      sped
    );
    outFinal = sped;
    dur = probeDuration(sped);
  }

  fs.copyFileSync(outFinal, desktop);
  console.log("完成:", outFinal);
  console.log("桌面:", desktop);
  console.log(
    `2K ${W}×${H} · ${dur.toFixed(1)}s · 工作台开场→推音符→搜索→成片下载→跟唱/大提琴→上传→琴谱库（带录音）`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
