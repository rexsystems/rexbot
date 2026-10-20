# Rex Computer on QEMU

Every account gets its own Linux VM, run directly by QEMU on the Rex server. Inside it, each of that
account's bots gets its own 1280×800 screen (Xvfb + Openbox + noVNC), mouse and keyboard tools, a private
folder, and passwordless `sudo`. No Proxmox or other VM manager is involved, and the API never needs root.

## How it works

```
data/vms/
  images/                      downloaded Debian cloud image (SHA512-checked)
  templates/rex-desktop-vN.qcow2   provisioned desktop image, never modified after it is built
  template.json                which template is current
  keys/rex_vm                  SSH key the API uses to reach guests (generated on first use)
  machines/<vm>/               disk.qcow2 (copy-on-write overlay), seed.iso, vm.pid, qmp.sock, serial.log
```

1. **Image build (once).** The API downloads the Debian 13 generic cloud image, boots it with a cloud-init
   seed, copies `scripts/guest/` in over SSH, and runs `guest-setup.sh` (desktop packages, Chromium,
   `rex-sessiond`). It then clears cloud-init and SSH host keys so each copy initializes as a new machine,
   powers off, and compresses the disk into `templates/rex-desktop-vN.qcow2`.
2. **Per-account VM.** The first time a bot of an account needs the computer, the API creates a qcow2
   overlay backed by the current template (instant, only changes are stored), writes a cloud-init seed with
   the API's public key, and boots it:
   `qemu-system-x86_64 -machine q35,accel=kvm -cpu host … -netdev user,hostfwd=tcp:127.0.0.1:<port>-:22 -daemonize`.
3. **Control.** The API talks to the guest only over SSH on that loopback port (`rex-sessiond` subcommands,
   user text on stdin) and powers the VM off through QEMU's QMP socket (`system_powerdown`, then a hard stop
   if the guest does not respond). Screens stream through SSH tunnels and the API's noVNC proxy; the browser
   never connects to the VM.
4. **Restarts.** VMs are daemonized, so restarting the API leaves them running. The API finds them again by
   pidfile and verifies the process name before signalling anything.

## Host setup

```bash
scripts/qemu/setup-host.sh       # installs qemu, qemu-img, cloud-image-utils, ssh; checks /dev/kvm
pnpm --filter api build-image     # or: Admin → Computers → Build image
```

KVM makes VMs fast. Without `/dev/kvm` (or when nested virtualization is broken), QEMU falls back to
software emulation (TCG); it works but the image build can take 30 minutes or more and the desktop is slow.
Force a mode with `REX_QEMU_ACCEL=tcg`. Admins see the detected mode in Admin → Computers.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `REX_COMPUTER_BACKEND` | `qemu` | `qemu` (VM per account) or `podman` (offline sandbox per account, no screen) |
| `REX_VM_DIR` | `<data>/vms` | Where images, templates, keys and VM disks live |
| `REX_QEMU_ACCEL` | auto | `tcg` forces software emulation |
| `REX_QEMU_BINARY`, `REX_QEMU_IMG` | from `PATH` | Custom QEMU binaries |
| `REX_QEMU_BASE_IMAGE_URL` | Debian 13 genericcloud amd64 | Cloud image used for new templates |

CPU, memory and disk per VM, the maximum number of running VMs, and idle shutdown are workspace settings in
Admin → Settings. New limits apply to a VM on its next boot; disks can grow but never shrink.

## Security model and limits

- Each account's bots share that account's VM; different accounts never share a VM.
- Guests use QEMU user-mode networking: outbound internet works, and only SSH is forwarded, bound to the host's
  loopback. In user-mode networking the guest can reach services listening on the host's loopback through
  `10.0.2.2`. The Rex API requires sign-in, but if the host runs other unauthenticated local services, put
  them behind authentication or run Rex on a dedicated host.
- Bots have passwordless `sudo` inside their VM. That is root in the guest, not on the host.
- **Reset computer** (admin) deletes the overlay disk; the next start creates a fresh VM from the newest template.
- Only x86_64 guests are built today.
