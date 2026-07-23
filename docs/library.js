/**
 * 琴谱库：MusicXML 下载（本机 API + 公网静态清单）
 */
const listEl = document.getElementById("library-list");
const metaEl = document.getElementById("library-meta");

const SOURCE_LABEL = {
  builtin: "精选",
  demo: "工作台",
  upload: "用户贡献",
  omr: "识谱入库",
};

const DIFFICULTY = {
  "kongkong-demo": 1,
  "c-major-scale": 1,
  "first-love": 2,
  "hao-jiu-bu-jian": 2,
  "moon-river-multi": 2,
  "yi-bu-zhi-yao": 3,
};

const DIFF_LABEL = { 1: "入门", 2: "进阶", 3: "挑战" };

function isStaticSite() {
  return Boolean(document.querySelector('meta[name="tang-static"]'));
}

function siteRoot() {
  const baseEl = document.querySelector("base");
  if (baseEl?.href) {
    try {
      const u = new URL(baseEl.href, location.href);
      let p = u.pathname;
      if (!p.endsWith("/")) p += "/";
      return p;
    } catch {
      /* fall through */
    }
  }
  const path = location.pathname || "/";
  if (path.includes("/TangTang-workbench/")) return "/TangTang-workbench/";
  if (path.endsWith(".html")) {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    return dir || "/";
  }
  return path.endsWith("/") ? path : `${path}/`;
}

function assetUrl(rel) {
  return `${siteRoot()}${String(rel || "").replace(/^\/+/, "")}`;
}

function formatTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindDownload(el, url, opts) {
  if (!el || !url) return;
  if (window.TangDownload) {
    window.TangDownload.bindDownload(el, url, opts);
    return;
  }
  el.href = url;
  el.setAttribute("download", opts?.filename || "");
}

function difficultyClass(level) {
  if (level === 1) return "is-easy";
  if (level === 3) return "is-hard";
  return "is-mid";
}

function mapStaticEntry(e) {
  const level = DIFFICULTY[e.id] || 2;
  const filename = e.filename || `${e.id}.musicxml`;
  const title = e.title || e.id;
  return {
    id: e.id,
    title,
    artist: e.artist || "未知歌手",
    source: e.source || "demo",
    featured: Boolean(e.featured),
    uses: e.uses || 1,
    addedAt: e.addedAt,
    lastUsedAt: e.lastUsedAt,
    canDownload: true,
    difficulty: DIFF_LABEL[level],
    difficultyLevel: level,
    downloadName: `${title}.musicxml`.replace(/[\\/:*?"<>|]+/g, ""),
    downloadUrl: assetUrl(`library/${filename}`),
  };
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function loadStaticLibrary() {
  const data = await fetchJson(
    `${assetUrl("library/manifest.json")}?v=${Date.now()}`
  );
  if (!data) return [];
  return (Array.isArray(data.entries) ? data.entries : [])
    .map(mapStaticEntry)
    .sort(
      (a, b) =>
        (b.lastUsedAt || b.addedAt || 0) - (a.lastUsedAt || a.addedAt || 0)
    );
}

function renderEntries(entries) {
  metaEl.textContent = entries.length
    ? `共 ${entries.length} 首 · 入门 / 进阶 / 挑战`
    : "曲目会随识谱逐渐丰富";
  listEl.innerHTML = "";

  if (!entries.length) {
    const empty = document.createElement("article");
    empty.className = "library-row";
    empty.innerHTML = `
      <div class="library-row-copy">
        <h2>还没有可下载曲目</h2>
        <p>回首页上传谱面，识别成功后会自动入库供下载</p>
      </div>
      <a class="btn-dl library-dl" href="${escapeHtml(siteRoot())}">回首页上传</a>
    `;
    listEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("article");
    const level = entry.difficultyLevel || 2;
    row.className = `library-row ${difficultyClass(level)}`;
    const source = SOURCE_LABEL[entry.source] || entry.source || "";
    const artist = entry.artist || "未知歌手";
    const used = formatTime(entry.lastUsedAt);
    const diff = entry.difficulty || "进阶";
    const canDl = entry.canDownload && entry.downloadUrl;
    const action = canDl
      ? `<a class="btn-dl library-dl" data-dl href="${escapeHtml(
          entry.downloadUrl
        )}">下载乐谱</a>`
      : `<span class="library-view-only">暂不可下载</span>`;

    row.innerHTML = `
      <div class="library-row-copy">
        <div class="library-row-titleline">
          <h2>${escapeHtml(entry.title)}</h2>
          <span class="diff-badge" data-level="${level}">${escapeHtml(diff)}</span>
        </div>
        <p>${escapeHtml(artist)} · ${escapeHtml(source)}${
          used ? ` · ${escapeHtml(used)}` : ""
        }</p>
      </div>
      ${action}
    `;
    listEl.appendChild(row);

    if (canDl) {
      const a = row.querySelector("[data-dl]");
      bindDownload(a, entry.downloadUrl, {
        filename: entry.downloadName || `${entry.title}.musicxml`,
        album: false,
      });
    }
  }
}

async function loadLibrary() {
  if (!listEl || !metaEl) return;

  // 公网静态站：直接读打包进去的 library/manifest.json
  if (isStaticSite()) {
    try {
      const entries = await loadStaticLibrary();
      renderEntries(entries);
      if (!entries.length) {
        metaEl.textContent = "暂无谱面数据，请重新部署同步";
      }
    } catch (e) {
      metaEl.textContent = e.message || "加载失败";
    }
    return;
  }

  try {
    const res = await fetch("/api/library", { cache: "no-store" });
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    renderEntries(data.entries || []);
  } catch (e) {
    // 本机 API 挂了时，仍尝试静态兜底
    const entries = await loadStaticLibrary();
    if (entries.length) {
      renderEntries(entries);
      return;
    }
    metaEl.textContent = e.message || "加载失败";
  }
}

loadLibrary();

// 旧链接 library.html#gallery → 成片页
if (location.hash === "#gallery") {
  location.replace(`${siteRoot()}gallery.html${location.search}`);
}
