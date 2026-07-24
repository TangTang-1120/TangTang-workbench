# Tang Tang · 公网部署

仓库：https://github.com/TangTang-1120/TangTang-workbench

## 国内用户首选：腾讯云 / 阿里云轻量（可直连）

`workers.dev` 国内常需 VPN。国内站部署说明：

→ **[`deploy/china/README.md`](./deploy/china/README.md)**

买好机器后把公网 IP 发我，或 SSH 上执行一键脚本即可。

## Cloudflare（海外 / 需可访问 workers.dev）

成片浏览/播放可走 R2（流出免费），API 走 Workers。出片渲染仍在本机或国内机。

清单：[`cloudflare/CHECKLIST.md`](./cloudflare/CHECKLIST.md)

## GitHub Pages（静态镜像，国内一般可开）

https://tangtang-1120.github.io/TangTang-workbench/

## 备选：Fly.io · 新加坡 · 常驻

比 Render 免费版快很多（无长时间休眠冷启动）。

```bash
# 本机已装 flyctl 时：
export PATH="$HOME/.fly/bin:$PATH"
fly auth login          # 浏览器登录一次
cd score-video-demo     # 或本仓库根目录
fly apps create tangtang-workbench --org personal   # 仅首次
fly deploy
```

成功后地址形如：`https://tangtang-workbench.fly.dev`

当前 `fly.toml` 已设：
- 区域 `sin`（新加坡）
- 内存 `1gb`
- `min_machines_running = 1`（常驻，减少冷启动）

## 备选：Railway（也偏快）

https://railway.app/new/template?referralCode=  
或连接本仓库后用 `railway.toml` 一键部署。

## 备选：Render（免费但偏慢）

https://render.com/deploy?repo=https://github.com/TangTang-1120/TangTang-workbench  

免费实例闲置会休眠，首次打开可能要等几十秒。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | 服务端口 |
| `USE_OEMER` | `0` | PNG 光学识谱，云端建议关 |
| `ADMIN_PASSWORD` | `tangtang` | 谱库后台密码 |
| `NODE_ENV` | `production` | 生产模式 |
