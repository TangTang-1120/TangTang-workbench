#!/usr/bin/env bash
# Tang Tang · 国内轻量服务器一键部署
# 适用：腾讯云 / 阿里云 轻量（Ubuntu 22.04 / Debian 12）
#
# 用法（在服务器上以 root 执行）：
#   curl -fsSL https://raw.githubusercontent.com/TangTang-1120/TangTang-workbench/main/deploy/china/install.sh | bash
# 或把本仓库拷上去后：
#   bash deploy/china/install.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tangtang-workbench}"
REPO_URL="${REPO_URL:-https://github.com/TangTang-1120/TangTang-workbench.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8787}"
SERVICE_NAME="tangtang"

export DEBIAN_FRONTEND=noninteractive

echo "==> 安装系统依赖"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl git ffmpeg python3 python3-pip nginx

if ! command -v node >/dev/null 2>&1; then
  echo "==> 安装 Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "==> 拉取代码到 ${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch --depth 1 origin "${BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${APP_DIR}"
  git clone --depth 1 -b "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

# 仓库结构：若代码在子目录 score-video-demo
if [[ -f package.json ]]; then
  APP_ROOT="${APP_DIR}"
elif [[ -f score-video-demo/package.json ]]; then
  APP_ROOT="${APP_DIR}/score-video-demo"
else
  echo "找不到 package.json，请检查仓库结构"
  exit 1
fi

cd "${APP_ROOT}"
echo "==> npm install @ ${APP_ROOT}"
npm ci --omit=dev || npm install --omit=dev

export NODE_ENV=production
export PORT
export USE_OEMER=0

echo "==> 启动 PM2"
pm2 delete "${SERVICE_NAME}" >/dev/null 2>&1 || true
pm2 start src/server.mjs --name "${SERVICE_NAME}" --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> 配置 Nginx 反代 :80 -> :${PORT}"
cat >/etc/nginx/sites-available/tangtang <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    client_max_body_size 80m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600;
    }
}
EOF

ln -sfn /etc/nginx/sites-available/tangtang /etc/nginx/sites-enabled/tangtang
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

# 放行防火墙（若存在 ufw）
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow "${PORT}/tcp" || true
fi

IP="$(curl -fsS --max-time 5 ifconfig.me || hostname -I | awk '{print $1}')"
echo ""
echo "======= 部署完成 ======="
echo "公网访问（IP，无需备案）：  http://${IP}/"
echo "登录页：                    http://${IP}/login.html"
echo "成片：                      http://${IP}/gallery.html"
echo ""
echo "绑定域名需要 ICP 备案；先用 IP 测通即可。"
echo "查看日志： pm2 logs ${SERVICE_NAME}"
