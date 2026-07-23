/**
 * 琴谱库：仅 MusicXML 下载
 */
const listEl = document.getElementById("library-list");
const metaEl = document.getElementById("library-meta");

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
    if (isStaticSite()) {
      metaEl.textContent = "公网静态站暂不提供 MusicXML API，请本机 npm start 后下载";
      listEl.innerHTML = `
        <article class="library-row">
          <div class="library-row-copy">
            <h2>谱面下载需服务器</h2>
            <p>成片请到侧栏「成片」页播放与下载</p>
          </div>
          <a class="btn-dl library-dl" href="gallery.html">去成片</a>
        </article>`;
      return;
    }
    metaEl.textContent = e.message || "加载失败";
  }
}

loadLibrary();

// 旧链接 library.html#gallery → 成片页
if (location.hash === "#gallery") {
  location.replace("/gallery.html" + location.search);
}
