import { defineConfig } from "vite";

export default defineConfig({
  base: "/newport-sailing-sim/",
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
});
