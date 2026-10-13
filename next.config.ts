import type { NextConfig } from "next";

// `BASE_PATH` is empty when the demo runs on its own (`pnpm dev`, your own deploy) and `/trails`
// when apps/demos builds it into apps.unmap.dev. It is also handed to the browser, where the kit
// uses it for the MapLibre worker URL.
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  // A static export served by Workers static assets (wrangler.jsonc). All state is in the query
  // string, so there is one page.
  output: "export",
  basePath: basePath || undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ["@unmap/sdk", "@unmap/maps", "@unmap/geocoding", "@unmap/routing", "@unmap/elevation", "@unmap/themes", "@unmap/core"],
};

export default nextConfig;
