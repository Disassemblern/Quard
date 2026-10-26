import { defineConfig } from "vitest/config";
import { packageConfig } from "../vitest.shared.ts";

const shared = packageConfig();

// The examples are run by hand; the playground and the seed are measured
export default defineConfig({
    ...shared,
    test: { ...shared.test, coverage: { ...shared.test?.coverage, include: ["playground/**/*.ts", "seed/**/*.ts"] } },
});
