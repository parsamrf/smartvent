#!/bin/bash
# One-time setup of the EC2 web server (Amazon Linux 2023): nginx serving the
# static web app, plus a Let's Encrypt certificate so the site is HTTPS-only.
# Run on the instance:  bash setup-ec2.sh <hostname>
# <hostname> must resolve to this instance, e.g. 18-218-154-165.sslip.io
set -euo pipefail
HOST="$1"
cd "$(dirname "$0")"

sudo dnf install -y -q nginx

if ! command -v certbot >/dev/null; then
    # certbot isn't in the AL2023 repos; install it in its own virtualenv.
    sudo dnf install -y -q python3 augeas-libs
    sudo python3 -m venv /opt/certbot
    sudo /opt/certbot/bin/pip install -q --upgrade pip certbot certbot-nginx
    sudo ln -sf /opt/certbot/bin/certbot /usr/bin/certbot
fi

sudo mkdir -p /var/www/smartvent
sudo chown ec2-user:ec2-user /var/www/smartvent
[ -f /var/www/smartvent/index.html ] || echo "SmartVent: deploying..." > /var/www/smartvent/index.html

sed "s/__HOST__/$HOST/" smartvent.conf | sudo tee /etc/nginx/conf.d/smartvent.conf >/dev/null
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

# Issue the certificate and let certbot rewrite the site for HTTPS + redirect.
sudo certbot --nginx -d "$HOST" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect --hsts

# Renew automatically (certificates last 90 days).
sudo tee /etc/systemd/system/certbot-renew.service >/dev/null <<'EOF'
[Unit]
Description=Renew Let's Encrypt certificates
[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew -q --deploy-hook "systemctl reload nginx"
EOF
sudo tee /etc/systemd/system/certbot-renew.timer >/dev/null <<'EOF'
[Unit]
Description=Twice-daily certbot renewal check
[Timer]
OnCalendar=*-*-* 03,15:00:00
RandomizedDelaySec=1h
Persistent=true
[Install]
WantedBy=timers.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer

echo "Ready: https://$HOST"
