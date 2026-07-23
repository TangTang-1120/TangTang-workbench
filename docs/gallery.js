/**
 * 成片页：琴谱库曲目全部以早期竖屏卡片展示（上传 + 跟唱/大提琴）
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

function uploadCardHtml() {
  return `<a class="video-card video-card-upload" href="/TangTang-workbench/#upload-panel" aria-label="上传谱面">
    <div class="video-card-upload-inner">
      <span class="video-card-upload-plus" aria-hidden="true">+</span>
      <strong>上传</strong>
      <span>谱面 PNG / MusicXML</span>
    </div>
  </a>`;
}

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
        <a class="video-card-dl" href="${escapeHtml(dlSolfege)}" data-download-name="${escapeHtml(
          title + "-跟唱.mp4"
        )}">跟唱</a>
        <a class="video-card-dl" href="${escapeHtml(dlCello)}" data-download-name="${escapeHtml(
          title + "-大提琴.mp4"
        )}">大提琴</a>
      </div>
    </div>
  </article>`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function loadStaticGalleryManifest() {
  const data = await fetchJson(
    isStaticSite() ? "gallery/manifest.json" : "/TangTang-workbench/gallery/manifest.json"
  );
  if (!data) return [];
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

/**
 * 以琴谱库曲目为主列表，合并成片视频信息（保证库里有的都进成片 Tab）
 */
function mergeLibraryIntoGallery(libraryEntries, galleryEntries) {
  const byId = new Map(
    (galleryEntries || []).map((e) => [e.id, e])
  );
  const prefix = isStaticSite() ? "gallery" : "/TangTang-workbench/gallery";
  const apiPrefix = isStaticSite() ? "gallery" : "/api/gallery";

  const merged = (libraryEntries || []).map((lib) => {
    const g = byId.get(lib.id);
    if (g) {
      byId.delete(lib.id);
      return {
        ...g,
        title: lib.title || g.title,
        artist: lib.artist || g.artist,
        posLabel: g.posLabel || null,
      };
    }
    // 库里有、画廊清单暂无：仍按约定路径出卡（有文件就能播）
    return {
      id: lib.id,
      title: lib.title,
      artist: lib.artist || "未知歌手",
      posLabel: null,
      videoUrl: `${prefix}/${lib.id}/cello.mp4`,
      solfegeUrl: `${prefix}/${lib.id}/solfege.mp4`,
      posterUrl: `${prefix}/${lib.id}/poster.jpg`,
      downloadCelloUrl: isStaticSite()
        ? `${prefix}/${lib.id}/cello.mp4`
        : `${apiPrefix}/${encodeURIComponent(lib.id)}/download/cello`,
      downloadSolfegeUrl: isStaticSite()
        ? `${prefix}/${lib.id}/solfege.mp4`
        : `${apiPrefix}/${encodeURIComponent(lib.id)}/download/solfege`,
    };
  });

  // 画廊里多出来的（不在库中）也保留
  for (const leftover of byId.values()) merged.push(leftover);
  return merged;
}

async function loadGallery() {
  if (!grid) return;

  let libraryEntries = [];
  let galleryEntries = [];

  if (!isStaticSite()) {
    const [libData, galData, manData] = await Promise.all([
      fetchJson("/api/library"),
      fetchJson("/api/gallery"),
      fetchJson("/TangTang-workbench/gallery/manifest.json"),
    ]);
    libraryEntries = Array.isArray(libData?.entries) ? libData.entries : [];
    galleryEntries = Array.isArray(galData?.entries) ? galData.entries : [];
    // 补 posLabel（manifest 有、API 可能尚未热更新）
    const posById = new Map(
      (Array.isArray(manData?.entries) ? manData.entries : []).map((e) => [
        e.id,
        e.posLabel || null,
      ])
    );
    galleryEntries = galleryEntries.map((e) => ({
      ...e,
      posLabel: e.posLabel || posById.get(e.id) || null,
    }));
  }

  if (!galleryEntries.length) {
    galleryEntries = await loadStaticGalleryManifest();
  }
  if (!libraryEntries.length && galleryEntries.length) {
    libraryEntries = galleryEntries.map((e) => ({
      id: e.id,
      title: e.title,
      artist: e.artist,
    }));
  }

  let entries = mergeLibraryIntoGallery(libraryEntries, galleryEntries);

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
    galleryTitle.textContent = `跟谱视频 · ${entries.length} 首`;
  }

  if (galleryMeta) {
    galleryMeta.textContent = entries.length
      ? `共 ${entries.length} 首 · 点击播放预览谱面，或下载跟唱 / 大提琴`
      : "暂无成片，可先上传谱面";
  }

  const cards = entries.map((e) => videoCardHtml(e)).join("");
  grid.innerHTML = `${uploadCardHtml()}${
    cards || `<p class="home-search-empty gallery-empty">没有匹配的成片</p>`
  }`;

  grid.querySelectorAll("[data-download-name]").forEach((el) => {
    const href = el.getAttribute("href");
    const name = el.getAttribute("data-download-name") || "video.mp4";
    bindDownload(el, href, { filename: name, album: true });
  });
}

loadGallery();
