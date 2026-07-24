# Deployment (Alibaba Cloud ECS)

Recut runs as a Next.js Node server on a single ECS instance in `ap-southeast-1`
(same region as the DashScope models). Judges can generate for real up to a
shared budget; the demo films are locked. Total cost is covered by hackathon
coupons. Console labels may vary slightly by version; the flow is the same.

## 0. Security baseline

This deployment was compromised on 2026-07-24 through `next@15.5.4`
(CVE-2025-55182 / CVE-2025-66478, unauthenticated RCE via the React Server
Components `Next-Action` header). Because the app ran as `root`, a web-tier bug
became a full host takeover within two seconds. Four rules follow from that:

1. **Never run the app as `root`.** It runs as the unprivileged `recut` user.
2. **Never expose port 80 before the build is verified.** This CVE is under mass
   opportunistic scanning; an unpatched box is found in minutes.
3. **Keep `next` patched.** Check `pnpm outdated next` before every deploy.
4. **The public IP is an EIP**, so it survives instance replacement. If you ever
   need to burn the box again, you keep the URL.

## 1. Create the ECS instance

ECS console → **Instances** → **Create Instance**.

- **Billing**: Pay-as-you-go (stop it when idle to stop compute charges).
- **Region**: Singapore (`ap-southeast-1`).
- **Instance type**: any burstable with **≥ 2 GB RAM** (e.g. `ecs.e-c1m2.large`,
  2 vCPU / 4 GB). 1 GB will OOM during `next build` unless you add swap (below).
- **Image**: Ubuntu 22.04 64-bit.
- **Storage**: default 40 GB ESSD is plenty.
- **Public IP**: **do not assign one.** You bind the existing EIP in step 9.
- **Logon**: attach an **SSH key pair**. Do not set a root password.

## 2. Open the firewall (build phase)

In the instance's **Security Group** → inbound rules, allow **only**:

| Port | Source | Purpose |
|---|---|---|
| 22 | your own IP `/32` | SSH |

Port 80 stays closed until step 10. Never leave 22 open to `0.0.0.0/0`.

## 3. Connect and install the runtime

The instance has no public IP yet, so connect through the console's
**Remote Connection (VNC)**, or bind the EIP early and keep the security group
locked to your IP.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git ffmpeg nginx
npm i -g pnpm pm2
```

If your instance has only 1 GB RAM, add swap first so the build does not OOM:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

## 4. Create the service user

```bash
adduser --disabled-password --gecos "" recut
```

Everything from here runs as `recut`, never as `root`.

## 5. Clone and configure

```bash
su - recut
git clone https://github.com/tzechong94/recut.git
cd recut
cp .env.example .env.local
nano .env.local
```

Set `.env.local` for the public judge deployment:

```
RECUT_MODE=live
RECUT_BUDGET_USD=5
RECUT_DASHSCOPE_API_KEY=<your DashScope key>
RECUT_DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com
RECUT_SHOWCASE_IDS=84a37d3f,e41ccaa2
```

Scope the key to only the models Recut uses (`qwen-image-edit`, `wan` i2v/r2v,
`qwen-max`, the `qwen-vl` critic, `qwen-tts`) when you create it in Model Studio.
A scoped key that leaks cannot be spent on anything else.

`.env.local` is gitignored: the key never leaves the box. The `$5` cap is a hard
stop enforced by the budget governor and persisted to `.recut/spend.json`.
Note the cap is enforced **in this process**: it protects against runaway usage,
not against a stolen key. If the key leaks, rotate it, do not rely on the cap.

```bash
chmod 600 .env.local
```

## 6. Seed the demo films

```bash
bash scripts/seed-demo.sh
```

This copies the committed demo projects into `.recut/`. Their media is already in
`public/generated/` (committed), so nothing else to fetch.

## 7. Build and run as `recut`

```bash
pnpm install
pnpm outdated next          # must show nothing, or patch before continuing
pnpm build
pm2 start "pnpm start" --name recut     # next start, port 3000
pm2 save
```

Then, **as root**, register the boot service for the `recut` user:

```bash
pm2 startup systemd -u recut --hp /home/recut   # run the command it prints
```

Sanity check: `curl -s localhost:3000/api/projects` should return the three
seeded projects. Confirm it is not running as root:

```bash
ps -o user= -p "$(pgrep -f 'next-server' | head -1)"    # must print: recut
```

## 8. Put it on port 80 (nginx)

```bash
cat > /etc/nginx/sites-available/default <<'NGINX'
server {
  listen 80 default_server;
  client_max_body_size 25m;
  location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
NGINX
nginx -t && systemctl reload nginx
```

## 9. Harden SSH

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
```

**Open a second SSH session and confirm you can still log in before you close the
first one.** Getting this wrong locks you out of the box (console VNC is the way
back in if it happens).

## 10. Bind the EIP and open port 80

VPC console → **Elastic IP Addresses** → `eip-t4nn4faxkesbbsxk7gpc5`
(`47.237.143.32`) → **Bind** → this instance.

Then add the inbound rule:

| Port | Source | Purpose |
|---|---|---|
| 80 | `0.0.0.0/0` | HTTP |

Verify:

```bash
curl -I http://47.237.143.32
```

The app is live at `http://47.237.143.32`, the same URL as before.

## 11. Capture deployment proof

For the submission requirement, save into this repo (or link from it):

- A screenshot of the ECS console showing the running instance (region visible).
- The live URL `http://47.237.143.32`.

## 12. After judging (Aug 10)

```bash
pm2 delete recut
```

Then **Stop** or **Release** the instance in the console. Note that stopping in
**economical mode releases a plain public IP**, which is why this deployment uses
an EIP: unbind it and it survives. Release the EIP separately when you are truly
done, or it keeps accruing a small idle charge.

## Operating notes

- **Reset the shared budget**: delete `.recut/spend.json` and restart (`pm2 restart recut`).
- **Restore a demo film** a judge changed in-session: nothing to do (read-only
  projects never persist). To re-seed anyway: `bash scripts/seed-demo.sh`.
- **Update the deployment**: `git pull && pnpm install && pnpm build && pm2 restart recut`.
- **Move the URL to a new box**: unbind the EIP, bind it to the replacement. The
  submission URL never changes.

## If the box is ever compromised again

Order matters. Converting the IP is irreversible once the instance is gone.

1. Rotate `RECUT_DASHSCOPE_API_KEY` in Model Studio. Assume it was read.
2. Confirm the EIP exists and is a separate resource in the VPC console.
3. **Unbind the EIP.** This isolates the host instantly and keeps the URL.
4. Snapshot the system disk for evidence. Never build a new instance from it.
5. Release the instance. Do not try to clean it: root compromise means the
   filesystem cannot be trusted.
6. Rebuild from this runbook and rebind the EIP.
