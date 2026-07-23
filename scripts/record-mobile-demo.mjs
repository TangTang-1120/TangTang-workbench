/**
 * Tang Tang 移动端 Demo（模拟手机 · 输出 2K 16:9 · 带录音 · 无字幕）
 *
 * 1 打开抽屉 · 工作台导航
 * 2 首页大力推动音符
 * 3 搜索曲子
 * 4 成片 · 下载跟唱 / 大提琴
 * 5 播放跟唱 + 大提琴各 10 秒
 * 6 上传出片
 * 7 琴谱库
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium, devices } from "playwright";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "output", "demo-mobile");
const FRAMES = path.join(OUT_DIR, "frames");
const BASE = process.env.DEMO_BASE || "http://127.0.0.1:8787";
const FFMPEG = path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg");
const BANNER_AUDIO = path.join(ROOT, "public", "audio", "first-love-cello.mp3");
const SOL_FALLBACK = path.join(ROOT, "output", "gallery", "moon-river-multi", "solfege.mp4");
const CEL_FALLBACK = path.join(ROOT, "output", "gallery", "moon-river-multi", "cello.mp4");

/** 输出成片：2K 16:9 */
const W = 2560;
const H = 1440;
/** 模拟机型视口（竖屏） */
const PHONE = {
  ...devices["iPhone 14 Pro"],
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2,
};
/** 画面中手机可视高度（含边框） */
const PHONE_FRAME_H = 1280;
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

