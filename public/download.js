/**
 * 手机端把成片存进相册：
 * - 优先 Web Share「存储视频 / 保存到相册」
 * - 微信等内置浏览器能力差：引导系统浏览器，或长按视频保存
 * - 普通下载（MusicXML）走打开 / download
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

  function asciiShareName(filename) {
    const ext = (filename.match(/\.[^.]+$/) || [".mp4"])[0];
    const base = filename.replace(/\.[^.]+$/, "") || "tangtang";
    const safe = base
      .replace(/[^\w\-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return `${safe || "tangtang-video"}${ext}`;
  }

  function showTip(message) {
    alert(message);
  }

  function weChatGuide() {
    showTip(
      "微信里无法直接存相册。\n\n请点右上角 ··· →「在浏览器中打开」，\n再点「存到照片 / 保存到相册」。\n\n或在本页长按上方视频 →「存储到照片」。"
    );
  }

  async function fetchVideoFile(url, filename) {
    const abs = absoluteUrl(url);
    const res = await fetch(abs, {
      credentials: "same-origin",
      cache: "no-cache",
      mode: "cors",
    });
    if (!res.ok) throw new Error("视频获取失败，请检查网络后重试");
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 1024) {
      throw new Error("视频文件异常，请稍后重试");
    }
    const shareName = asciiShareName(
      filename.endsWith(".mp4") ? filename : `${filename}.mp4`
    );
    return new File([buf], shareName, { type: "video/mp4" });
  }

  async function shareFileToAlbum(file) {
    if (!navigator.share) {
      throw new Error("当前浏览器不支持系统分享");
    }
    const payload = {
      files: [file],
      title: file.name.replace(/\.mp4$/i, ""),
    };
    // iOS canShare 偶发误报，仍直接 share
    try {
      if (
        typeof navigator.canShare === "function" &&
        !navigator.canShare(payload) &&
        !navigator.canShare({ files: [file] })
      ) {
        /* still try */
      }
    } catch {
      /* ignore */
    }
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

  function openVideoForManualSave(url) {
    const abs = absoluteUrl(url);
    showTip(
      "请在打开的视频页：\n• iPhone：点分享 ▢↑ →「存储到照片」\n• 或返回本页，长按视频 →「存储到照片」"
    );
    const w = window.open(abs, "_blank", "noopener");
    if (!w) {
      // 弹窗被拦：同页跳转
      location.href = abs;
    }
  }

  async function saveMediaToAlbum(url, filename) {
    if (isWeChatLike()) {
      weChatGuide();
      return;
    }

    const file = await fetchVideoFile(url, filename);

    // 1) 系统分享（iOS「存储到照片」、Android「保存到相册/文件」）
    if (navigator.share) {
      try {
        await shareFileToAlbum(file);
        return;
      } catch (err) {
        if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
          return; // 用户取消
        }
        // 继续 fallback
      }
    }

    // 2) Android：blob 触发下载（多进「下载」；部分机可进相册）
    if (!isIos()) {
      try {
        await androidBlobDownload(file);
        showTip("已开始保存。请到「下载」或「相册 / 文件」中查看。");
        return;
      } catch {
        /* fall through */
      }
    }

    // 3) 打开视频，引导手动存
    openVideoForManualSave(url);
  }

  function bindClassicDownload(el, url, filename) {
    const abs = absoluteUrl(url);
    el.href = abs;
    if (filename) el.setAttribute("download", filename);
    else el.setAttribute("download", "");

    el.onclick = (e) => {
      if (!isMobileUa()) return;

      // 微信内：乐谱也很难下
      if (isWeChatLike()) {
        e.preventDefault();
        weChatGuide();
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
    const wantAlbum =
      opts.album === true ||
      (opts.album !== false && /\.mp4($|\?)/i.test(filename));
    const mobile = isMobileUa();
    const abs = absoluteUrl(url);

    if (mobile && wantAlbum) {
      if (!el.dataset.origLabel) el.dataset.origLabel = el.textContent.trim();
      el.textContent = isIos() ? "存到照片" : "保存到相册";
      el.removeAttribute("download");
      el.href = abs;
      el.setAttribute("role", "button");
      el.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el.getAttribute("aria-busy") === "true") return;

        const prev = el.textContent;
        el.textContent = "准备中…";
        el.setAttribute("aria-busy", "true");
        try {
          await saveMediaToAlbum(abs, filename);
        } catch (err) {
          if (
            err &&
            (err.name === "AbortError" || err.name === "NotAllowedError")
          ) {
            return;
          }
          if (isWeChatLike()) {
            weChatGuide();
          } else if (isIos()) {
            openVideoForManualSave(abs);
          } else {
            showTip(
              (err && err.message) ||
                "保存失败。请长按上方视频，选择「保存视频 / 下载」。"
            );
            window.open(abs, "_blank", "noopener");
          }
        } finally {
          el.textContent = prev;
          el.removeAttribute("aria-busy");
        }
      };
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
  };
})(window);
