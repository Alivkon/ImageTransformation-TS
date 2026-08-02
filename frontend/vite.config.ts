import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  // The public website owns the domain root. The authenticated application is
  // deliberately built below /app so its asset URLs cannot collide with it.
  base: "/app/",
  build: {
    outDir: "../frontend-dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/uploads": "http://localhost:8080",
    },
  },
});
