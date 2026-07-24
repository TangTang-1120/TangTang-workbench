/**
 * 把 public 静态页拷到 cloudflare/site
 * 若 R2 尚未开通：同时打入 gallery + library 作为过渡媒体源
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "public");
const DEST = path.resolve(__dirname, "../site");
const GALLERY = path.join(ROOT, "output", "gallery");
const LIBRARY = path.join(ROOT, "scores", "library");
const INCLUDE_MEDIA = process.env.CF_INCLUDE_MEDIA !== "0";

function copyDir(from, to, { skip = [] } = {}) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skip.includes(name)) continue;
    const s = path.join(from, name);
    const d = path.join(to, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}

if (fs.existsSync(DEST)) fs.rmSync(DEST, { recursive: true, force: true });
copyDir(SRC, DEST, { skip: ["gallery"] });

const audioSrc = path.join(SRC, "audio");
const audioDest = path.join(DEST, "audio");
if (fs.existsSync(audioSrc)) {
  fs.mkdirSync(audioDest, { recursive: true });
  for (const f of fs.readdirSync(audioSrc)) {
    if (f.endsWith(".mp3")) {
      fs.copyFileSync(path.join(audioSrc, f), path.join(audioDest, f));
    }
  }
}

if (INCLUDE_MEDIA && fs.existsSync(GALLERY)) {
  copyDir(GALLERY, path.join(DEST, "gallery"));
  console.log("included output/gallery → site/gallery (R2 未开通时的过渡方案)");
}
if (INCLUDE_MEDIA && fs.existsSync(LIBRARY)) {
  const libDest = path.join(DEST, "library");
  fs.mkdirSync(libDest, { recursive: true });
  for (const f of fs.readdirSync(LIBRARY)) {
    if (f.endsWith(".musicxml") || f === "manifest.json") {
      fs.copyFileSync(path.join(LIBRARY, f), path.join(libDest, f));
    }
  }
  console.log("included scores/library → site/library");
}

for (const html of [
  "index.html",
  "gallery.html",
  "library.html",
  "admin.html",
  "save-video.html",
  "login.html",
]) {
  const p = path.join(DEST, html);
  if (!fs.existsSync(p)) continue;
  let t = fs.readFileSync(p, "utf8");
  t = t.replace(/\s*<base href="[^"]*"\s*\/>\n?/g, "\n");
  t = t.replace(/\s*<meta name="tang-static" content="1"\s*\/>\n?/g, "\n");
  t = t.replaceAll("/TangTang-workbench/", "/");
  fs.writeFileSync(p, t);
}

console.log("Built cloudflare/site");
