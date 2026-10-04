import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// TOWERS_CLIENT_PORT / TOWERS_SERVER_PORT let e2e tests run on their own ports.
const serverPort = Number(process.env.TOWERS_SERVER_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.TOWERS_CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: {
      "/ws": { target: `http://localhost:${serverPort}`, ws: true },
      "/config.json": { target: `http://localhost:${serverPort}`, changeOrigin: false },
    },
  },
});
