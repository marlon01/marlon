#!/usr/bin/env bash
# =========================================================================
#  SELECTA — installation du serveur de concours (Ubuntu 22.04 / 24.04, Debian 12)
#  Usage : sudo ./install.sh [--db selecta] [--port 8069] [--demo] [--https]
# =========================================================================
set -euo pipefail
DB=selecta; PORT=8069; DEMO=0; HTTPS=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --demo) DEMO=1; shift;;
    --https) HTTPS=1; shift;;
    *) echo "Option inconnue : $1"; exit 1;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Lancez ce script avec sudo."; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ADDONS=/opt/selecta/addons
step() { echo -e "\n\033[1;36m==> $*\033[0m"; }

step "Paquets système"
apt-get update -q
apt-get install -y -q postgresql curl gnupg ca-certificates python3-qrcode

step "Dépôt officiel Odoo 18 Community"
if ! dpkg -l odoo >/dev/null 2>&1; then
  curl -fsSL https://nightly.odoo.com/odoo.key | gpg --dearmor -o /usr/share/keyrings/odoo-archive-keyring.gpg
  echo 'deb [signed-by=/usr/share/keyrings/odoo-archive-keyring.gpg] https://nightly.odoo.com/18.0/nightly/deb/ ./' > /etc/apt/sources.list.d/odoo.list
  apt-get update -q && apt-get install -y -q odoo
fi

step "Module SELECTA"
mkdir -p "$ADDONS"
rm -rf "$ADDONS/selecta_concours"
cp -r "$ROOT/addons/selecta_concours" "$ADDONS/"
chown -R odoo:odoo /opt/selecta

step "Configuration"
MASTER=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
CONF=/etc/odoo/odoo.conf
cat > "$CONF" <<EOF
[options]
db_host = False
db_port = False
db_user = odoo
db_password = False
addons_path = /usr/lib/python3/dist-packages/odoo/addons,$ADDONS
admin_passwd = $MASTER
http_port = $PORT
dbfilter = ^$DB\$
list_db = False
proxy_mode = $([[ $HTTPS -eq 1 ]] && echo True || echo False)
workers = 4
max_cron_threads = 1
limit_time_real = 600
logfile = /var/log/odoo/odoo-server.log
EOF
chown odoo:odoo "$CONF"; chmod 640 "$CONF"

step "Base de données « $DB »"
systemctl stop odoo || true
DEMOFLAG="--without-demo=all"; [[ $DEMO -eq 1 ]] && DEMOFLAG=""
sudo -u odoo odoo -c "$CONF" -d "$DB" -i selecta_concours $DEMOFLAG --load-language=fr_FR --stop-after-init
systemctl enable --now odoo

if [[ $HTTPS -eq 1 ]]; then
  step "HTTPS local (certificat autosigné) via Nginx"
  apt-get install -y -q nginx
  IP=$(hostname -I | awk '{print $1}')
  mkdir -p /etc/selecta
  openssl req -x509 -nodes -newkey rsa:2048 -days 1825 -subj "/CN=$IP" \
    -addext "subjectAltName=IP:$IP,DNS:selecta.local" \
    -keyout /etc/selecta/selecta.key -out /etc/selecta/selecta.crt
  cat > /etc/nginx/sites-available/selecta <<EOF
server {
  listen 443 ssl;
  ssl_certificate /etc/selecta/selecta.crt;
  ssl_certificate_key /etc/selecta/selecta.key;
  client_max_body_size 20m;
  proxy_read_timeout 600s;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto https;
  }
}
server { listen 80; return 301 https://\$host\$request_uri; }
EOF
  ln -sf /etc/nginx/sites-available/selecta /etc/nginx/sites-enabled/selecta
  rm -f /etc/nginx/sites-enabled/default
  systemctl restart nginx
  echo "Installez /etc/selecta/selecta.crt comme autorité de confiance sur les postes candidats."
fi

command -v ufw >/dev/null && ufw allow "$PORT"/tcp >/dev/null || true
IP=$(hostname -I | awk '{print $1}')
echo "Mot de passe maître Odoo : $MASTER" > /opt/selecta/IMPORTANT-mot-de-passe-maitre.txt
chmod 600 /opt/selecta/IMPORTANT-mot-de-passe-maitre.txt
cat <<EOF

================================================================
 SELECTA est installé.
 Console du personnel : http://$IP:$PORT/selecta/login
 Espace candidat      : http://$IP:$PORT/selecta/exam
 Identifiant initial  : admin / admin  (à changer immédiatement)
 Mot de passe maître  : /opt/selecta/IMPORTANT-mot-de-passe-maitre.txt
================================================================
EOF
