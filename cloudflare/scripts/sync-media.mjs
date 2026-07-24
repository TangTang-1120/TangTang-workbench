/**
 * 同步本地成片 / 琴谱到 R2，并 seed D1
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
const BUCKET = "tangtang-media";

function run(args) {
  console.log(">", "wrangler", args.join(" "));
  const r = spawnSync(WRANGLER, args, {
    cwd: CF,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error(r.stderr?.slice(-2000));
    throw new Error(`failed: ${args.join(" ")}`);
  }
  return r.stdout || "";
}

function putFile(localPath, key) {
  run(["r2", "object", "put", `${BUCKET}/${key}`, "--file", localPath, "--remote"]);
}

// —— R2: gallery ——
const galManifest = JSON.parse(
  fs.readFileSync(path.join(GALLERY, "manifest.json"), "utf8")
);
for (const e of galManifest.entries || []) {
  const dir = path.join(GALLERY, e.id);
  if (!fs.existsSync(dir)) continue;
  for (const name of ["cello.mp4", "solfege.mp4", "poster.jpg"]) {
    const fp = path.join(dir, name);
    if (!fs.existsSync(fp)) continue;
    const key = `gallery/${e.id}/${name}`;
    console.log("R2 ←", key);
    putFile(fp, key);
  }
}

// —— R2: library ——
const libManifest = JSON.parse(
  fs.readFileSync(path.join(LIBRARY, "manifest.json"), "utf8")
);
for (const e of libManifest.entries || []) {
  const fp = path.join(LIBRARY, e.filename);
  if (!fs.existsSync(fp)) continue;
  const key = `library/${e.filename}`;
  console.log("R2 ←", key);
  putFile(fp, key);
}

// —— D1 seed via temp SQL ——
const seedPath = path.join(CF, "scripts", "_seed_generated.sql");
const lines = ["BEGIN TRANSACTION;"];

for (const e of galManifest.entries || []) {
  const dir = path.join(GALLERY, e.id);
  const hasCello = fs.existsSync(path.join(dir, "cello.mp4")) ? 1 : 0;
  const hasSolfege = fs.existsSync(path.join(dir, "solfege.mp4")) ? 1 : 0;
  const hasPoster = fs.existsSync(path.join(dir, "poster.jpg")) ? 1 : 0;
  const title = String(e.title || e.id).replace(/'/g, "''");
  const artist = String(e.artist || "未知歌手").replace(/'/g, "''");
  const pos = e.posLabel ? `'${String(e.posLabel).replace(/'/g, "''")}'` : "NULL";
  const ts = Number(e.updatedAt || e.addedAt || Date.now());
  lines.push(
    `INSERT INTO gallery (id, title, artist, pos_label, has_poster, has_cello, has_solfege, updated_at)
     VALUES ('${e.id}', '${title}', '${artist}', ${pos}, ${hasPoster}, ${hasCello}, ${hasSolfege}, ${ts})
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, artist=excluded.artist, pos_label=excluded.pos_label,
       has_poster=excluded.has_poster, has_cello=excluded.has_cello,
       has_solfege=excluded.has_solfege, updated_at=excluded.updated_at;`
  );
}

for (const e of libManifest.entries || []) {
  const title = String(e.title || e.id).replace(/'/g, "''");
  const artist = String(e.artist || "未知歌手").replace(/'/g, "''");
  const filename = String(e.filename).replace(/'/g, "''");
  const source = String(e.source || "demo").replace(/'/g, "''");
  const featured = e.featured ? 1 : 0;
  const ts = Number(e.lastUsedAt || e.addedAt || Date.now());
  lines.push(
    `INSERT INTO library (id, title, artist, filename, source, featured, updated_at)
     VALUES ('${e.id}', '${title}', '${artist}', '${filename}', '${source}', ${featured}, ${ts})
     ON CONFLICT(id) DO UPDATE SET
       title=excluded.title, artist=excluded.artist, filename=excluded.filename,
       source=excluded.source, featured=excluded.featured, updated_at=excluded.updated_at;`
  );
}

lines.push("COMMIT;");
fs.writeFileSync(seedPath, lines.join("\n"));
run(["d1", "execute", "tangtang-db", "--remote", "--file", seedPath]);
console.log("\nsync 完成：R2 媒体 + D1 元数据已写入");
