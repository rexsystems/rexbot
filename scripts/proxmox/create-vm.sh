#!/usr/bin/env bash
# Run as root on the Proxmox host. Creates ONE new VM named rex-computer.
# It refuses to run if the VMID already exists, so existing VMs are never touched.
set -euo pipefail

VMID="${VMID:?Set VMID to a free id, e.g. VMID=180}"
SSH_KEY_FILE="${SSH_KEY_FILE:?Set SSH_KEY_FILE to the Rex host public key, e.g. /root/rex_computer.pub}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
MEMORY="${MEMORY:-4096}"
CORES="${CORES:-2}"
DISK="${DISK:-32G}"
IPCONFIG="${IPCONFIG:-ip=dhcp}"
IMAGE_URL="${IMAGE_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
IMAGE="/var/lib/vz/template/iso/debian-12-genericcloud-amd64.qcow2"

if qm status "$VMID" >/dev/null 2>&1; then
  echo "VMID $VMID already exists. Pick a free id; this script never modifies existing VMs." >&2
  exit 1
fi
if qm list | awk 'NR > 1 { print $2 }' | grep -qx rex-computer; then
  echo "A VM named rex-computer already exists. Reuse it instead of creating another." >&2
  exit 1
fi
[ -r "$SSH_KEY_FILE" ] || { echo "Cannot read $SSH_KEY_FILE" >&2; exit 1; }

mkdir -p "$(dirname "$IMAGE")"
if [ ! -f "$IMAGE" ]; then
  echo "Downloading Debian 12 cloud image..."
  wget -q --show-progress -O "$IMAGE.part" "$IMAGE_URL"
  mv "$IMAGE.part" "$IMAGE"
fi

qm create "$VMID" \
  --name rex-computer \
  --tags rex \
  --memory "$MEMORY" \
  --cores "$CORES" \
  --cpu host \
  --ostype l26 \
  --net0 "virtio,bridge=$BRIDGE" \
  --scsihw virtio-scsi-pci \
  --agent enabled=1 \
  --serial0 socket \
  --vga serial0 \
  --onboot 1

qm set "$VMID" --scsi0 "$STORAGE:0,import-from=$IMAGE"
qm disk resize "$VMID" scsi0 "$DISK"
qm set "$VMID" --ide2 "$STORAGE:cloudinit" --boot order=scsi0
qm set "$VMID" --ciuser rex --sshkeys "$SSH_KEY_FILE" --ipconfig0 "$IPCONFIG"
qm start "$VMID"

echo
echo "Created and started VM $VMID (rex-computer)."
echo "Find its IP in the Proxmox UI (Summary, once the guest agent runs) or your DHCP leases,"
echo "then run scripts/proxmox/install-guest.sh from the Rex host."
