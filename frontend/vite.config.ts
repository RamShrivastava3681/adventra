import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

// ────────────────────────────────────────────────────────────────────────────
// SPA (client-only) build configuration.
// Output: dist/index.html + dist/assets/* — deployable as static files.
// ────────────────────────────────────────────────────────────────────────────
export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    react(),
    tailwindcss(),
    tsConfigPaths(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Dev only: forward /api calls to the Express backend (default port 4040)
    // so the httpOnly session cookie works same-origin in the browser during
    // development — exactly like Nginx does in production. Change the target
    // if the backend runs on a different port.
    proxy: {
      "/api": {
        target: "http://localhost:4040",
        changeOrigin: true,
      },
    },
  },
});
