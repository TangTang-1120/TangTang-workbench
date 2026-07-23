/**
 * 手机端把成片存进相册：
 * 跳转专用保存页 → Web Share「存储到照片」；失败则打开原生 mp4。
 */
(function (global) {
  function ua() {
    return navigator.userAgent || "";
  }

  function isMobileUa() {
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua())) return true;
    if (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || "")) {
      return true;
    }
    return false;
  }

  function isIos() {
    if (/iPad|iPhone|iPod/.test(ua())) return true;
    if (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || "")) {
      return true;
    }
    return false;
  }

  function isWeChatLike() {
    return /MicroMessenger|QQ\//i.test(ua());
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, document.baseURI || location.href).href;
    } catch {
      return url;
    }
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
      return path.slice(0, path.lastIndexOf("/") + 1) || "/";
    }
    return path.endsWith("/") ? path : `${path}/`;
  }

  function asciiShareName(filename) {
    const ext = (filename.match(/\.[^.]+$/) || [".mp4"])[0];
    const base = filename.replace(/\.[^.]+$/, "") || "tangtang";
    const safe = base
      .replace(/[^\w\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `${safe || "tangtang-video"}${ext}`;
  }

  function savePageUrl(videoUrl, filename, title) {
    const q = new URLSearchParams({
      src: absoluteUrl(videoUrl),
      name: asciiShareName(filename.endsWith(".mp4") ? filename : `${filename}.mp4`),
      title: title || filename.replace(/\.mp4$/i, "") || "成片",
    });
    return `${siteRoot()}save-video.html?${q.toString()}`;
  }

  async function fetchVideoFile(url, filename) {
    const abs = absoluteUrl(url);
    const res = await fetch(abs, {
      credentials: "same-origin",
      cache: "no-cache",
      mode: "cors",
    });
    if (!res.ok) throw new Error("视频获取失败");
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 1024) throw new Error("视频文件异常");
    const shareName = asciiShareName(
      filename.endsWith(".mp4") ? filename : `${filename}.mp4`
    );
    return new File([buf], shareName, { type: "video/mp4" });
  }

  async function shareFileToAlbum(file) {
    if (!navigator.share) throw new Error("不支持系统分享");
    const payload = { files: [file], title: file.name.replace(/\.mp4$/i, "") };
    await navigator.share(payload);
  }

  async function androidBlobDownload(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function saveMediaToAlbum(url, filename) {
    if (isWeChatLike()) {
      throw new Error("WECHAT");
    }

    const file = await fetchVideoFile(url, filename);

    if (navigator.share) {
      try {
        await shareFileToAlbum(file);
        return "shared";
      } catch (err) {
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
          return "cancelled";
        }
      }
    }

    if (!isIos()) {
      try {
        await androidBlobDownload(file);
        return "downloaded";
      } catch {
        /* fall through */
      }
    }

    // 原生打开 mp4：系统播放器里分享 → 存储到照片（最稳）
    location.href = absoluteUrl(url);
    return "opened";
  }

  function bindClassicDownload(el, url, filename) {
    const abs = absoluteUrl(url);
    el.href = abs;
    if (filename) el.setAttribute("download", filename);
    else el.setAttribute("download", "");
    el.onclick = (e) => {
      if (!isMobileUa()) return;
      if (isWeChatLike()) {
        e.preventDefault();
        alert("微信里请点右上角 ··· →「在浏览器中打开」后再下载。");
        return;
      }
      if (isIos()) {
        e.preventDefault();
        window.open(abs, "_blank", "noopener");
      }
    };
  }

  function bindDownload(el, url, opts = {}) {
    if (!el || !url) return;
    const filename = opts.filename || "video.mp4";
    const title = opts.title || filename.replace(/\.mp4$/i, "");
    const wantAlbum =
      opts.album === true ||
      (opts.album !== false && /\.mp4($|\?)/i.test(filename));
    const mobile = isMobileUa();
    const abs = absoluteUrl(url);

    if (mobile && wantAlbum) {
      if (!el.dataset.origLabel) el.dataset.origLabel = el.textContent.trim();
      el.textContent = isIos() ? "存到照片" : "保存到相册";
      el.removeAttribute("download");
      // 直接去专用保存页（比卡片里点按钮可靠得多）
      el.href = savePageUrl(abs, filename, title);
      el.onclick = null;
      return;
    }

    bindClassicDownload(el, abs, filename);
  }

  global.TangDownload = {
    isMobileUa,
    isIos,
    isWeChatLike,
    bindDownload,
    saveMediaToAlbum,
    savePageUrl,
  };
})(window);
