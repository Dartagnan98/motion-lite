#!/usr/bin/env bash
# Hiilite Platform — VPS deploy. Run as the app user on the VPS.
set -euo pipefail
APP_DIR="${HIILITE_APP_DIR:-/opt/hiilite-platform}"
cd "$APP_DIR"

echo "==> pre-deploy backup"
node scripts/backup-db.mjs

echo "==> git pull"
git pull --ff-only

echo "==> npm ci"
npm ci --omit=dev

echo "==> next build"
npm run build

echo "==> systemd restart"
sudo systemctl restart hiilite-platform.service

echo "==> warming /"
sleep 3
curl -sf http://localhost:3000/ > /dev/null && echo "ok" || echo "WARN: home not 200"
