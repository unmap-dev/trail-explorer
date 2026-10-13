import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node by default for the pure modules (URL state, the inspector's call descriptions); component
// tests opt into jsdom per file. The `@/*` alias mirrors tsconfig.json.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.next/**", "**/out/**"],
    testTimeout: 20000,
  },
});
