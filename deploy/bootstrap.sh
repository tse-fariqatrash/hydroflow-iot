#!/usr/bin/env bash
#
# Hydroflow Tanjung Manis — IoT Monitoring & EMS
# Idempotent installer for an AWS Lightsail instance that is ALREADY hosting
# other applications.
#
#   sudo bash deploy/bootstrap.sh
#
# It refuses to touch anything it did not create. Specifically it will NOT:
#   · overwrite an existing nginx site, default site, or nginx.conf
#   · bind a port another process is already listening on
#   · overwrite an existing /opt/hydroflow/.env
#   · restart or reconfigure any other service on the box
#
# Re-running it is safe: it upgrades the app in place and leaves data/ alone.

set -euo pipefail

APP_NAME="hydroflow"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${APP_NAME}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

c()  { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
ok()   { c '0;32' "  ok    $*"; }
info() { c '0;36' "  ..    $*"; }
warn() { c '1;33' "  warn  $*"; }
die()  { c '0;31' "  FAIL  $*"; exit 1; }
step() { echo; c '1;37' "── $* ──────────────────────────────────────────"; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."

# ── 0. Survey the machine before changing anything ──────────────────────────
step "0. Surveying this instance"

if [ -r /etc/os-release ]; then . /etc/os-release; else die "Cannot read /etc/os-release"; fi
case "${ID}${VERSION_ID:-}" in
  ubuntu*|debian*) PKG=apt ;;
  amzn2023|amzn*|rhel*|centos*|fedora*) PKG=dnf ;;
  *) die "Unsupported OS: ${PRETTY_NAME:-$ID}. Install Node 20+, nginx and sqlite3 manually, then re-run." ;;
esac
ok "OS: ${PRETTY_NAME:-$ID}  (package manager: $PKG)"

MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
DISK_MB=$(df -Pm /opt 2>/dev/null | awk 'NR==2{print $4}' || df -Pm / | awk 'NR==2{print $4}')
ok "RAM ${MEM_MB} MB · free disk on /opt ${DISK_MB} MB"
[ "$MEM_MB" -ge 900 ] || warn "Under 1 GB RAM. Add a 2 GB swapfile before running this alongside another app."
[ "$DISK_MB" -ge 3000 ] || warn "Under 3 GB free. The historian needs ~1 GB per year at 89 points."

# What else is already running here? This is the whole point of the survey.
step "0b. What is already on this box"
listening() { ss -lntp 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | sort -un; }
PORTS_IN_USE="$(listening | tr '\n' ' ')"
info "Ports already listening: ${PORTS_IN_USE:-none}"

port_free() { ! ss -lnt 2>/dev/null | awk 'NR>1{print $4}' | sed 's/.*://' | grep -qx "$1"; }

# Pick an app port that does not collide with the other project.
APP_PORT="${APP_PORT:-3000}"
if ! port_free "$APP_PORT"; then
  warn "Port $APP_PORT is taken by: $(ss -lntp | grep ":$APP_PORT " | sed 's/.*users:((//;s/).*//' || echo unknown)"
  for p in 3100 3200 3300 4000 4100; do
    if port_free "$p"; then APP_PORT="$p"; break; fi
  done
  port_free "$APP_PORT" || die "Could not find a free app port. Set APP_PORT=nnnn and re-run."
  ok "Using port $APP_PORT instead"
else
  ok "App port $APP_PORT is free"
fi

MQTT_PORT="${MQTT_PORT:-1883}"
if ! port_free "$MQTT_PORT"; then
  warn "Port $MQTT_PORT is taken — another MQTT broker may already be here."
  for p in 1884 1885 1886; do if port_free "$p"; then MQTT_PORT="$p"; break; fi; done
  ok "Using MQTT port $MQTT_PORT instead — the gateway must be pointed at this port"
else
  ok "MQTT port $MQTT_PORT is free"
fi

if systemctl is-active --quiet nginx 2>/dev/null; then
  NGINX_RUNNING=yes
  ok "nginx is already running — this script will ADD a site, not modify existing ones"
  info "Existing sites: $(ls /etc/nginx/sites-enabled/ 2>/dev/null | tr '\n' ' ' || ls /etc/nginx/conf.d/*.conf 2>/dev/null | xargs -n1 basename | tr '\n' ' ' || echo '(none found)')"
else
  NGINX_RUNNING=no
  info "nginx not running"
fi

echo
read -r -p "  Continue with this configuration? [y/N] " REPLY
[[ "$REPLY" =~ ^[Yy]$ ]] || { echo "  Aborted — nothing was changed."; exit 0; }

