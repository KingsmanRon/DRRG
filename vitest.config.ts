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
    // .tsx too: the table's grouping is asserted on rendered markup.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
