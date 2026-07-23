/**
 * 乐谱大提琴：全屏可推，推到哪算哪；出屏幕即离开可见区
 */
(() => {
  const stage = document.getElementById("score-cello-stage");
  const canvas = document.getElementById("score-cello-canvas");
  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const SRC = "assets/cello-score-art.png";

  /** @type {HTMLCanvasElement | null} */
  let source = null;
  /** @type {{sx:number,sy:number,sw:number,sh:number,hx:number,hy:number,x:number,y:number,vx:number,vy:number}[]} */
  let notes = [];
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let raf = 0;
  let ready = false;
  let celloBox = { x: 0, y: 0, w: 0, h: 0 };

  let prev = { x: 0, y: 0, on: false };
  let cursor = { x: 0, y: 0, on: false, pushing: false };

  const PATCH = 10;
  const INK_MAX = 198;
  const PUSH_R = 64;
  const PUSH_GAIN = 2.1;
  const FRICTION = 0.925;
  const MAX_SPEED = 56;
  const CURSOR_NOTE = "♪";

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = stage.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(rect.width));
    cssH = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bakeAndSlice();
  }

  function bakeAndSlice() {
    if (!img || !img.naturalWidth) return;
    const off = document.createElement("canvas");
    off.width = cssW;
    off.height = cssH;
    const o = off.getContext("2d", { willReadFrequently: true });
    if (!o) return;

    o.fillStyle = "#ffffff";
    o.fillRect(0, 0, cssW, cssH);

    // 全屏完整容纳整把大提琴（不裁切）
    const brandGap = Math.min(108, cssH * 0.14);
    const bottomPad = Math.min(24, cssH * 0.03);
    const availW = cssW * 0.92;
    const availH = Math.max(120, cssH - brandGap - bottomPad);
    const scale = Math.min(
      availW / img.naturalWidth,
      availH / img.naturalHeight
    );
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const ox = (cssW - dw) / 2;
    const oy = brandGap + Math.max(0, (availH - dh) * 0.35);
    o.drawImage(img, ox, oy, dw, dh);
    celloBox = { x: ox, y: oy, w: dw, h: dh };
    source = off;

    const kept = notes.map((n) => ({
      hx: n.hx,
      hy: n.hy,
      x: n.x,
      y: n.y,
      vx: n.vx,
      vy: n.vy,
    }));

    notes = [];
    const data = o.getImageData(0, 0, cssW, cssH).data;
    for (let y = 0; y < cssH; y += PATCH) {
      for (let x = 0; x < cssW; x += PATCH) {
        const sw = Math.min(PATCH, cssW - x);
        const sh = Math.min(PATCH, cssH - y);
        let ink = 0;
        let samples = 0;
        for (let py = 0; py < sh; py += 2) {
          for (let px = 0; px < sw; px += 2) {
            const i = ((y + py) * cssW + (x + px)) * 4;
            const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (lum < INK_MAX) ink++;
            samples++;
          }
        }
        if (!samples || ink / samples < 0.12) continue;

        const hx = x + sw * 0.5;
        const hy = y + sh * 0.5;
        let x0 = hx;
        let y0 = hy;
        let vx = 0;
        let vy = 0;
        let best = 18;
        for (const k of kept) {
          const d = Math.hypot(k.hx - hx, k.hy - hy);
          if (d < best) {
            best = d;
            // 按相对位移比例迁移到新画布
            x0 = hx + (k.x - k.hx);
            y0 = hy + (k.y - k.hy);
            vx = k.vx;
            vy = k.vy;
          }
        }

        notes.push({ sx: x, sy: y, sw, sh, hx, hy, x: x0, y: y0, vx, vy });
      }
    }
  }

  function pushNotes(mx, my, mdx, mdy) {
    const speed = Math.hypot(mdx, mdy);
    if (speed < 0.12) return;

    for (const n of notes) {
      const dx = n.x - mx;
      const dy = n.y - my;
      const dist = Math.hypot(dx, dy);
      if (dist > PUSH_R) continue;

      const fall = 1 - dist / PUSH_R;
      const force = fall * fall * PUSH_GAIN;
      n.vx += mdx * force;
      n.vy += mdy * force;
      if (dist > 0.001) {
        n.vx += (dx / dist) * fall * speed * 0.14;
        n.vy += (dy / dist) * fall * speed * 0.14;
      }
    }
  }

  function integrate() {
    for (const n of notes) {
      let sp = Math.hypot(n.vx, n.vy);
      if (sp > MAX_SPEED) {
        n.vx = (n.vx / sp) * MAX_SPEED;
        n.vy = (n.vy / sp) * MAX_SPEED;
      }
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= FRICTION;
      n.vy *= FRICTION;
      if (Math.abs(n.vx) < 0.02) n.vx = 0;
      if (Math.abs(n.vy) < 0.02) n.vy = 0;
      // 不设区域夹紧：出屏幕就离开可见区
    }
  }

  function paint() {
    raf = requestAnimationFrame(paint);
    if (!ready || !source) return;

    integrate();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    // 原位琴影（淡）—— 只画琴身矩形，避免整屏白块感
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.drawImage(
      source,
      celloBox.x,
      celloBox.y,
      celloBox.w,
      celloBox.h,
      celloBox.x,
      celloBox.y,
      celloBox.w,
      celloBox.h
    );
    ctx.restore();

    const pad = PATCH * 2;
    for (const n of notes) {
      // 出屏幕则不画
      if (
        n.x < -pad ||
        n.y < -pad ||
        n.x > cssW + pad ||
        n.y > cssH + pad
      ) {
        continue;
      }
      ctx.drawImage(
        source,
        n.sx,
        n.sy,
        n.sw,
        n.sh,
        n.x - n.sw * 0.5,
        n.y - n.sh * 0.5,
        n.sw,
        n.sh
      );
    }

    // 滑鼠 = 音符标识
    if (cursor.on) {
      const t = performance.now() * 0.001;
      const size = cursor.pushing ? 34 : 28;
      ctx.save();
      ctx.translate(cursor.x, cursor.y);
      ctx.rotate(Math.sin(t * 6) * (cursor.pushing ? 0.18 : 0.08));
      ctx.fillStyle = "#0f766e";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.font = `700 ${size}px "Apple Color Emoji","Segoe UI Symbol","Noto Music",Georgia,serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(15, 118, 110, 0.35)";
      ctx.shadowBlur = cursor.pushing ? 14 : 8;
      ctx.strokeText(CURSOR_NOTE, 0, 0);
      ctx.fillText(CURSOR_NOTE, 0, 0);
      ctx.restore();
    }
  }

  function localPos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * cssW,
      y: ((e.clientY - rect.top) / rect.height) * cssH,
    };
  }

  function onMove(e) {
    const p = localPos(e);
    let pushing = false;
    if (prev.on) {
      const mdx = p.x - prev.x;
      const mdy = p.y - prev.y;
      pushing = Math.hypot(mdx, mdy) > 0.4;
      pushNotes(p.x, p.y, mdx, mdy);
    }
    prev.x = p.x;
    prev.y = p.y;
    prev.on = true;
    cursor.x = p.x;
    cursor.y = p.y;
    cursor.on = true;
    cursor.pushing = pushing;
    stage.classList.add("is-hover");
  }

  function onLeave() {
    prev.on = false;
    cursor.on = false;
    cursor.pushing = false;
    stage.classList.remove("is-hover");
  }

  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    resize();
    ready = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(paint);
  };
  img.src = SRC;

  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerenter", onMove);
  stage.addEventListener("pointerdown", onMove);
  stage.addEventListener("pointerleave", onLeave);

  window.addEventListener("resize", () => resize());
})();
