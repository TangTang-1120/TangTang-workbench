# 国内服务器部署（可直连，不用 VPN）

Cloudflare `workers.dev` 国内常打不开。国内站用 **腾讯云 / 阿里云轻量** + 本脚本。

> 我这边没有你的云账号，**无法替你下单买机器**。你买好后把 **公网 IP**（和 root 密码/SSH）发我，我可以继续远程帮你装；或你自己跑下面命令。

## 1. 你买什么

推荐：**腾讯云轻量应用服务器**

1. 打开：https://buy.cloud.tencent.com/lighthouse  
2. 地域：选靠近用户的，如 **广州 / 上海 / 成都**（你在昆明可优先成都或广州）  
3. 镜像：Ubuntu 22.04（或「Node.js」应用镜像）  
4. 套餐：新人常见 **2核2G** 或活动款即可（视频站带宽选稍大的更稳）  
5. 防火墙/安全组放行：**80**、**443**（可选再放行 8787）  
6. 买完在控制台复制 **公网 IP**

说明：
- **先用 IP 访问不用备案**（`http://公网IP/`）  
- 以后要绑自己的域名 → 必须做 **ICP 备案**

阿里云同类：https://www.aliyun.com/product/swas （轻量应用服务器）

## 2. 一键安装（在服务器上）

SSH 登录后执行：

```bash
# 方式 A：从 GitHub 拉安装脚本（需服务器能访问 GitHub）
curl -fsSL https://raw.githubusercontent.com/TangTang-1120/TangTang-workbench/main/deploy/china/install.sh | bash
```

若 raw.githubusercontent.com 慢，用方式 B：本机把仓库拷上去再执行 `bash deploy/china/install.sh`。

装完后浏览器打开：

- `http://你的公网IP/`
- `http://你的公网IP/login.html`

## 3. 发给我继续代装时请带

```
公网IP：x.x.x.x
系统：Ubuntu 22.04
SSH端口：22
用户：root
密码或密钥：（私聊/本地给我，勿发到公开群）
```

## 4. 和 Cloudflare 的关系

| 用途 | 用哪边 |
|------|--------|
| 国内用户打开网站 / 登录页 / 成片 | **国内轻量服务器** |
| 海外 CDN / R2 流出（可选） | Cloudflare（以后再接） |

当前阶段：先把国内 IP 站跑通，最重要。
