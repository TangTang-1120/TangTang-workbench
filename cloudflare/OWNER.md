# 贡献进库（站长稍后出片）

线上：https://tangtang-workbench.tangtang-1120.workers.dev

## 别人怎么做
1. 打开网站 → 上传 MusicXML / 谱面图  
2. 看到「已进入曲库排队」即可（**不会立刻出视频**）

## 你怎么动手批量出片
```bash
cd score-video-demo/cloudflare
npm run pull          # 把排队谱面拉到 output/pending-uploads/
cd .. && npm start    # 本机工作台
# 浏览器打开 http://127.0.0.1:8787 ，拖 pending 里的谱出片
```

出完后把成片同步回线上（R2 开通后更佳）：
```bash
cd cloudflare && npm run sync && npm run deploy
```

## 还差什么
- **R2**：Dashboard 开通后流出免费、大图更好存  
  https://dash.cloudflare.com/c84a8e60457e4deb2a387501b1407c0d/r2  
- 现在无 R2 时，谱面暂存在 D1（小文件 OK）
