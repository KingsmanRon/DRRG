import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  devIndicators: false,
  // Pin the workspace root so Next/Turbopack does not walk up into
  // OneDrive and mistakenly select a stray lockfile (e.g. C:\Users\Ronal)
  // as the root, which corrupts build-manifest paths.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
