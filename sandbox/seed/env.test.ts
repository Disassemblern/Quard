import { afterEach, describe, expect, it, vi } from "vitest";

describe("seed env", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("replaces a real OpenAI key and URL, so nothing reaches OpenAI", async () => {
        vi.stubEnv("OPENAI_API_KEY", "sk-real");
        vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
        await import("./env.ts");
        expect(process.env.OPENAI_API_KEY).toBe("not-used");
        expect(process.env.OPENAI_BASE_URL).toBe("http://127.0.0.1:9/v1");
    });
});
