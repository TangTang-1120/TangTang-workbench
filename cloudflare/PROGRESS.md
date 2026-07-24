# 进度存档（2026-07-23 晚上）

## 已完成
- Cloudflare 登录成功
- Worker 已上线：https://tangtang-workbench.tangtang-1120.workers.dev
- D1 `tangtang-db` 已建，成片/琴谱元数据已写入
- 产品方向定了：**别人上传进库 → 你有空本机批量出片**（不必 24h 开电脑）
- 贡献进库相关代码已写（Worker 上传排队、`npm run pull`、OWNER.md）
  - 若晚上那次 deploy 被中断，明天先再跑一次 deploy

## 卡在这（明天继续）
1. **开通 R2**：Dashboard 账单地址填完并保存  
   - 桶位置选 **APAC**  
   - 姓名建议：名 `Ruijie` / 姓 `Tang`（单字「汤」易报错）  
   - R2：https://dash.cloudflare.com/c84a8e60457e4deb2a387501b1407c0d/r2
2. R2 开通后告诉我，或自己跑：
   ```bash
   cd score-video-demo/cloudflare
   # 取消 wrangler.toml 里 [[r2_buckets]] 注释
   npm run setup && npm run sync && npm run deploy
   ```

## 你本机出片（R2 前后都能用 pull）
```bash
cd score-video-demo/cloudflare
npm run pull
cd .. && npm start
# 浏览器 http://127.0.0.1:8787 拖 pending-uploads 里的谱
```

详见：`OWNER.md`、`CHECKLIST.md`
