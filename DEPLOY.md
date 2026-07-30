# 🚀 Adventra Platform — Deployment Guide

## Overview

| Component | Technology | Deployment |
|-----------|-----------|------------|
| **Frontend** | React + TanStack Router (SPA) | Static files served by Nginx |
| **Backend** | Express.js + TypeScript | PM2 |

The frontend is a **static single-page application** (SPA). `npm run build` generates
a `dist/` folder with `index.html` and hashed JS/CSS assets that Nginx serves directly.
No Node.js process is needed for the frontend at runtime.

---

## 1. Prerequisites

- **Node.js** >= 20.x (LTS recommended)
- **npm** >= 9.x
- **PM2** (install globally: `npm install -g pm2`)
- **Nginx** (Ubuntu: `sudo apt install nginx`)
- Git access to this repository

---

## 2. Build

```bash
# Clone the repository
git clone <your-repo-url> adventra
cd adventra

# ── Backend ───────────────────────────────────────
cd backend
npm install
npm run build          # → creates backend/dist/server.js
cd ..

# ── Frontend ──────────────────────────────────────
cd frontend
npm install
npm run build          # → creates frontend/dist/
cd ..
```

### Build output structure

```
frontend/dist/
├── index.html               # Entry point (served by Nginx)
└── assets/
    ├── index-xxxxxx.js      # Main JS bundle (hashed)
    └── index-xxxxxx.css     # Styles (hashed)

backend/dist/
├── server.js                # Express API entry (run with PM2)
├── config.js
├── dynamodb.js
├── middleware/
└── models/
```

---

## 3. Environment Variables

### Backend (`backend/.env`)

```bash
PORT=4040
NODE_ENV=production
JWT_SECRET=<your-secret>
JWT_EXPIRES_IN=7d
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=<your-aws-key>
AWS_SECRET_ACCESS_KEY=<your-aws-secret>
DYNAMODB_TABLE=adventra
CORS_ORIGIN=https://adventra.whizunikhub.com
```

### Frontend (`frontend/.env`)

```bash
VITE_API_URL=/api
VITE_FRONTEND_URL=https://adventra.whizunikhub.com
```

> ⚠️ **Important**: `VITE_*` env vars are baked into the JS bundle at build time.
> If your deployment domain differs from where you run `npm run build`, ensure
> the correct URL is set in the `.env` file **before** building.

---

## 4. Deploy the Backend with PM2

First, create the logs directory and start the backend:

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs

# Save the process list so PM2 restarts on server reboot
pm2 save
pm2 startup
```

### Useful PM2 commands

```bash
pm2 status                     # List all processes
pm2 logs adventra-backend      # Backend logs
pm2 restart adventra-backend   # Restart backend
pm2 stop ecosystem.config.cjs  # Stop all
```

---

## 5. Deploy the Frontend with Nginx

Copy the built `frontend/dist/` folder to your server, or build on the server directly.
Then configure Nginx to serve it.

### Quick Nginx config

Copy the example config:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/adventra
```

Edit it to set your domain and root path:

```bash
sudo nano /etc/nginx/sites-available/adventra
```

**Key changes to make:**
1. Replace `adventra.whizunikhub.com` with your actual domain
2. Update the `root` path to point to `frontend/dist/` on your server
3. Set up SSL certificates (see Section 6)

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/adventra /etc/nginx/sites-enabled/
sudo nginx -t            # Validate config
sudo systemctl reload nginx
```

### How the Nginx config works

- `/assets/*` — served directly with a 1-year cache header (immutable hashed files)
- `/api/*` — proxied to the backend Express server (port 4040)
- Everything else — serves `index.html` so TanStack Router can handle client-side routing
  (this is the **SPA fallback** pattern)

---

## 6. SSL with Let's Encrypt (Certbot)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d adventra.whizunikhub.com
```

Certbot will automatically update the Nginx config with SSL certificates and set up
auto-renewal.

---

## 7. Verification

```bash
# Check PM2 process
pm2 status

# Test the frontend
curl -I https://adventra.whizunikhub.com

# Test the backend API
curl https://adventra.whizunikhub.com/api/health

# Check Nginx
sudo nginx -t
sudo systemctl status nginx
```

---

## 8. Updating

```bash
# Pull latest code
git pull

# Rebuild
cd backend && npm install && npm run build && cd ..
cd frontend && npm install && npm run build && cd ..

# Restart backend
pm2 restart adventra-backend

# Frontend just needs Nginx to pick up the new files (already live if dist/ is in-place)
sudo systemctl reload nginx   # if you changed the config
```

---

## 9. Folder Reference

```
adventra/
├── ecosystem.config.cjs     # PM2 config (backend only)
├── deploy/
│   └── nginx.conf           # Nginx config example
├── backend/
│   ├── dist/server.js       # Built API server
│   ├── package.json         # "npm run build" = tsc
│   └── src/server.ts        # Entry point
└── frontend/
    ├── dist/
    │   ├── index.html       # Static entry (served by Nginx)
    │   └── assets/          # Hashed JS/CSS (cache forever)
    ├── package.json         # "npm run build" = vite build
    └── src/
        ├── main.tsx         # Client entry point
        └── routes/          # TanStack Router routes
```
