import { defineConfig } from "astro/config";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://phulin.me",
  output: "static",
  outDir: "dist",
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
