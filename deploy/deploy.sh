#!/usr/bin/env bash
# Builds Post Check for Linux and installs it on the server as a systemd service.
# Usage: deploy/deploy.sh [ssh-host]   (default: manuelbieh.online)
# The Caddy site block (deploy/Caddyfile) is a one-time step; see README, Deploy.
set -euo pipefail

HOST="${1:-manuelbieh.online}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/bin/post-checklist-linux-amd64"

cd "$ROOT"
make build-web
(cd server && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$BIN" .)

scp -q "$BIN" deploy/post-checklist.service "$HOST:/tmp/"
ssh "$HOST" bash -s <<'REMOTE'
set -euo pipefail
id -u post-checklist >/dev/null 2>&1 ||
  sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin post-checklist
sudo install -d -m 755 /opt/post-checklist
sudo install -m 755 /tmp/post-checklist-linux-amd64 /opt/post-checklist/post-checklist
sudo install -m 644 /tmp/post-checklist.service /etc/systemd/system/post-checklist.service
rm -f /tmp/post-checklist-linux-amd64 /tmp/post-checklist.service
sudo systemctl daemon-reload
sudo systemctl enable --quiet post-checklist
sudo systemctl restart post-checklist
for _ in $(seq 1 20); do
  if curl -fsS http://172.18.0.1:8787/api/health >/dev/null 2>&1; then
    echo "post-checklist is running"
    exit 0
  fi
  sleep 0.5
done
echo "post-checklist did not come up:" >&2
sudo journalctl -u post-checklist -n 20 --no-pager >&2
exit 1
REMOTE