# ── 1. Node.js 20+ ──────────────────────────────────────────────────────────
step "1. Node.js"
NEED_NODE=yes
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 20 ]; then NEED_NODE=no; ok "node $(node -v) already installed"; 
  else warn "node $(node -v) is too old (need 20+); installing a newer one"; fi
fi
if [ "$NEED_NODE" = yes ]; then
  info "Installing Node.js 20 LTS"
  if [ "$PKG" = apt ]; then
    apt-get update -qq
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
    apt-get install -y -qq nodejs build-essential
  else
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - >/dev/null
    dnf install -y -q nodejs gcc-c++ make
  fi
  ok "node $(node -v)"
fi

info "Installing sqlite3 CLI (needed for safe backups)"
if [ "$PKG" = apt ]; then apt-get install -y -qq sqlite3; else dnf install -y -q sqlite; fi
ok "sqlite3 $(sqlite3 --version | cut -d' ' -f1)"

# ── 2. Service account and directory ────────────────────────────────────────
step "2. Application directory"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER" 2>/dev/null \
    || useradd --system --home "$APP_DIR" --shell /sbin/nologin "$APP_USER"
  ok "Created service account '$APP_USER' (no login shell)"
else
  ok "Service account '$APP_USER' exists"
fi

FIRST_INSTALL=yes
[ -d "$APP_DIR/server" ] && FIRST_INSTALL=no

mkdir -p "$APP_DIR"
info "Copying application files (data/ and .env are preserved)"
# -a preserves times; --exclude keeps live state intact on an upgrade
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'node_modules' --exclude 'data' --exclude '.env' --exclude '.git' \
    "$SRC_DIR"/ "$APP_DIR"/
else
  for d in server public deploy docs scripts tests; do
    [ -d "$SRC_DIR/$d" ] && { rm -rf "${APP_DIR:?}/$d"; cp -a "$SRC_DIR/$d" "$APP_DIR/"; }
  done
  cp -a "$SRC_DIR"/package.json "$SRC_DIR"/package-lock.json "$SRC_DIR"/README.md "$APP_DIR"/ 2>/dev/null || true
  cp -a "$SRC_DIR"/.env.example "$APP_DIR"/ 2>/dev/null || true
fi
mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
ok "Files in $APP_DIR"

info "Installing production dependencies"
sudo -u "$APP_USER" env HOME="$APP_DIR" npm ci --omit=dev --no-audit --no-fund --prefix "$APP_DIR" >/dev/null 2>&1 \
  || sudo -u "$APP_USER" env HOME="$APP_DIR" npm install --omit=dev --no-audit --no-fund --prefix "$APP_DIR" >/dev/null
ok "Dependencies installed"

