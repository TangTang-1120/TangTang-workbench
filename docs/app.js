const form = document.getElementById("form");
const fileInput = document.getElementById("file");
const fileName = document.getElementById("file-name");
const submit = document.getElementById("submit");
const progress = document.getElementById("progress");
const bar = document.getElementById("bar");
const statusEl = document.getElementById("status");
const results = document.getElementById("results");
const uploadPanel = document.getElementById("upload-panel");
const again = document.getElementById("again");
const searchPanel = document.getElementById("home-search-results");
const searchList = document.getElementById("home-search-list");
const searchTitle = document.getElementById("home-search-title");

function setFile(file) {
  if (!file) return;
  fileName.textContent = file.name;
  submit.disabled = false;
}

function bindDownload(el, url, opts) {
  if (!el || !url) return;
  if (window.TangDownload) {
    window.TangDownload.bindDownload(el, url, opts);
    return;
  }
  el.href = url;
  el.setAttribute("download", "");
  el.onclick = (e) => {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    if (isIOS) {
      e.preventDefault();
      window.location.href = url;
    }
  };
}

async function poll(id) {
  const res = await fetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error("无法查询进度");
  return res.json();
}

function showResults(job) {
  progress.classList.add("hidden");
  results.classList.remove("hidden");
  document.getElementById("piece-title").textContent = job.title || "成片";

  const sol = job.videos.solfege;
  const cel = job.videos.cello;
  document.getElementById("v-solfege").src = sol;
  document.getElementById("v-cello").src = cel;
  const title = (job.title || "成片").replace(/[\\/:*?"<>|]+/g, "");
  bindDownload(document.getElementById("dl-solfege"), job.downloads?.solfege || sol, {
    filename: `${title}-唱音阶.mp4`,
    album: true,
  });
  bindDownload(document.getElementById("dl-cello"), job.downloads?.cello || cel, {
    filename: `${title}-大提琴.mp4`,
    album: true,
  });
  bindDownload(
    document.getElementById("dl-fingerings"),
    job.downloads?.fingerings || job.fingeringsUrl,
    { filename: `${title}-指法.json`, album: false }
  );
  results.scrollIntoView({ behavior: "smooth", block: "start" });
  loadGallery();
}

async function watchJob(job) {
  progress.classList.remove("hidden");
  results.classList.add("hidden");
  bar.style.width = `${Math.max(4, job.percent || 2)}%`;
  statusEl.textContent = job.message || "处理中…";

  let cur = job;
  while (cur.status === "queued" || cur.status === "running") {
    bar.style.width = `${Math.max(4, cur.percent || 0)}%`;
    statusEl.textContent = cur.message || "处理中…";
    await new Promise((r) => setTimeout(r, 800));
    cur = await poll(job.id);
  }
  if (cur.status === "error") throw new Error(cur.error || "生成失败");
  bar.style.width = "100%";
  statusEl.textContent = cur.message || "完成";
  showResults(cur);
}

async function startUpload(file) {
  if (!file) return;
  setFile(file);
  submit.disabled = true;
  statusEl.textContent = "上传中…";
  progress.classList.remove("hidden");
  results.classList.add("hidden");
  bar.style.width = "2%";

  const body = new FormData();
  body.append("score", file);

  try {
    const up = await fetch("/api/upload", { method: "POST", body });
    const job = await up.json();
    if (!up.ok) throw new Error(job.error || "上传失败");
    await watchJob(job);
  } catch (err) {
    statusEl.textContent = err.message || "出错了";
    submit.disabled = false;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await startUpload(fileInput.files?.[0]);
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) startUpload(f);
});

again.addEventListener("click", () => {
  results.classList.add("hidden");
  progress.classList.add("hidden");
  uploadPanel.classList.remove("hidden");
  form.reset();
  fileName.textContent = "";
  submit.disabled = true;
  bar.style.width = "0%";
  fileInput.click();
});

let galleryEntries = [];
let galleryQuery = "";
let showAllPieces = false;

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isStaticSite() {
  return Boolean(document.querySelector('meta[name="tang-static"]'));
}

function pieceRowHtml(e) {
  const title = e.title || "成片";
  const artist = e.artist || "未知歌手";
  const id = encodeURIComponent(e.id || "");
  const staticBase = `gallery/${id}`;
  const dlCello =
    e.downloadCelloUrl ||
    e.downloadUrl ||
    (isStaticSite()
      ? `${staticBase}/cello.mp4`
      : `/api/gallery/${id}/download/cello`);
  const dlSolfege =
    e.downloadSolfegeUrl ||
    (isStaticSite()
      ? `${staticBase}/solfege.mp4`
      : `/api/gallery/${id}/download/solfege`);

  return `<article class="home-piece-row">
    <div class="home-piece-copy">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(artist)}</p>
    </div>
    <div class="home-piece-actions">
      <a class="home-piece-btn home-piece-btn-sol" href="${escapeHtml(dlSolfege)}" data-download-name="${escapeHtml(title + "-跟唱.mp4")}">跟唱</a>
      <a class="home-piece-btn home-piece-btn-cello" href="${escapeHtml(dlCello)}" data-download-name="${escapeHtml(title + "-大提琴.mp4")}">大提琴</a>
    </div>
  </article>`;
}

function filteredGalleryEntries() {
  const q = galleryQuery.trim().toLowerCase();
  if (!q && !showAllPieces) return [];
  if (!q && showAllPieces) return galleryEntries;
  return galleryEntries.filter((e) => {
    const title = String(e.title || "").toLowerCase();
    const artist = String(e.artist || "").toLowerCase();
    const id = String(e.id || "").toLowerCase();
    return title.includes(q) || artist.includes(q) || id.includes(q);
  });
}

function renderHomeSearch() {
  if (!searchPanel || !searchList) return;
  const q = galleryQuery.trim();
  const entries = filteredGalleryEntries();
  const shouldShow = showAllPieces || !!q;

  searchPanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    searchList.innerHTML = "";
    return;
  }

  if (searchTitle) {
    searchTitle.textContent = q
      ? `「${q}」· ${entries.length} 首`
      : `全部成片 · ${entries.length} 首`;
  }

  if (!entries.length) {
    searchList.innerHTML = `<p class="home-search-empty">没有匹配的成片</p>`;
    return;
  }

  searchList.innerHTML = entries.map((e) => pieceRowHtml(e)).join("");
  searchList.querySelectorAll("[data-download-name]").forEach((el) => {
    const href = el.getAttribute("href");
    const name = el.getAttribute("data-download-name") || "video.mp4";
    bindDownload(el, href, { filename: name, album: true });
  });
}

