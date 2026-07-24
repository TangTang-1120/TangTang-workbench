/**
 * 仅 seed D1（不依赖 R2）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CF = path.resolve(__dirname, "..");
const ROOT = path.resolve(CF, "..");
const WRANGLER = path.join(CF, "node_modules", ".bin", "wrangler");
const GALLERY = path.join(ROOT, "output", "gallery");
const LIBRARY = path.join(ROOT, "scores", "library");

function esc(s) {
  return String(s ?? "").replace(/'/g, "''");
}

const galManifest = JSON.parse(
  fs.readFileSync(path.join(GALLERY, "manifest.json"), "utf8")
);
const libManifest = JSON.parse(
  fs.readFileSync(path.join(LIBRARY, "manifest.json"), "utf8")
);

const lines = [];
for (const e of galManifest.entries || []) {
  const dir = path.join(GALLERY, e.id);
  const hasCello = fs.existsSync(path.join(dir, "cello.mp4")) ? 1 : 0;
  const hasSolfege = fs.existsSync(path.join(dir, "solfege.mp4")) ? 1 : 0;
  const hasPoster = fs.existsSync(path.join(dir, "poster.jpg")) ? 1 : 0;
  const pos = e.posLabel ? `'${esc(e.posLabel)}'` : "NULL";
  const ts = Number(e.updatedAt || e.addedAt || Date.now());
  lines.push(`INSERT INTO gallery (id, title, artist, pos_label, has_poster, has_cello, has_solfege, updated_at)
VALUES ('${esc(e.id)}', '${esc(e.title || e.id)}', '${esc(e.artist || "未知歌手")}', ${pos}, ${hasPoster}, ${hasCello}, ${hasSolfege}, ${ts})
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title, artist=excluded.artist, pos_label=excluded.pos_label,
  has_poster=excluded.has_poster, has_cello=excluded.has_cello,
  has_solfege=excluded.has_solfege, updated_at=excluded.updated_at;`);
}
for (const e of libManifest.entries || []) {
  const ts = Number(e.lastUsedAt || e.addedAt || Date.now());
  lines.push(`INSERT INTO library (id, title, artist, filename, source, featured, updated_at)
VALUES ('${esc(e.id)}', '${esc(e.title || e.id)}', '${esc(e.artist || "未知歌手")}', '${esc(e.filename)}', '${esc(e.source || "demo")}', ${e.featured ? 1 : 0}, ${ts})
ON CONFLICT(id) DO UPDATE SET
  title=excluded.title, artist=excluded.artist, filename=excluded.filename,
  source=excluded.source, featured=excluded.featured, updated_at=excluded.updated_at;`);
}

const seedPath = path.join(CF, "scripts", "_seed_generated.sql");
fs.writeFileSync(seedPath, lines.join("\n"));
const r = spawnSync(
  WRANGLER,
  ["d1", "execute", "tangtang-db", "--remote", "--file", seedPath],
  { cwd: CF, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
);
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
if (r.status !== 0) process.exit(r.status || 1);
console.log("D1 seed OK");
