import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 80,
        statements: 95,
      },
    },
  },
});
