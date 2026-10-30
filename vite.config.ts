import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __ENGINE_VARIANT__: JSON.stringify(
      process.env.CHESS_ASSIST_ENGINE === "full" ? "full" : "lite",
    ),
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
});