async function loadStaticGalleryManifest() {
  const res = await fetch("gallery/manifest.json");
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data.entries) ? data.entries : []).map((e) => ({
    ...e,
    videoUrl: `gallery/${e.id}/cello.mp4`,
    solfegeUrl: `gallery/${e.id}/solfege.mp4`,
    posterUrl: e.hasPoster ? `gallery/${e.id}/poster.jpg` : null,
    downloadCelloUrl: `gallery/${e.id}/cello.mp4`,
    downloadSolfegeUrl: `gallery/${e.id}/solfege.mp4`,
  }));
}

async function loadGallery() {
  galleryEntries = [];
  const staticMode = isStaticSite();
  try {
    if (!staticMode) {
      const res = await fetch("/api/gallery");
      if (res.ok) {
        const data = await res.json();
        galleryEntries = Array.isArray(data.entries) ? data.entries : [];
      }
    }
  } catch {
    galleryEntries = [];
  }
  if (!galleryEntries.length) {
    try {
      galleryEntries = await loadStaticGalleryManifest();
    } catch {
      galleryEntries = [];
    }
  }
  renderHomeSearch();
}

function bindScoreSearch() {
  const searchForm = document.getElementById("score-search");
  const input = document.getElementById("score-search-input");
  if (!searchForm || !input) return;

  const apply = ({ scroll } = {}) => {
    galleryQuery = input.value || "";
    showAllPieces = false;
    renderHomeSearch();
    if (scroll && (galleryQuery.trim() || showAllPieces) && searchPanel) {
      searchPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    apply({ scroll: true });
  });
  input.addEventListener("input", () => apply({ scroll: false }));
}

function bindGalleryNav() {
  document.querySelectorAll('[data-wb-nav="gallery"]').forEach((el) => {
    el.addEventListener("click", () => {
      showAllPieces = true;
      galleryQuery = "";
      const input = document.getElementById("score-search-input");
      if (input) input.value = "";
      renderHomeSearch();
      searchPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

bindScoreSearch();
bindGalleryNav();
loadGallery().then(() => {
  if (location.hash === "#home-search-results") {
    showAllPieces = true;
    galleryQuery = "";
    const input = document.getElementById("score-search-input");
    if (input) input.value = "";
    renderHomeSearch();
  }
});
