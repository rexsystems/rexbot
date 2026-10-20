# Rex Computer on Proxmox

One Debian VM, named `rex-computer`, shared by every bot. Each bot gets its own 1280×800 screen (Xvfb + Openbox + tint2), a private folder `/workspace/bots/<bot id>`, and the shared folder `/workspace/shared`. The Rex API talks to Proxmox only to check and start that one VM, and to the guest over SSH for everything else. noVNC is bound to localhost inside the VM and reaches your browser through an SSH tunnel and the Rex API, so nothing new is exposed on your LAN.

## Lazy path (recommended) — all from the UI

1. Start Rex (`pnpm dev`), open the computer panel.
2. Under **Set up the shared desktop**, paste the Proxmox **root password** (used once; not saved). Host/node/storage defaults match a typical LAN setup; open **Advanced** only if you need to change them.
3. Click **Create computer & connect**. Sit back.

That hits `POST /computer/bootstrap`. It generates `~/.ssh/rex_computer` if needed, creates only a new VM named `rex-computer` (or finishes an existing one), makes token `rex@pve!rex` with **only** `VM.Audit` + `VM.PowerMgmt` on that VMID, installs the guest desktop, writes `.env`, and hot-swaps the backend. No restart. Other VMs are never touched.

**Who can reach what after setup:**
- Bots: SSH into the guest as `rex` only. No Proxmox API, no other VMs.
- Rex API: Proxmox only to start/stop/check that one VM (scoped token). Shell and screens go over SSH to the guest.
- `root@pam` tokens are refused in `.env`. Do not put host-admin tokens there.

## Manual path

If you prefer the steps by hand:

1. `ssh-keygen -t ed25519 -f ~/.ssh/rex_computer -N "" -C rex-computer`
2. On Proxmox as root: copy `scripts/proxmox/create-vm.sh`, then  
   `VMID=180 SSH_KEY_FILE=/root/rex_computer.pub IPCONFIG=ip=192.168.100.50/24,gw=192.168.100.1 bash /root/create-vm.sh`
3. Token:  
   `pveum role add RexComputer -privs "VM.Audit,VM.PowerMgmt"`  
   `pveum user add rex@pve`  
   `pveum aclmod /vms/180 -user rex@pve -role RexComputer`  
   `pveum user token add rex@pve rex --privsep 0`
4. From the Rex host: `scripts/proxmox/install-guest.sh 192.168.100.50 ~/.ssh/rex_computer`
5. Put the `REX_PROXMOX_*` / `REX_COMPUTER_SSH_*` vars in `.env` (see `.env.example`) and restart the API.

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
