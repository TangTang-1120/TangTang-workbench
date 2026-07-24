/**
 * Tang Tang Cloudflare Worker
 * - /api/*  → D1 + R2 元数据 / 上传入队
 * - /gallery/* /library/* → R2 代理（流出走 R2 免费额度）
 * - 其余 → ASSETS（前端静态页）
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Render-Secret",
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extraHeaders,
    },
  });
}

function sessionCookie(token, maxAgeSec) {
  const secure = "Secure; ";
  return `tt_session=${token}; Path=/; HttpOnly; SameSite=Lax; ${secure}Max-Age=${maxAgeSec}`;
}

function clearSessionCookie() {
  return "tt_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}

function parseCookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSessionEmail(request, env) {
  const token = parseCookies(request).tt_session;
  if (!token) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT email FROM auth_sessions WHERE token = ? AND expires_at > ?`
  )
    .bind(token, now)
    .first();
  return row?.email || null;
}

async function sendAuthEmail(env, email, code) {
  const key = env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "no_resend" };
  const from = env.AUTH_FROM_EMAIL || "Tang Tang <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Tang Tang 登录验证码",
      text: `你的验证码是 ${code}，10 分钟内有效。\n\nTang Tang 大提琴跟谱工作台`,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { sent: false, reason: t.slice(0, 200) };
  }
  return { sent: true };
}

async function routeAuth(request, env, url) {
  const { pathname } = url;

  if (pathname === "/api/auth/me" && request.method === "GET") {
    const email = await getSessionEmail(request, env);
    if (!email) return json({ ok: false });
    return json({ ok: true, email });
  }

  if (pathname === "/api/auth/request-code" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "邮箱格式不正确" }, 400);
    }
    const allow = String(env.AUTH_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const open = String(env.AUTH_OPEN || "1") === "1";
    if (!open && allow.length && !allow.includes(email)) {
      return json({ error: "该邮箱暂未开放登录" }, 403);
    }

    const code = randomCode();
    const now = Date.now();
    const expires = now + 10 * 60 * 1000;
    await env.DB.prepare(
      `INSERT INTO auth_codes (email, code, expires_at, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         code=excluded.code,
         expires_at=excluded.expires_at,
         created_at=excluded.created_at`
    )
      .bind(email, code, expires, now)
      .run();

    const mail = await sendAuthEmail(env, email, code);
    const showDev =
      String(env.AUTH_DEV_SHOW_CODE || "0") === "1" || !mail.sent;
    return json({
      ok: true,
      message: mail.sent
        ? `验证码已发送至 ${email}`
        : `验证码已生成（邮件未发送时可直接用下方码）`,
      ...(showDev ? { devCode: code } : {}),
    });
  }

  if (pathname === "/api/auth/verify" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const code = String(body.code || "").replace(/\s/g, "");
    if (!email || !/^\d{6}$/.test(code)) {
      return json({ error: "请输入邮箱和 6 位验证码" }, 400);
    }
    const row = await env.DB.prepare(
      `SELECT code, expires_at FROM auth_codes WHERE email = ?`
    )
      .bind(email)
      .first();
    if (!row || row.code !== code) {
      return json({ error: "验证码错误" }, 401);
    }
    if (Number(row.expires_at) < Date.now()) {
      return json({ error: "验证码已过期，请重新发送" }, 401);
    }
    await env.DB.prepare(`DELETE FROM auth_codes WHERE email = ?`)
      .bind(email)
      .run();

    const token = randomToken();
    const now = Date.now();
    const expires = now + 30 * 24 * 60 * 60 * 1000;
    await env.DB.prepare(
      `INSERT INTO auth_sessions (token, email, created_at, expires_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind(token, email, now, expires)
      .run();

    return json(
      { ok: true, email },
      200,
      { "Set-Cookie": sessionCookie(token, 30 * 24 * 60 * 60) }
    );
  }

  if (pathname === "/api/auth/logout" && request.method === "POST") {
    const token = parseCookies(request).tt_session;
    if (token) {
      await env.DB.prepare(`DELETE FROM auth_sessions WHERE token = ?`)
        .bind(token)
        .run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
  }

  return null;
}

function guessContentType(key) {
  if (key.endsWith(".mp4")) return "video/mp4";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".musicxml") || key.endsWith(".xml")) return "application/xml";
  if (key.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

async function serveR2(env, key, downloadName, requestUrl) {
  if (env.MEDIA) {
    const obj = await env.MEDIA.get(key);
    if (obj) {
      const headers = new Headers();
      headers.set(
        "Content-Type",
        obj.httpMetadata?.contentType || guessContentType(key)
      );
      headers.set("Cache-Control", "public, max-age=3600");
      Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
      if (downloadName) {
        headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
      }
      return new Response(obj.body, { headers });
    }
  }

  // R2 未开通时：回退到 Assets 里的同名路径
  if (env.ASSETS && requestUrl) {
    const fallback = new URL(`/${key}`, requestUrl);
    const res = await env.ASSETS.fetch(fallback);
    if (res.ok) {
      const headers = new Headers(res.headers);
      Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
      if (downloadName) {
        headers.set(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
      }
      return new Response(res.body, { status: res.status, headers });
    }
  }
  return json({ error: "not found", key }, 404);
}

async function apiGallery(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, pos_label AS posLabel, has_poster AS hasPoster,
            has_cello AS hasCello, has_solfege AS hasSolfege, updated_at AS updatedAt
     FROM gallery
     WHERE has_cello = 1
     ORDER BY updated_at DESC`
  ).all();

  const entries = (results || []).map((e) => ({
    id: e.id,
    title: e.title,
    artist: e.artist || "未知歌手",
    posLabel: e.posLabel || null,
    videoUrl: `/gallery/${encodeURIComponent(e.id)}/cello.mp4`,
    solfegeUrl: e.hasSolfege
      ? `/gallery/${encodeURIComponent(e.id)}/solfege.mp4`
      : null,
    posterUrl: e.hasPoster
      ? `/gallery/${encodeURIComponent(e.id)}/poster.jpg`
      : null,
    downloadCelloUrl: `/api/gallery/${encodeURIComponent(e.id)}/download/cello`,
    downloadSolfegeUrl: e.hasSolfege
      ? `/api/gallery/${encodeURIComponent(e.id)}/download/solfege`
      : null,
    downloadUrl: `/api/gallery/${encodeURIComponent(e.id)}/download/cello`,
  }));
  return json({ entries });
}

async function apiLibrary(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, artist, filename, source, featured, updated_at AS updatedAt
     FROM library
     ORDER BY updated_at DESC`
  ).all();

  const entries = (results || []).map((e) => ({
    id: e.id,
    title: e.title,
    artist: e.artist || "未知歌手",
    filename: e.filename,
    source: e.source || "demo",
    featured: Boolean(e.featured),
    downloadUrl: `/api/library/${encodeURIComponent(e.id)}/download`,
  }));
  return json({ entries });
}

async function handleUpload(request, env) {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return json({ error: "需要 multipart/form-data" }, 400);
  }
  const form = await request.formData();
  const file = form.get("score");
  if (!file || typeof file === "string") {
    return json({ error: "缺少 score 文件" }, 400);
  }

  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const name = file.name || "upload.bin";
  const safe = name.replace(/[^\w.\-()\u4e00-\u9fff]+/g, "_").slice(0, 80);
  const mime = file.type || "application/octet-stream";
  const buf = await file.arrayBuffer();
  const bytes = buf.byteLength;
  const lower = safe.toLowerCase();
  const isXml = /\.(musicxml|xml)$/i.test(lower) || /xml/i.test(mime);
  const isImg = /\.(png|jpe?g|webp)$/i.test(lower) || /^image\//i.test(mime);

  if (!isXml && !isImg) {
    return json({ error: "请上传 MusicXML 或谱面图片（PNG/JPG）" }, 400);
  }

  // 无 R2 时：把谱面直接存进 D1（适合贡献进库；大图请优先 MusicXML）
  const MAX_D1 = 900_000; // ~900KB
  let r2Key = null;
  let fileB64 = null;

  if (env.MEDIA) {
    r2Key = `uploads/${id}/${safe}`;
    await env.MEDIA.put(r2Key, buf, {
      httpMetadata: { contentType: mime },
    });
  } else {
    if (bytes > MAX_D1) {
      return json(
        {
          error: `文件过大（${Math.round(bytes / 1024)}KB）。请上传 MusicXML，或到 Cloudflare 开通 R2 后再传大图。`,
        },
        413
      );
    }
    const u8 = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      binary += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    fileB64 = btoa(binary);
  }

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO jobs (id, status, filename, r2_key, title, error, mime, file_b64, created_at, updated_at)
     VALUES (?, 'queued', ?, ?, ?, NULL, ?, ?, ?, ?)`
  )
    .bind(id, safe, r2Key, safe, mime, fileB64, now, now)
    .run();

  return json({
    ok: true,
    id,
    status: "queued",
    mode: "contribute",
    message:
      "已收到谱面并进入曲库排队。站长有空会在本机批量出片，不会立刻生成视频。",
    jobUrl: `/api/jobs/${id}`,
  });
}

async function handleJobCallback(request, env, id) {
  const secret = request.headers.get("X-Render-Secret") || "";
  if (secret !== env.RENDER_HOOK_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const status = String(body.status || "done");
  const error = body.error ? String(body.error) : null;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`
  )
    .bind(status, error, now, id)
    .run();

  // 可选：成片写回 gallery 表
  if (status === "done" && body.gallery) {
    const g = body.gallery;
    await env.DB.prepare(
      `INSERT INTO gallery (id, title, artist, pos_label, has_poster, has_cello, has_solfege, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title,
         artist=excluded.artist,
         pos_label=excluded.pos_label,
         has_poster=excluded.has_poster,
         has_cello=excluded.has_cello,
         has_solfege=excluded.has_solfege,
         updated_at=excluded.updated_at`
    )
      .bind(
        g.id,
        g.title || g.id,
        g.artist || "未知歌手",
        g.posLabel || null,
        g.hasPoster ? 1 : 0,
        g.hasCello ? 1 : 0,
        g.hasSolfege ? 1 : 0,
        now
      )
      .run();
  }
  return json({ ok: true, id, status });
}

async function routeApi(request, env, url) {
  const { pathname } = url;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const authRes = await routeAuth(request, env, url);
  if (authRes) return authRes;

  if (pathname === "/api/health") {
    return json({ ok: true, app: env.APP_NAME || "Tang Tang", runtime: "cloudflare" });
  }

  if (pathname === "/api/gallery" && request.method === "GET") {
    return apiGallery(env);
  }

  if (pathname === "/api/library" && request.method === "GET") {
    return apiLibrary(env);
  }

  if (pathname === "/api/featured" && request.method === "GET") {
    return apiGallery(env);
  }

  const dlGal = pathname.match(/^\/api\/gallery\/([^/]+)\/download(?:\/(cello|solfege))?$/);
  if (dlGal && request.method === "GET") {
    const id = decodeURIComponent(dlGal[1]);
    const kind = dlGal[2] || "cello";
    const file = kind === "solfege" ? "solfege.mp4" : "cello.mp4";
    const row = await env.DB.prepare(`SELECT title FROM gallery WHERE id = ?`)
      .bind(id)
      .first();
    const stem = String(row?.title || id).replace(/[\\/:*?"<>|]+/g, "").slice(0, 48);
    const suffix = kind === "solfege" ? "跟唱" : "大提琴";
    return serveR2(
      env,
      `gallery/${id}/${file}`,
      `${stem}-${suffix}.mp4`,
      request.url
    );
  }

  const dlLib = pathname.match(/^\/api\/library\/([^/]+)\/download$/);
  if (dlLib && request.method === "GET") {
    const id = decodeURIComponent(dlLib[1]);
    const row = await env.DB.prepare(
      `SELECT title, filename FROM library WHERE id = ?`
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "找不到谱面" }, 404);
    const stem = String(row.title || id).replace(/[\\/:*?"<>|]+/g, "").slice(0, 48);
    return serveR2(
      env,
      `library/${row.filename}`,
      `${stem}.musicxml`,
      request.url
    );
  }

  if (pathname === "/api/upload" && request.method === "POST") {
    return handleUpload(request, env);
  }

  const jobGet = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobGet && request.method === "GET") {
    const id = jobGet[1];
    const row = await env.DB.prepare(
      `SELECT id, status, filename, r2_key, title, error, mime, created_at, updated_at,
              CASE WHEN file_b64 IS NULL OR file_b64 = '' THEN 0 ELSE 1 END AS has_file
       FROM jobs WHERE id = ?`
    )
      .bind(id)
      .first();
    if (!row) return json({ error: "job not found" }, 404);
    return json({
      id: row.id,
      status: row.status,
      filename: row.filename,
      r2Key: row.r2_key,
      title: row.title,
      error: row.error,
      mime: row.mime,
      hasFile: Boolean(row.has_file),
      mode: "contribute",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  const jobFile = pathname.match(/^\/api\/jobs\/([^/]+)\/file$/);
  if (jobFile && request.method === "GET") {
    const secret = request.headers.get("X-Render-Secret") || "";
    // 站长拉取可用 secret；公开贡献者不可下别人的原文件列表细节
    const id = jobFile[1];
    const row = await env.DB.prepare(`SELECT * FROM jobs WHERE id = ?`)
      .bind(id)
      .first();
    if (!row) return json({ error: "job file missing" }, 404);

    if (row.r2_key && env.MEDIA) {
      if (secret !== env.RENDER_HOOK_SECRET) {
        return json({ error: "unauthorized" }, 401);
      }
      return serveR2(env, row.r2_key, row.filename || "score.bin", request.url);
    }

    if (row.file_b64) {
      if (secret !== env.RENDER_HOOK_SECRET) {
        return json({ error: "unauthorized" }, 401);
      }
      const bin = Uint8Array.from(atob(row.file_b64), (c) => c.charCodeAt(0));
      const headers = new Headers({
        "Content-Type": row.mime || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(
          row.filename || "score.bin"
        )}`,
        ...CORS,
      });
      return new Response(bin, { headers });
    }
    return json({ error: "job file missing" }, 404);
  }

  if (jobGet && request.method === "POST") {
    return handleJobCallback(request, env, jobGet[1]);
  }

  if (pathname === "/api/jobs" && request.method === "GET") {
    const status = new URL(request.url).searchParams.get("status");
    let sql = `SELECT id, status, filename, r2_key AS r2Key, title, mime,
                      created_at AS createdAt, updated_at AS updatedAt,
                      CASE WHEN file_b64 IS NULL OR file_b64 = '' THEN 0 ELSE 1 END AS hasFile
               FROM jobs`;
    if (status) sql += ` WHERE status = ?`;
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const stmt = status
      ? env.DB.prepare(sql).bind(status)
      : env.DB.prepare(sql);
    const { results } = await stmt.all();
    return json({ entries: results || [] });
  }

  return json({ error: "api not found", path: pathname }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await routeApi(request, env, url);
      }

      // R2 媒体直出
      const gal = url.pathname.match(/^\/gallery\/([^/]+)\/([^/]+)$/);
      if (gal) {
        const id = decodeURIComponent(gal[1]);
        const file = decodeURIComponent(gal[2]);
        if (!/^(cello|solfege)\.mp4$|^poster\.jpg$/.test(file)) {
          return json({ error: "bad file" }, 400);
        }
        return serveR2(env, `gallery/${id}/${file}`, null, request.url);
      }

      const lib = url.pathname.match(/^\/library\/([^/]+\.musicxml)$/);
      if (lib) {
        return serveR2(
          env,
          `library/${decodeURIComponent(lib[1])}`,
          null,
          request.url
        );
      }

      // 静态前端
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }
      return json({ error: "no assets" }, 500);
    } catch (err) {
      return json({ error: String(err?.message || err) }, 500);
    }
  },
};
