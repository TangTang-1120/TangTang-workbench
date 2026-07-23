/**
 * 成片页：早期首页竖屏卡片（poster + video + 跟唱/大提琴）
 */
const grid = document.getElementById("gallery-grid");
const galleryMeta = document.getElementById("gallery-meta");
const galleryTitle = document.getElementById("gallery-title");

function isStaticSite() {
  return Boolean(document.querySelector('meta[name="tang-static"]'));
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

function queryParam(name) {
  try {
    return new URLSearchParams(location.search).get(name) || "";
  } catch {
    return "";
  }
}

/** 早期首页卡片样式 */
function videoCardHtml(e) {
  const title = e.title || "成片";
  const artist = e.artist || "未知歌手";
  const id = e.id || "";
  const poster = e.posterUrl
    ? `poster="${escapeHtml(e.posterUrl)}"`
    : e.hasPoster
      ? `poster="${escapeHtml(`/TangTang-workbench/gallery/${id}/poster.jpg`)}"`
      : "";
  const videoSrc =
    e.videoUrl || e.solfegeUrl || `/TangTang-workbench/gallery/${encodeURIComponent(id)}/cello.mp4`;
  const dlCello =
    e.downloadCelloUrl ||
    e.downloadUrl ||
    (isStaticSite()
      ? `gallery/${id}/cello.mp4`
      : `/api/gallery/${encodeURIComponent(id)}/download/cello`);
  const dlSolfege =
    e.downloadSolfegeUrl ||
    (isStaticSite()
      ? `gallery/${id}/solfege.mp4`
      : `/api/gallery/${encodeURIComponent(id)}/download/solfege`);
  const pos = e.posLabel
    ? `<span class="video-card-pos" data-pos="${escapeHtml(e.posLabel)}">${escapeHtml(
        e.posLabel
      )}</span>`
    : "";

  return `<article class="video-card">
    <div class="video-card-media">
      <video src="${escapeHtml(videoSrc)}" ${poster} controls playsinline preload="metadata"></video>
    </div>
    <div class="video-card-body">
      <h3 class="video-card-title">
        <span class="video-card-title-text">${escapeHtml(title)}</span>
        ${pos}
      </h3>
      <p class="video-card-artist">${escapeHtml(artist)}</p>
      <div class="video-card-actions">
        <a class="video-card-dl btn-dl" href="${escapeHtml(dlSolfege)}" data-download-name="${escapeHtml(
          title + "-跟唱.mp4"
        )}">跟唱</a>
        <a class="video-card-dl btn-dl" href="${escapeHtml(dlCello)}" data-download-name="${escapeHtml(
          title + "-大提琴.mp4"
        )}">大提琴</a>
      </div>
    </div>
  </article>`;
}

async function loadStaticGalleryManifest() {
  const res = await fetch(
    isStaticSite() ? "gallery/manifest.json" : "/TangTang-workbench/gallery/manifest.json"
  );
  if (!res.ok) return [];
  const data = await res.json();
  const prefix = isStaticSite() ? "gallery" : "/TangTang-workbench/gallery";
  return (Array.isArray(data.entries) ? data.entries : []).map((e) => ({
    ...e,
    videoUrl: `${prefix}/${e.id}/cello.mp4`,
    solfegeUrl: `${prefix}/${e.id}/solfege.mp4`,
    posterUrl: e.hasPoster ? `${prefix}/${e.id}/poster.jpg` : null,
    downloadCelloUrl: `${prefix}/${e.id}/cello.mp4`,
    downloadSolfegeUrl: `${prefix}/${e.id}/solfege.mp4`,
  }));
}

async function loadGallery() {
  if (!grid) return;
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
    if (galleryTitle) galleryTitle.textContent = `「${queryParam("q")}」· ${entries.length} 首`;
  } else if (galleryTitle) {
    galleryTitle.textContent = `跟唱 · 大提琴 · ${entries.length} 首`;
  }

  if (galleryMeta) {
    galleryMeta.textContent = entries.length
      ? "点击播放预览谱面，或下载跟唱 / 大提琴"
      : "暂无成片";
  }

  grid.innerHTML = entries.length
    ? entries.map((e) => videoCardHtml(e)).join("")
    : `<p class="home-search-empty">没有匹配的成片</p>`;

  grid.querySelectorAll("[data-download-name]").forEach((el) => {
    const href = el.getAttribute("href");
    const name = el.getAttribute("data-download-name") || "video.mp4";
    bindDownload(el, href, { filename: name, album: true });
  });
}

loadGallery();
