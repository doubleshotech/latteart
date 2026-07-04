import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { lazyPlugins } from "vite-plus";

// https://vite.dev/config/
export default defineConfig({
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      // The backend is the only thing that talks to providers. Proxying /api
      // keeps the browser same-origin and kills CORS for local models.
      "/api": {
        target: "http://localhost:8899",
        changeOrigin: true,
      },
    },
  },
  plugins: lazyPlugins(() => [react(), tailwindcss()]),
});
