/**
 * 站长本机：拉取 Cloudflare 排队谱面 → 存到 output/pending-uploads/
 *
 *   export CF_WORKER_URL=https://tangtang-workbench.tangtang-1120.workers.dev
 *   export CF_RENDER_SECRET=change-me
 *   npm run pull
 *
 * 然后你自己动手：
 *   1) 另开终端 npm start
 *   2) 浏览器打开本地工作台，把 pending 里的谱面拖上去出片
 *   或继续用 npm run bridge 自动搬（需本机服务已开）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF = path.resolve(__dirname, "..");
const ROOT = path.resolve(CF, "..");
const WORKER = (
  process.env.CF_WORKER_URL ||
  "https://tangtang-workbench.tangtang-1120.workers.dev"
).replace(/\/$/, "");
const SECRET = process.env.CF_RENDER_SECRET || "change-me";
const OUT = path.join(ROOT, "output", "pending-uploads");

fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const listRes = await fetch(`${WORKER}/api/jobs?status=queued`);
  const list = await listRes.json();
  if (!listRes.ok) throw new Error(JSON.stringify(list));
  const entries = list.entries || [];
  console.log(`排队任务：${entries.length} 个`);
  console.log(`保存目录：${OUT}\n`);

  if (!entries.length) {
    console.log("没有待处理谱面。");
    return;
  }

  const index = [];
  for (const job of entries) {
    const fileRes = await fetch(`${WORKER}/api/jobs/${job.id}/file`, {
      headers: { "X-Render-Secret": SECRET },
    });
    if (!fileRes.ok) {
      console.warn("跳过", job.id, fileRes.status, await fileRes.text());
      continue;
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    const name = `${job.id}__${job.filename || "score.bin"}`;
    const dest = path.join(OUT, name);
    fs.writeFileSync(dest, buf);
    index.push({
      id: job.id,
      filename: job.filename,
      path: dest,
      createdAt: job.createdAt,
    });
    console.log("↓", name, `(${buf.length} bytes)`);
  }

  fs.writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify({ pulledAt: Date.now(), worker: WORKER, entries: index }, null, 2)
  );

  console.log(`
======= 你自己动手 =======
1. 打开文件夹：
   open "${OUT}"

2. 本机启动工作台：
   cd "${ROOT}" && npm start

3. 浏览器打开 http://127.0.0.1:8787
   把 pending-uploads 里的谱面拖上去出片

4. 出片完成后，把成片同步回线上（开通 R2 后）：
   cd "${CF}" && npm run sync && npm run deploy

或自动桥接（本机 npm start 开着时）：
   export CF_WORKER_URL=${WORKER}
   export CF_RENDER_SECRET=${SECRET}
   npm run bridge
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
