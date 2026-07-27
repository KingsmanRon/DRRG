import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // .tsx too: component markup is asserted with renderToStaticMarkup.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
