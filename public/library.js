/**
 * 琴谱库：成片（谱面预览卡片）+ MusicXML 下载
 */
const listEl = document.getElementById("library-list");
const metaEl = document.getElementById("library-meta");
const galleryGrid = document.getElementById("gallery-grid");
const galleryMeta = document.getElementById("gallery-meta");
const galleryTitle = document.getElementById("gallery-title");

const SOURCE_LABEL = {
  builtin: "精选",
  demo: "工作台",
  upload: "用户贡献",
  omr: "识谱入库",
};

function isStaticSite() {
  return Boolean(document.querySelector('meta[name="tang-static"]'));
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

function queryParam(name) {
  try {
    return new URLSearchParams(location.search).get(name) || "";
  } catch {
    return "";
  }
}

function videoCardHtml(e) {
  const title = e.title || "成片";
  const artist = e.artist || "未知歌手";
  const id = e.id || "";
  const poster = e.posterUrl || (e.hasPoster ? `/gallery/${id}/poster.jpg` : "");
  const videoSrc = e.videoUrl || e.solfegeUrl || `/gallery/${id}/solfege.mp4`;
  const dlSol =
    e.downloadSolfegeUrl ||
    (isStaticSite()
      ? `gallery/${id}/solfege.mp4`
      : `/api/gallery/${encodeURIComponent(id)}/download/solfege`);
  const dlCel =
    e.downloadCelloUrl ||
    e.downloadUrl ||
    (isStaticSite()
      ? `gallery/${id}/cello.mp4`
      : `/api/gallery/${encodeURIComponent(id)}/download/cello`);
  const pos = e.posLabel
    ? `<span class="video-card-pos" data-pos="${escapeHtml(e.posLabel)}">${escapeHtml(
        e.posLabel
      )}</span>`
    : "";

  return `<article class="video-card">
    <div class="video-card-media">
      <video
        src="${escapeHtml(videoSrc)}"
        ${poster ? `poster="${escapeHtml(poster)}"` : ""}
        controls
        playsinline
        preload="metadata"
      ></video>
    </div>
    <div class="video-card-body">
      <h3 class="video-card-title">
        <span class="video-card-title-text">${escapeHtml(title)}</span>
        ${pos}
      </h3>
      <p class="video-card-artist">${escapeHtml(artist)}</p>
      <div class="video-card-actions">
        <a class="video-card-dl" href="${escapeHtml(dlSol)}" data-download-name="${escapeHtml(
          title + "-跟唱.mp4"
        )}">跟唱</a>
        <a class="video-card-dl" href="${escapeHtml(dlCel)}" data-download-name="${escapeHtml(
          title + "-大提琴.mp4"
        )}">大提琴</a>
      </div>
    </div>
  </article>`;
}

async function loadStaticGalleryManifest() {
  const res = await fetch(
    isStaticSite() ? "gallery/manifest.json" : "/gallery/manifest.json"
  );
  if (!res.ok) return [];
  const data = await res.json();
  const prefix = isStaticSite() ? "gallery" : "/gallery";
  return (Array.isArray(data.entries) ? data.entries : []).map((e) => ({
    ...e,
    videoUrl: `${prefix}/${e.id}/solfege.mp4`,
    solfegeUrl: `${prefix}/${e.id}/solfege.mp4`,
    posterUrl: e.hasPoster ? `${prefix}/${e.id}/poster.jpg` : null,
    downloadCelloUrl: `${prefix}/${e.id}/cello.mp4`,
    downloadSolfegeUrl: `${prefix}/${e.id}/solfege.mp4`,
  }));
}

async function loadGallery() {
  if (!galleryGrid) return;
  let entries = [];
  try {
    if (!isStaticSite()) {
      const res = await fetch("/api/gallery");
      if (res.ok) {
        const data = await res.json();
        entries = Array.isArray(data.entries) ? data.entries : [];
      }
    }
  } catch {
    entries = [];
  }
  if (!entries.length) {
    try {
      entries = await loadStaticGalleryManifest();
    } catch {
      entries = [];
    }
  }

  const q = queryParam("q").trim().toLowerCase();
  if (q) {
    entries = entries.filter((e) => {
      const title = String(e.title || "").toLowerCase();
      const artist = String(e.artist || "").toLowerCase();
      const id = String(e.id || "").toLowerCase();
      return title.includes(q) || artist.includes(q) || id.includes(q);
    });
    if (galleryTitle) {
      galleryTitle.textContent = `「${queryParam("q")}」· ${entries.length} 首`;
    }
  } else if (galleryTitle) {
    galleryTitle.textContent = `跟唱 · 大提琴 · ${entries.length} 首`;
  }

  if (galleryMeta) {
    galleryMeta.textContent = entries.length
      ? "点击播放预览谱面成片，或下载跟唱 / 大提琴"
      : "暂无成片";
  }

  galleryGrid.innerHTML = entries.length
    ? entries.map((e) => videoCardHtml(e)).join("")
    : `<p class="home-search-empty">没有匹配的成片</p>`;

  galleryGrid.querySelectorAll("[data-download-name]").forEach((el) => {
    const href = el.getAttribute("href");
    const name = el.getAttribute("data-download-name") || "video.mp4";
    bindDownload(el, href, { filename: name, album: true });
  });
}

async function loadLibrary() {
  if (!listEl || !metaEl) return;
  try {
    const res = await fetch("/api/library");
    if (!res.ok) throw new Error("加载失败");
    const data = await res.json();
    const entries = data.entries || [];
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
        <a class="btn-dl library-dl" href="/">回首页上传</a>
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
  } catch (e) {
    // 静态站无 /api/library：尝试本地精选列表提示
    if (isStaticSite()) {
      metaEl.textContent = "公网静态站暂不提供 MusicXML API，请本机 npm start 后下载";
      listEl.innerHTML = `
        <article class="library-row">
          <div class="library-row-copy">
            <h2>谱面下载需服务器</h2>
            <p>成片仍可在上方直接播放与下载</p>
          </div>
          <a class="btn-dl library-dl" href="/">回首页</a>
        </article>`;
      return;
    }
    metaEl.textContent = e.message || "加载失败";
  }
}

loadGallery();
loadLibrary();

if (location.hash === "#gallery" || queryParam("q")) {
  document.getElementById("gallery")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
