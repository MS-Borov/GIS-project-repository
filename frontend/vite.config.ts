import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendTarget = "http://backend:8000";
const backendRoutes = [
  "/auth",
  "/courses",
  "/assignments",
  "/submissions",
  "/downloads",
  "/map-drafts",
  "/map-assistant",
  "/health",
];

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      },
      ...Object.fromEntries(
        backendRoutes.map((route) => [
          route,
          {
            target: backendTarget,
            changeOrigin: true,
          },
        ]),
      ),
    }
  }
});
