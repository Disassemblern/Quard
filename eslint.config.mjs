import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
    // web/ and docs/ have their own ESLint setup; bi/ is Python and SQL
    globalIgnores(["**/node_modules/**", "**/dist/**", "**/coverage/**", "web/**", "docs/**", "bi/**"]),
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
]);
