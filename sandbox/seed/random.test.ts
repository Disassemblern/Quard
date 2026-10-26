import { describe, expect, it } from "vitest";
import { between, oneOf, pick, seeded } from "./random.ts";

describe("seeded", () => {
    it("gives the same numbers for the same seed, between 0 and 1", () => {
        const a = seeded(42);
        const b = seeded(42);
        const numbers = Array.from({ length: 5 }, () => a());
        expect(numbers).toEqual(Array.from({ length: 5 }, () => b()));
        expect(numbers.every((n) => n >= 0 && n < 1)).toBe(true);
        expect(seeded(43)()).not.toBe(numbers[0]);
    });
});

describe("pick", () => {
    const items = [
        { name: "a", weight: 70 },
        { name: "b", weight: 20 },
        { name: "c", weight: 10 },
    ];

    it("follows the weights within 2% over 10,000 draws", () => {
        const random = seeded(7);
        const counts = { a: 0, b: 0, c: 0 };
        for (let i = 0; i < 10_000; i++) {
            counts[pick(random, items).name as "a" | "b" | "c"] += 1;
        }
        expect(Math.abs(counts.a / 10_000 - 0.7)).toBeLessThan(0.02);
        expect(Math.abs(counts.b / 10_000 - 0.2)).toBeLessThan(0.02);
        expect(Math.abs(counts.c / 10_000 - 0.1)).toBeLessThan(0.02);
    });

    it("falls back to the last item when the roll reaches the total", () => {
        expect(pick(() => 1, items).name).toBe("c");
    });
});

describe("between and oneOf", () => {
    it("stay inside their bounds", () => {
        expect(between(() => 0, 3, 5)).toBe(3);
        expect(between(() => 0.999, 3, 5)).toBe(5);
        expect(oneOf(() => 0.5, ["x", "y", "z"])).toBe("y");
    });
});
