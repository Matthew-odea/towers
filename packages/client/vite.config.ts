import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: {
      "/ws": { target: "http://localhost:8787", ws: true },
      "/config.json": "http://localhost:8787",
    },
  },
});
