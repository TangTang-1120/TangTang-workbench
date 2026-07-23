# Tang Tang · 大提琴跟谱工作台

上传 MusicXML / PNG 谱面，输出跟唱 + 大提琴跟谱视频。固定速度 ♩=72，画面按把位分色。  
**仅浅色工作台**（已移除深色主题）。

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/TangTang-1120/TangTang-workbench)

## 本地运行

```bash
npm install
npm start
# 打开 http://127.0.0.1:8787
```

## 公网部署（Render，推荐）

1. 打开上面的 **Deploy to Render** 按钮  
2. 用 GitHub 登录 Render，选择本仓库  
3. 按 `render.yaml` 创建 Web Service  
4. 部署完成后得到公网 URL（形如 `https://tang-tang-xxxx.onrender.com`）

> 云端默认 `USE_OEMER=0`（不跑 PNG 光学识谱）。上传 MusicXML，或使用仓库内已上架成片画廊。

## GitHub Pages（静态预览）

仓库 `docs/` 可开 Pages 做静态展示；上传出片等 API 需走 Render 服务。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm start` | 启动 Web 服务 |
| `npm run demo:flow` | 录制桌面 2K Demo |
| `npm run demo:mobile` | 录制移动端 2K Demo |

## 技术栈

Node.js · Express · Verovio · ffmpeg · Playwright（录屏）
