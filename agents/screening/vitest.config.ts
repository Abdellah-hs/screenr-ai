import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Source is NodeNext ESM, so intra-package imports carry an explicit `.js`
    // extension that points at a `.ts` file on disk. Teach the resolver that.
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
