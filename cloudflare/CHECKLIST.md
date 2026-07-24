# Cloudflare 落地小清单（Tang Tang）

线上地址：https://tangtang-workbench.tangtang-1120.workers.dev

| # | 事项 | 状态 |
|---|------|------|
| 1 | `cloudflare/` 工程：Worker + D1 schema + 脚本 | ✅ |
| 2 | 登录 Cloudflare（wrangler login） | ✅ |
| 3 | 注册 workers.dev 子域 `tangtang-1120` | ✅ |
| 4 | 创建 D1 `tangtang-db` 并写入成片/琴谱元数据 | ✅ |
| 5 | 构建并部署前端 + 成片过渡资源 | ✅ 已上线 |
| 6 | Worker API：`/api/gallery` `/api/library` `/api/jobs` | ✅ |
| 7 | 本机渲染桥 `scripts/render-bridge.mjs` | ✅ 代码就绪（等 R2） |
| 8 | **开通 R2 桶**（Dashboard 点一下） | ❌ 未开通 |
| 9 | 上传入队 + 自动出片回写 R2 | ❌ 依赖 R2 |
| 10 | 24h 云端出片机（Fly 等） | ❌ 需绑卡 |

## 开通 R2 后（你点一下 Dashboard）

1. 打开：https://dash.cloudflare.com/c84a8e60457e4deb2a387501b1407c0d/r2  
2. Enable R2  
3. 然后本地执行：

```bash
cd score-video-demo/cloudflare
# 取消 wrangler.toml 里 [[r2_buckets]] 注释
npm run setup   # 会创建 tangtang-media
npm run sync    # 视频进 R2
npm run deploy
```
