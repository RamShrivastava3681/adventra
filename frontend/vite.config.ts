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
});
