import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's worker, copied in by scripts/copy-maplibre-worker.mjs.
    "public/maplibre/**",
    // Copied in unmodified by scripts/sync.mjs and held identical by test/sync.test.ts. They are
    // linted where they live (apps/registry, demos/kit); a lint fix here would be drift.
    "components/ui/**",
    "lib/map-*.ts",
    "lib/map-*.tsx",
    "lib/kit/**",
  ]),
]);

export default eslintConfig;
