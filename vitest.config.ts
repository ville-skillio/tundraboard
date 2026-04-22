import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/types/**"],
      thresholds: {
        statements: 65,
        branches: 65,
        functions: 60,
        lines: 65,
        // Higher bar for newly added route files — enforces that AI-generated
        // endpoints ship with meaningful test coverage before merging.
        "src/routes/labels.ts": {
          statements: 80,
          branches: 60,
          functions: 100,
          lines: 80,
        },
      },
    },
  },
});
