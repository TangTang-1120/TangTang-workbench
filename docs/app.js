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

/** 首页搜索 → 跳转琴谱库成片区（谱面卡片样式） */
function bindScoreSearch() {
  const searchForm = document.getElementById("score-search");
  const input = document.getElementById("score-search-input");
  if (!searchForm || !input) return;

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = (input.value || "").trim();
    const url = q
      ? `/TangTang-workbench/gallery.html?q=${encodeURIComponent(q)}`
      : `/TangTang-workbench/gallery.html`;
    window.location.href = url;
  });
}

bindScoreSearch();
