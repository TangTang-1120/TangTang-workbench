/**
 * 本机渲染桥（可选）：轮询 Cloudflare 排队任务 → 本地出片 → 回写 R2 + D1
 *
 * 用法：
 *   export CF_WORKER_URL=https://tangtang-workbench.<subdomain>.workers.dev
 *   export CF_RENDER_SECRET=change-me   # 与 wrangler.toml RENDER_HOOK_SECRET 一致
 *   node cloudflare/scripts/render-bridge.mjs
 *
 * 说明：真正出片仍调用本仓库已有 Node 服务 http://127.0.0.1:8787
 *       需先在本机 npm start；本脚本只负责「搬任务」
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF = path.resolve(__dirname, "..");
const ROOT = path.resolve(CF, "..");
const WORKER = (process.env.CF_WORKER_URL || "").replace(/\/$/, "");
const SECRET = process.env.CF_RENDER_SECRET || "change-me";
const LOCAL = (process.env.LOCAL_API || "http://127.0.0.1:8787").replace(/\/$/, "");
const POLL_MS = Number(process.env.POLL_MS || 8000);
const WRANGLER = path.join(CF, "node_modules", ".bin", "wrangler");
const BUCKET = "tangtang-media";
const TMP = path.join(CF, ".bridge-tmp");

fs.mkdirSync(TMP, { recursive: true });

async function cf(pathname, opts = {}) {
  if (!WORKER) throw new Error("请设置 CF_WORKER_URL");
  const res = await fetch(`${WORKER}${pathname}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "X-Render-Secret": SECRET,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`);
  return data;
}

function r2Put(localPath, key) {
  const r = spawnSync(
    WRANGLER,
    ["r2", "object", "put", `${BUCKET}/${key}`, "--file", localPath, "--remote"],
    { cwd: CF, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error(`R2 put failed ${key}: ${r.stderr?.slice(-500)}`);
  }
}

async function downloadJobFile(job, dest) {
  const res = await fetch(`${WORKER}/api/jobs/${job.id}/file`, {
    headers: { "X-Render-Secret": SECRET },
  });
  if (!res.ok) throw new Error(`download job file ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function uploadToLocal(filePath, originalName) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(filePath)]);
  form.append("score", blob, originalName || path.basename(filePath));
  const res = await fetch(`${LOCAL}/api/upload`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "local upload failed");
  return data;
}

async function waitLocalJob(id, timeoutMs = 30 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${LOCAL}/api/jobs/${id}`);
    const data = await res.json();
    if (data.status === "done") return data;
    if (data.status === "error" || data.error) {
      throw new Error(data.error || data.message || "local job error");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("local job timeout");
}

async function processOne(job) {
  console.log("处理任务", job.id, job.filename);
  await cf(`/api/jobs/${job.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "rendering" }),
  });

  const localIn = path.join(TMP, `${job.id}-${job.filename || "score.bin"}`);
  await downloadJobFile(job, localIn);

  const created = await uploadToLocal(localIn, job.filename);
  const localJobId = created.id;
  const done = await waitLocalJob(localJobId);

  const title = done.title || job.title || job.id;
  const galleryId = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || job.id;

  const jobDir = path.join(ROOT, "output", "jobs", localJobId);
  // 本地成片文件名依 server 约定
  const celloSrc =
    [
      path.join(jobDir, "大提琴.mp4"),
      path.join(jobDir, "cello.mp4"),
    ].find((p) => fs.existsSync(p)) || null;
  const solSrc =
    [
      path.join(jobDir, "唱音阶.mp4"),
      path.join(jobDir, "solfege.mp4"),
    ].find((p) => fs.existsSync(p)) || null;

  if (!celloSrc) throw new Error("本地未找到大提琴成片");

  r2Put(celloSrc, `gallery/${galleryId}/cello.mp4`);
  let hasSolfege = 0;
  if (solSrc) {
    r2Put(solSrc, `gallery/${galleryId}/solfege.mp4`);
    hasSolfege = 1;
  }

  await cf(`/api/jobs/${job.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "done",
      gallery: {
        id: galleryId,
        title,
        artist: "Tang Tang",
        hasPoster: false,
        hasCello: true,
        hasSolfege: Boolean(hasSolfege),
      },
    }),
  });

  console.log("完成", job.id, "→ gallery", galleryId);
}

async function tick() {
  const localOk = await fetch(`${LOCAL}/api/health`).catch(() => null);
  if (!localOk?.ok) {
    console.log("等待本地服务", LOCAL);
    return;
  }
  const data = await cf("/api/jobs");
  const queued = (data.entries || []).filter((j) => j.status === "queued");
  if (!queued.length) {
    console.log(new Date().toISOString(), "无排队任务");
    return;
  }
  for (const job of queued.slice(0, 1)) {
    try {
      await processOne(job);
    } catch (err) {
      console.error("任务失败", job.id, err.message);
      await cf(`/api/jobs/${job.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "error", error: String(err.message || err) }),
      }).catch(() => {});
    }
  }
}

async function main() {
  if (!WORKER) {
    console.log(`渲染桥已写好，但还缺公网 Worker 地址。

部署 Cloudflare 成功后执行：
  export CF_WORKER_URL=https://tangtang-workbench.<你的>.workers.dev
  export CF_RENDER_SECRET=change-me
  # 另开终端：cd score-video-demo && npm start
  node cloudflare/scripts/render-bridge.mjs
`);
    process.exit(0);
  }
  console.log("桥接", WORKER, "←→", LOCAL);
  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error(e.message || e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