# ── 3. Configuration ────────────────────────────────────────────────────────
step "3. Configuration"
if [ -f "$APP_DIR/.env" ]; then
  ok ".env already exists — left untouched"
  info "Its PORT is $(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo unset)"
  APP_PORT=$(grep -E '^PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo "$APP_PORT")
  MQTT_PORT=$(grep -E '^MQTT_PORT=' "$APP_DIR/.env" | cut -d= -f2 || echo "$MQTT_PORT")
else
  JWT=$(openssl rand -hex 32)
  ADMIN_PW=$(openssl rand -base64 15 | tr -d '/+=' | cut -c1-16)
  MQTT_PW=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  sed -e "s|^PORT=.*|PORT=${APP_PORT}|" \
      -e "s|^MQTT_PORT=.*|MQTT_PORT=${MQTT_PORT}|" \
      -e "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" \
      -e "s|^DEFAULT_PASSWORD=.*|DEFAULT_PASSWORD=${ADMIN_PW}|" \
      -e "s|^MQTT_USERNAME=.*|MQTT_USERNAME=hydroflow-gateway|" \
      -e "s|^MQTT_PASSWORD=.*|MQTT_PASSWORD=${MQTT_PW}|" \
      "$APP_DIR/.env.example" > "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  ok "Generated .env with a random JWT secret and passwords"
  CREDS_FILE=/root/hydroflow-credentials.txt
  {
    echo "Hydroflow Tanjung Manis — generated $(date -uIs)"
    echo "Dashboard login password (all six accounts): ${ADMIN_PW}"
    echo "MQTT username: hydroflow-gateway"
    echo "MQTT password: ${MQTT_PW}"
    echo "App port: ${APP_PORT}   MQTT port: ${MQTT_PORT}"
  } > "$CREDS_FILE"
  chmod 600 "$CREDS_FILE"
  ok "Credentials written to $CREDS_FILE (root-only, delete after recording them)"
fi

# ── 4. systemd service ──────────────────────────────────────────────────────
step "4. systemd service"
UNIT=/etc/systemd/system/${APP_NAME}.service
if [ -f "$UNIT" ] && ! grep -q "Hydroflow" "$UNIT"; then
  die "$UNIT exists and is not ours. Rename the app or remove that unit first."
fi
sed "s|CAP_NET_BIND_SERVICE|CAP_NET_BIND_SERVICE|" "$APP_DIR/deploy/hydroflow.service" > "$UNIT"
systemctl daemon-reload
ok "Installed $UNIT"

info "Starting service (first boot seeds ~14 days of history, allow ~60 s)"
systemctl enable --quiet "$APP_NAME"
systemctl restart "$APP_NAME"

for i in $(seq 1 40); do
  sleep 3
  if curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; then
    ok "Service is up and answering on 127.0.0.1:${APP_PORT}"
    break
  fi
  [ "$i" -eq 40 ] && { journalctl -u "$APP_NAME" -n 30 --no-pager; die "Service did not become healthy — log above."; }
  printf '.'
done
echo

# ── 5. nginx reverse proxy (added alongside existing sites) ─────────────────
step "5. nginx reverse proxy"
if ! command -v nginx >/dev/null 2>&1; then
  info "Installing nginx"
  if [ "$PKG" = apt ]; then apt-get install -y -qq nginx; else dnf install -y -q nginx; fi
fi

if [ -d /etc/nginx/sites-available ]; then
  SITE=/etc/nginx/sites-available/${APP_NAME}
  LINK=/etc/nginx/sites-enabled/${APP_NAME}
else
  SITE=/etc/nginx/conf.d/${APP_NAME}.conf
  LINK=""
fi

if [ -f "$SITE" ]; then
  warn "$SITE already exists — leaving it alone. Edit it by hand if the port changed."
else
  # HTTP-only to start with. Step 7 of the runbook upgrades this to HTTPS.
  cat > "$SITE" <<NGINX
# Hydroflow Tanjung Manis — added by deploy/bootstrap.sh
# HTTP only. Run certbot (see DEPLOY-LIGHTSAIL.md step 7) to add TLS.
#
# server_name is the default catch-all ONLY if no other site claims it.
# If this box already serves another project on port 80, set a real
# hostname below and add a DNS record for it.

upstream ${APP_NAME}_app {
    server 127.0.0.1:${APP_PORT};
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${NGINX_SERVER_NAME:-_};

    access_log /var/log/nginx/${APP_NAME}.access.log;
    error_log  /var/log/nginx/${APP_NAME}.error.log;

    client_max_body_size 4m;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location /ws {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://${APP_NAME}_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
  [ -n "$LINK" ] && ln -sf "$SITE" "$LINK"
  ok "Added nginx site $SITE"
fi

if nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || systemctl start nginx
  ok "nginx reloaded — existing sites untouched"
else
  warn "nginx config test FAILED. Your other site is still running on the old config."
  nginx -t || true
  warn "Fix the error above, then: sudo nginx -t && sudo systemctl reload nginx"
fi

# ── 6. Backup cron ──────────────────────────────────────────────────────────
step "6. Nightly backup"
install -m 0755 -o root -g root "$APP_DIR/deploy/backup.sh" /usr/local/bin/${APP_NAME}-backup
if [ ! -f /etc/cron.d/${APP_NAME}-backup ]; then
  echo "15 2 * * * root /usr/local/bin/${APP_NAME}-backup >> /var/log/${APP_NAME}-backup.log 2>&1" \
    > /etc/cron.d/${APP_NAME}-backup
  ok "Nightly historian backup at 02:15 UTC (10:15 MYT)"
else
  ok "Backup cron already present"
fi

# ── Done ────────────────────────────────────────────────────────────────────
IP=$(curl -fsS --max-time 4 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || hostname -I | awk '{print $1}')
step "Done"
echo
c '1;32' "  Hydroflow is running."
echo
echo "    Dashboard   http://${IP}/          (once the Lightsail firewall allows port 80)"
echo "    Local       http://127.0.0.1:${APP_PORT}/"
echo "    MQTT        ${IP}:${MQTT_PORT}      (restrict this to the gateway IP)"
echo "    Logs        sudo journalctl -u ${APP_NAME} -f"
echo "    Health      curl -s localhost:${APP_PORT}/api/health"
[ -f /root/hydroflow-credentials.txt ] && echo "    Credentials sudo cat /root/hydroflow-credentials.txt"
echo
warn "Still to do by hand — see deploy/DEPLOY-LIGHTSAIL.md:"
echo "      · open port 80 in the Lightsail console (Networking tab)"
echo "      · attach a static IP so the address survives a reboot"
echo "      · add TLS once you have a hostname (step 7)"
echo "      · restrict port ${MQTT_PORT} to the plant gateway's IP only"
echo
