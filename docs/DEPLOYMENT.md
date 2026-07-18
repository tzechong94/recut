# Deployment (Alibaba Cloud ECS)

Recut runs as a Next.js Node server on a single ECS instance in `ap-southeast-1`
(same region as the DashScope models). Judges can generate for real up to a
shared budget; the demo films are locked. Total cost is covered by hackathon
coupons. Console labels may vary slightly by version; the flow is the same.

## 1. Create the ECS instance

ECS console → **Instances** → **Create Instance**.

- **Billing**: Pay-as-you-go (stop it when idle to stop compute charges).
- **Region**: Singapore (`ap-southeast-1`).
- **Instance type**: any burstable with **≥ 2 GB RAM** (e.g. `ecs.e-c1m2.large`,
  2 vCPU / 4 GB). 1 GB will OOM during `next build` unless you add swap (below).
- **Image**: Ubuntu 22.04 64-bit.
- **Storage**: default 40 GB ESSD is plenty.
- **Public IP**: assign a public IPv4 (or bind an EIP). Bandwidth: pay-by-traffic,
  a small cap (e.g. 5 Mbps) is fine for a demo.
- **Logon**: set a root password or attach an SSH key pair.

Create, then note the **public IP**.

## 2. Open the firewall

In the instance's **Security Group** → inbound rules, allow:

| Port | Purpose |
|---|---|
| 22 | SSH |
| 80 | HTTP |
| 443 | HTTPS (optional) |

## 3. Connect and install the runtime

```bash
ssh root@<PUBLIC_IP>

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git ffmpeg nginx
npm i -g pnpm pm2
```

If your instance has only 1 GB RAM, add swap first so the build does not OOM:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

## 4. Clone and configure

```bash
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

`.env.local` is gitignored: the key never leaves the box. The `$5` cap is a hard
stop enforced by the budget governor and persisted to `.recut/spend.json`.

## 5. Seed the demo films

```bash
bash scripts/seed-demo.sh
```

This copies the committed demo projects into `.recut/`. Their media is already in
`public/generated/` (committed), so nothing else to fetch.

## 6. Build and run

```bash
pnpm install
pnpm build
pm2 start "pnpm start" --name recut     # next start, port 3000
pm2 save
pm2 startup                             # print + run the command it gives, to survive reboots
```

Sanity check: `curl -s localhost:3000/api/projects` should return the three
seeded projects.

## 7. Put it on port 80 (nginx)

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

The app is now live at `http://<PUBLIC_IP>`.

## 8. Capture deployment proof

For the submission requirement, save into this repo (or link from it):

- A screenshot of the ECS console showing the running instance (region visible).
- The live URL `http://<PUBLIC_IP>` (or a domain if you bind one).

## 9. After judging (Aug 10)

Stop or release the instance to end billing:

```bash
pm2 delete recut
```

Then **Stop** (keeps disk, pauses compute billing) or **Release** the instance in
the console.

## Operating notes

- **Reset the shared budget**: delete `.recut/spend.json` and restart (`pm2 restart recut`).
- **Restore a demo film** a judge changed in-session: nothing to do (read-only
  projects never persist). To re-seed anyway: `bash scripts/seed-demo.sh`.
- **Update the deployment**: `git pull && pnpm install && pnpm build && pm2 restart recut`.
