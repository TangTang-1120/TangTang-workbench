/**
 * 创建 D1 + R2，并把 database_id 写回 wrangler.toml
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF = path.resolve(__dirname, "..");
const WRANGLER = path.join(CF, "node_modules", ".bin", "wrangler");

function run(args, opts = {}) {
  console.log(">", "wrangler", args.join(" "));
  const r = spawnSync(WRANGLER, args, {
    cwd: CF,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    throw new Error(`wrangler ${args[0]} failed (${r.status})`);
  }
  return r.stdout || "";
}

function ensureWrangler() {
  if (!fs.existsSync(WRANGLER)) {
    throw new Error("请先在 cloudflare/ 目录 npm install");
  }
}

ensureWrangler();

// R2
try {
  run(["r2", "bucket", "create", "tangtang-media"]);
} catch {
  console.log("R2 bucket 可能已存在，继续…");
}

// D1
let dbId = null;
try {
  const out = run(["d1", "create", "tangtang-db"]);
  const m = out.match(/database_id\s*=\s*"([^"]+)"/i) || out.match(/([0-9a-f-]{36})/i);
  if (m) dbId = m[1];
} catch (e) {
  console.log("D1 可能已存在，尝试 list…");
  const out = run(["d1", "list"]);
  const line = out
    .split("\n")
    .find((l) => l.includes("tangtang-db"));
  const m = line && line.match(/([0-9a-f-]{36})/i);
  if (m) dbId = m[1];
}

if (!dbId) {
  console.warn(
    "未能自动解析 database_id。请把 wrangler d1 create 输出里的 UUID 填进 wrangler.toml"
  );
} else {
  const tomlPath = path.join(CF, "wrangler.toml");
  let toml = fs.readFileSync(tomlPath, "utf8");
  toml = toml.replace(/database_id = "REPLACE_AFTER_SETUP"/g, `database_id = "${dbId}"`);
  toml = toml.replace(
    /preview_database_id = "REPLACE_AFTER_SETUP"/g,
    `preview_database_id = "${dbId}"`
  );
  fs.writeFileSync(tomlPath, toml);
  console.log("已写入 database_id:", dbId);
}

run(["d1", "execute", "tangtang-db", "--remote", "--file", "schema.sql"]);
console.log("\nsetup 完成 → 接着跑: npm run sync && npm run deploy");