/** 把竖屏截图嵌进 2K 16:9，带圆角手机框 */
async function phoneTo2K(shotBuf) {
  const bezel = 18;
  const radius = 48;
  const screenMaxH = PHONE_FRAME_H - bezel * 2;
  const screen = await sharp(shotBuf)
    .resize({ height: screenMaxH, fit: "inside" })
    .png()
    .toBuffer();
  const meta = await sharp(screen).metadata();
  const sw = meta.width;
  const sh = meta.height;
  const fw = sw + bezel * 2;
  const fh = sh + bezel * 2;

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}">
      <rect width="${sw}" height="${sh}" rx="${Math.max(8, radius - 10)}" ry="${Math.max(8, radius - 10)}" fill="#fff"/>
    </svg>`
  );
  const rounded = await sharp(screen)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const frameSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1c2430"/>
          <stop offset="100%" stop-color="#0b1016"/>
        </linearGradient>
      </defs>
      <rect width="${fw}" height="${fh}" rx="${radius}" ry="${radius}" fill="url(#g)"/>
      <rect x="${bezel - 2}" y="${bezel - 2}" width="${sw + 4}" height="${sh + 4}"
        rx="${radius - 8}" ry="${radius - 8}" fill="#05070a"/>
      <rect x="${fw / 2 - 48}" y="7" width="96" height="18" rx="9" fill="#05070a"/>
    </svg>`
  );

  const phone = await sharp(frameSvg)
    .composite([{ input: rounded, left: bezel, top: bezel }])
    .png()
    .toBuffer();

  const bg = await sharp({
    create: {
      width: W,
      height: H,
      channels: 3,
      background: { r: 15, g: 26, b: 24 },
    },
  })
    .png()
    .toBuffer();

  const pmeta = await sharp(phone).metadata();
  const left = Math.round((W - pmeta.width) / 2);
  const top = Math.round((H - pmeta.height) / 2);

  return sharp(bg)
    .composite([{ input: phone, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function snap(page, n = 4) {
  const raw = await page.screenshot({ type: "png" });
  const framed = await phoneTo2K(raw);
  for (let i = 0; i < n; i++) {
    fs.writeFileSync(
      path.join(FRAMES, `f_${String(frameIdx++).padStart(5, "0")}.jpg`),
      framed
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

async function openDrawer(page) {
  await page.evaluate(() => {
    document.body.classList.add("wb-drawer-open");
    const b = document.getElementById("wb-backdrop");
    if (b) b.hidden = false;
  });
  await sleep(280);
}

async function closeDrawer(page) {
  await page.evaluate(() => {
    document.body.classList.remove("wb-drawer-open");
    const b = document.getElementById("wb-backdrop");
    if (b) b.hidden = true;
  });
  await sleep(220);
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

async function mobileIntro(page) {
  await page.locator("#wb-menu-btn").waitFor({ state: "visible", timeout: 15000 });
  await snap(page, 8);
  await page.locator("#wb-menu-btn").click();
  await sleep(350);
  await snap(page, 8);

  for (const key of ["home", "gallery", "upload", "library"]) {
    await highlightNav(page, key);
    await snap(page, 4);
  }
  await highlightNav(page, "home");
  await snap(page, 5);
  await closeDrawer(page);
  await snap(page, 6);
}

async function bigPushNotes(page) {
  const stage = page.locator("#score-cello-stage");
  await stage.waitFor({ state: "visible", timeout: 20000 });
  await page.locator("#hero-banner").scrollIntoViewIfNeeded();
  await snap(page, 5);

  const box = await stage.boundingBox();
  if (!box) return;
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.48;

  const paths = [
    [
      [cx - 90, cy - 80],
      [cx + 100, cy + 90],
    ],
    [
      [cx + 80, cy - 100],
      [cx - 110, cy + 60],
    ],
    [
      [cx - 50, cy - 110],
      [cx + 60, cy + 120],
    ],
  ];

  for (const [[x0, y0], [x1, y1]] of paths) {
    await page.mouse.move(x0, y0);
    await snap(page, 1);
    const steps = 16;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ease = t * t * (3 - 2 * t);
      const x = x0 + (x1 - x0) * ease;
      const y = y0 + (y1 - y0) * ease + Math.sin(t * Math.PI * 2.5) * 16;
      await page.mouse.move(x, y);
      await snap(page, 1);
    }
    await snap(page, 2);
  }
  await snap(page, 4);
}

async function searchSong(page) {
  const input = page.locator("#score-search-input");
  await input.waitFor({ state: "visible", timeout: 10000 });
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await snap(page, 4);
  await input.fill("");
  for (const ch of "Moon River") {
    await input.type(ch, { delay: 45 });
    await snap(page, 1);
  }
  await snap(page, 3);
  await page.locator(".score-search-go").tap().catch(async () => {
    await page.locator(".score-search-go").click();
  });
  await page.locator("#score-search").evaluate((f) => {
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await sleep(600);
  await snap(page, 6);
}

async function galleryAndDownload(page) {
  await openDrawer(page);
  await snap(page, 4);
  await page.locator('[data-wb-nav="gallery"]').click();
  await sleep(500);
  await snap(page, 6);

  const panel = page.locator("#home-search-results");
  await panel.waitFor({ state: "visible", timeout: 12000 });
  await panel.scrollIntoViewIfNeeded();
  await snap(page, 8);

  const row = page
    .locator(".home-piece-row")
    .filter({ hasText: "Moon River" })
    .first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  await row.scrollIntoViewIfNeeded();
  await snap(page, 6);

  const solBtn = row.locator(".home-piece-btn-sol");
  const celBtn = row.locator(".home-piece-btn-cello");

  await solBtn.scrollIntoViewIfNeeded();
  await snap(page, 5);
  const solHref = await solBtn.getAttribute("href");

  await celBtn.scrollIntoViewIfNeeded();
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

async function showUpload(page) {
  await openDrawer(page);
  await highlightNav(page, "upload");
  await snap(page, 5);
  await closeDrawer(page);

  const panel = page.locator("#upload-panel");
  await panel.scrollIntoViewIfNeeded();
  await sleep(300);
  await snap(page, 10);
}

async function showLibrary(page) {
  await openDrawer(page);
  await snap(page, 4);
  await page.locator('[data-wb-nav="library"]').click();
  await page.waitForURL(/library\.html/, { timeout: 15000 });
  await sleep(900);
  await forceLight(page);
  await page.locator("#library-list").waitFor({ state: "visible", timeout: 15000 });
  await sleep(400);
  await snap(page, 10);

  const card = page.locator(".library-row").first();
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await snap(page, 8);
    const dl = card.locator("a.library-dl, a.btn-dl").first();
    if (await dl.count()) {
      await dl.scrollIntoViewIfNeeded();
      await snap(page, 6);
    }
  }
  await snap(page, 6);
}

function framesToVideo(dir, out) {
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
  if (fs.existsSync(BANNER_AUDIO) && dur > 0.2) {
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

  console.log("启动 Chrome · 模拟 iPhone · 输出 2K 16:9…");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({
    ...PHONE,
    locale: "zh-CN",
    acceptDownloads: true,
  });
  const page = await context.newPage();

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await forceLight(page);

  console.log("1 抽屉导航");
  await mobileIntro(page);

  console.log("2 大力推动音符");
  await bigPushNotes(page);

  console.log("3 搜索样式");
  await searchSong(page);

  console.log("4 成片下载");
  const { solPath, celPath } = await galleryAndDownload(page);
  markers.afterUi = frameIdx;

  console.log("6 上传出片");
  await showUpload(page);

  console.log("7 琴谱库");
  await showLibrary(page);

  const afterRest = frameIdx;
  await browser.close();
  console.log(`截帧 ${frameIdx}，合成 ≤60s…`);

  const dirA = path.join(OUT_DIR, "segA");
  const dirC = path.join(OUT_DIR, "segC");
  copyFrameRange(0, markers.afterUi, dirA);
  copyFrameRange(markers.afterUi, afterRest, dirC);

  const partA = path.join(OUT_DIR, "partA.mp4");
  const partC = path.join(OUT_DIR, "partC.mp4");
  const solClip = path.join(OUT_DIR, "sol-10s.mp4");
  const celClip = path.join(OUT_DIR, "cel-10s.mp4");
  framesToVideo(dirA, partA);
  framesToVideo(dirC, partC);
  clipMedia(solPath, solClip, 10);
  clipMedia(celPath, celClip, 10);

  const finalMp4 = path.join(OUT_DIR, "tangtang-mobile-demo-2k.mp4");
  const desktop = path.join(
    process.env.HOME || "",
    "Desktop",
    "TangTang-移动端操作Demo-2K.mp4"
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
    `移动端模拟 · 2K ${W}×${H} 16:9 · ${dur.toFixed(1)}s · 抽屉→推音符→搜索→成片→跟唱/大提琴10s→上传→琴谱库`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
