import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [
      ["src/wallet.test.ts", "jsdom"],
      ["src/ui/**/*.test.ts", "jsdom"],
    ],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        "src/types.ts",
        "src/ui.ts",
        "src/index.ts",
      ],
    },
  },
});
