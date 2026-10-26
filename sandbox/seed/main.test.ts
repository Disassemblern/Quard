import { afterEach, describe, expect, it, vi } from "vitest";

const runSeed = vi.hoisted(() => vi.fn(async () => 0));

vi.mock("./run.ts", () => ({ runSeed }));

afterEach(() => {
    process.exitCode = undefined;
});

describe("seed main", () => {
    it("passes the arguments on and sets the exit code", async () => {
        runSeed.mockResolvedValueOnce(1);

        await import("./main.ts");

        expect(runSeed).toHaveBeenCalledWith(process.argv.slice(2));
        expect(process.exitCode).toBe(1);
    });
});
