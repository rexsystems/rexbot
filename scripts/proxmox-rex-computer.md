# Rex Computer on Proxmox

One Debian VM, named `rex-computer`, shared by every bot. Each bot gets its own 1280×800 screen (Xvfb + Openbox + tint2), a private folder `/workspace/bots/<bot id>`, and the shared folder `/workspace/shared`. The Rex API talks to Proxmox only to check and start that one VM, and to the guest over SSH for everything else. noVNC is bound to localhost inside the VM and reaches your browser through an SSH tunnel and the Rex API, so nothing new is exposed on your LAN.

The steps below create one new VM. They never modify, stop, or delete your other VMs: `create-vm.sh` refuses to run if the VMID or the name `rex-computer` already exists, the API token only gets rights on that VMID, and the API refuses to act on a VM with a different name.

## 1. SSH key on the Rex host

```bash
ssh-keygen -t ed25519 -f ~/.ssh/rex_computer -N "" -C rex-computer
scp ~/.ssh/rex_computer.pub root@192.168.100.25:/root/rex_computer.pub
```

## 2. Create the VM (on the Proxmox host, as root)

Pick a free VMID (check the Proxmox UI). Copy `scripts/proxmox/create-vm.sh` to the host and run it:

```bash
scp scripts/proxmox/create-vm.sh root@192.168.100.25:/root/
ssh root@192.168.100.25
VMID=180 SSH_KEY_FILE=/root/rex_computer.pub bash /root/create-vm.sh
```

Optional variables: `STORAGE` (default `local-lvm`), `BRIDGE` (`vmbr0`), `MEMORY` (`4096`), `CORES` (`2`), `DISK` (`32G`), and `IPCONFIG` for a static address, e.g. `IPCONFIG=ip=192.168.100.50/24,gw=192.168.100.1`. A static address is easiest, because the API needs it.

## 3. API token with rights on that VM only

Still on the Proxmox host:

```bash
pveum role add RexComputer -privs "VM.Audit VM.PowerMgmt"
pveum user add rex@pve
pveum aclmod /vms/180 -user rex@pve -role RexComputer
pveum user token add rex@pve rex --privsep 0
```

Keep the printed secret. `VM.Audit` lets Rex read the VM's name and state; `VM.PowerMgmt` lets it start and shut down that VM. Nothing else.

## 4. Provision the guest (from the Rex host)

Wait until the VM has booted, then:

```bash
scripts/proxmox/install-guest.sh 192.168.100.50 ~/.ssh/rex_computer
```

It installs the desktop pieces, `rex-sessiond`, and the workspace folders, then prints `rex-sessiond: ok`. The `rex` user gets passwordless sudo so bots can `sudo apt-get install -y …` and set the machine up themselves.

## 5. Point Rex at it

Add to the repository's `.env` (the API loads it at start; exported shell variables win):

```bash
REX_COMPUTER_BACKEND=proxmox
REX_PROXMOX_URL=https://192.168.100.25:8006
REX_PROXMOX_NODE=pve
REX_PROXMOX_VMID=180
REX_PROXMOX_TOKEN_ID=rex@pve!rex
REX_PROXMOX_TOKEN_SECRET=paste-the-secret
# Proxmox uses a self-signed certificate by default. Either trust it:
REX_PROXMOX_INSECURE_TLS=1
# or point at its CA: REX_PROXMOX_CA_FILE=/path/to/pve-root-ca.pem
REX_COMPUTER_SSH_HOST=192.168.100.50
REX_COMPUTER_SSH_USER=rex
REX_COMPUTER_SSH_KEY=~/.ssh/rex_computer
```

`REX_PROXMOX_NODE` is the node name shown in the Proxmox tree (often `pve`). Restart `pnpm dev`. The computer panel now shows the VM state and, once it is up, the active bot's screen.

## How it behaves

- **Always on:** bots start the VM through Proxmox when they need it, and wait for SSH. **Shut down VM** in the panel powers it off gracefully; files on its disk stay.
- **Separate screens:** each bot gets display `:10`–`:17` on first use. With more than 8 bots, the least recently used unlocked screen is closed and reused.
- **Locking:** while a bot uses `computer_input`, its screen is view-only for you. It unlocks after about a minute without input, or when you press **Take control**.
- **Commands:** `computer_exec` runs `bash` as `rex` in the bot's folder with `DISPLAY` set to its screen and a 5-minute limit. Bots have passwordless sudo, so they can install packages and change the guest. Manual commands from the panel run on the bot currently shown.

## Network

The VM has normal network access so bots can browse. If it should not reach the rest of your LAN, enable the Proxmox firewall on VM 180 and allow only your gateway plus inbound SSH from the Rex host.

## Troubleshooting

| Panel says | Check |
| --- | --- |
| Token rejected / lacks permission | Token id format `user@realm!tokenname`, secret, ACL on `/vms/<VMID>` |
| VM is named "...", not "rex-computer" | `REX_PROXMOX_VMID` points at the wrong VM; Rex will not touch it |
| rex-sessiond is not answering | `ssh -i ~/.ssh/rex_computer rex@<vm-ip> rex-sessiond ping` |
| Black or empty screen | `ssh ... rex-sessiond status`, then `rex-sessiond release <bot id>` and reopen the panel |
