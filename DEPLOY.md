# Tang Tang · 公网部署

仓库：https://github.com/TangTang-1120/TangTang-workbench

## 推荐：Render（真正公网、长期可用）

1. 打开一键部署：  
   https://render.com/deploy?repo=https://github.com/TangTang-1120/TangTang-workbench
2. 用 GitHub 登录 Render，确认 Blueprint / Web Service
3. 创建后等待 Build → Live
4. 公网地址类似：`https://tang-tang.onrender.com`

免费实例闲置会休眠，首次打开可能要等几十秒。

## 备选：GitHub Codespaces（临时演示）

https://github.com/codespaces/new?hide_repo_select=true&ref=main&repo=TangTang-1120/TangTang-workbench

启动后在终端：

```bash
npm install --omit=dev && NODE_ENV=production USE_OEMER=0 PORT=8787 node src/server.mjs
```

把端口 **8787** 设为 **Public**，复制 `*.app.github.dev` 链接。

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `8787` | 服务端口 |
| `USE_OEMER` | `0`（云端） | PNG 光学识谱，云端建议关 |
| `ADMIN_PASSWORD` | `tangtang` | 谱库后台密码 |
| `NODE_ENV` | `production` | 生产模式 |
