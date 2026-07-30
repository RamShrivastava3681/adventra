// ────────────────────────────────────────────────────────────────────────────
// PM2 Ecosystem Configuration
// The frontend is a static SPA served by Nginx — only the backend needs PM2.
//
// Start:         pm2 start ecosystem.config.cjs
// View status:   pm2 status
// View logs:     pm2 logs
// Restart:       pm2 restart adventra-backend
// Stop:          pm2 stop ecosystem.config.cjs
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "adventra-backend",
      cwd: "./backend",
      script: "./dist/server.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
        PORT: 4040,
      },
      env_file: "./backend/.env",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "500M",
      error_file: "../logs/backend-error.log",
      out_file: "../logs/backend-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      kill_timeout: 10000,
    },
  ],
};
