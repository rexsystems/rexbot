#!/usr/bin/env bash
# Run on the Rex host: copies the guest files to the new VM and provisions it.
# Usage: scripts/proxmox/install-guest.sh 192.168.100.50 [~/.ssh/rex_computer]
set -euo pipefail

HOST="${1:?Usage: install-guest.sh <vm-ip> [ssh-key]}"
KEY="${2:-$HOME/.ssh/rex_computer}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new)

"${SSH[@]}" "rex@$HOST" "rm -rf /tmp/rex-setup && mkdir -p /tmp/rex-setup"
scp -i "$KEY" -o IdentitiesOnly=yes "$HERE/rex-sessiond" "$HERE/rex-sessiond-boot.service" "$HERE/guest-setup.sh" "rex@$HOST:/tmp/rex-setup/"
"${SSH[@]}" "rex@$HOST" "sudo bash /tmp/rex-setup/guest-setup.sh"
"${SSH[@]}" "rex@$HOST" "rex-sessiond ping"
