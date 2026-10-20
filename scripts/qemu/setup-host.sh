#!/usr/bin/env bash
# Prepares a Linux host to run Rex Computer VMs with QEMU.
# Installs QEMU, qemu-img, a cloud-init seed tool and the OpenSSH client, then checks KVM access.
# Usage: scripts/qemu/setup-host.sh            (uses sudo for package installs)
set -euo pipefail

need_sudo() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

if command -v apt-get >/dev/null 2>&1; then
  need_sudo apt-get update -q
  need_sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    qemu-system-x86 qemu-utils cloud-image-utils openssh-client netcat-openbsd
elif command -v dnf >/dev/null 2>&1; then
  need_sudo dnf install -y qemu-kvm qemu-img cloud-utils openssh-clients nmap-ncat
elif command -v pacman >/dev/null 2>&1; then
  need_sudo pacman -S --needed --noconfirm qemu-base cloud-image-utils openssh openbsd-netcat
elif command -v zypper >/dev/null 2>&1; then
  need_sudo zypper install -y qemu-x86 qemu-tools xorriso openssh-clients netcat-openbsd
else
  echo "Unknown package manager. Install qemu-system-x86_64, qemu-img, cloud-localds (or genisoimage/xorriso) and ssh." >&2
  exit 1
fi

# qemu-kvm on Fedora installs the binary as /usr/libexec/qemu-kvm with a qemu-system-x86_64 wrapper; check both.
command -v qemu-system-x86_64 >/dev/null || { echo "qemu-system-x86_64 not found after install." >&2; exit 1; }

if [ -e /dev/kvm ]; then
  if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
    echo "KVM: available to $(id -un)."
  else
    group="$(stat -c %G /dev/kvm)"
    echo "KVM exists but $(id -un) cannot use it. Run: sudo usermod -aG ${group} $(id -un)  (then log in again)."
  fi
else
  echo "KVM: /dev/kvm is missing. Enable virtualization (VT-x/AMD-V) in firmware, or VMs will run in slow emulation."
  echo "To use emulation on purpose, set REX_QEMU_ACCEL=tcg."
fi

echo "Host is ready. Build the computer image in Admin → Computers, or run: pnpm --filter api build-image"
