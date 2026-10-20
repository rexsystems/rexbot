#!/usr/bin/env bash
# Runs inside a Rex Computer template VM as root. The API copies this folder in and runs it
# while building the QEMU template (Admin → Computers → Build image).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

# Fail here, not at install, when the mirrors are unreachable.
apt-get update -o APT::Update::Error-Mode=any
apt-get install -y --no-install-recommends \
  openssh-server cloud-guest-utils python3 python3-pip python3-venv git curl ca-certificates \
  xvfb openbox tint2 x11vnc novnc websockify xdotool wmctrl scrot xclip x11-xserver-utils \
  xterm chromium firefox-esr dbus-x11 procps \
  fonts-dejavu-core fonts-noto-color-emoji

install -m 0755 "$HERE/rex-sessiond" /usr/local/bin/rex-sessiond
install -m 0755 "$HERE/rex-browser" /usr/local/bin/rex-browser
install -m 0644 "$HERE/rex-sessiond-boot.service" /etc/systemd/system/rex-sessiond-boot.service

install -d -o rex -g rex -m 0755 /workspace /workspace/shared /workspace/bots
install -d -o rex -g rex -m 0700 /var/lib/rex-sessiond

# Screens survive the SSH call that started them.
loginctl enable-linger rex

install -d -o rex -g rex /home/rex/.config/openbox /home/rex/.config/tint2
cat > /home/rex/.config/openbox/rc.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <theme><name>Clearlooks</name><titleLayout>NLIMC</titleLayout></theme>
  <desktops><number>1</number></desktops>
  <applications><application class="*"><decor>yes</decor><maximized>no</maximized></application></applications>
</openbox_config>
XML
chown -R rex:rex /home/rex/.config

# Bots run as rex and install packages, browsers, compilers, whatever they need.
usermod -aG sudo rex
printf 'rex ALL=(ALL) NOPASSWD:ALL\nDefaults:rex !requiretty\n' > /etc/sudoers.d/rex
chmod 0440 /etc/sudoers.d/rex
visudo -cf /etc/sudoers.d/rex

systemctl daemon-reload
systemctl enable rex-sessiond-boot.service
sudo -u rex /usr/local/bin/rex-sessiond reset

echo "rex-sessiond: $(sudo -u rex /usr/local/bin/rex-sessiond ping)"
