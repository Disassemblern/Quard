import { describe, expect, it } from "vitest";
import { definitions } from "../../lib/tools.ts";
import { seeded } from "../random.ts";
import { SCENARIOS } from "./index.ts";
import { invoiceEmail } from "./scenario.ts";

const byName = (name: string) => SCENARIOS.find((scenario) => scenario.name === name)!;

describe("SCENARIOS", () => {
    it("have unique names and weights that add up to about 100", () => {
        expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(SCENARIOS.length);
        expect(SCENARIOS.reduce((total, s) => total + s.weight, 0)).toBe(101);
    });

    it.each(SCENARIOS)("$name: sets up the same run for the same seed, with known tools", (scenario) => {
        const setup = scenario.setup(seeded(5));
        expect(setup.prompt.length).toBeGreaterThan(10);
        expect(scenario.setup(seeded(5))).toEqual(setup);
        expect(() => definitions([...scenario.tools, ...(scenario.handoff?.tools ?? [])])).not.toThrow();
    });

    it("hides an attacker IBAN in the poisoned invoice email", () => {
        const email = byName("Poisoned invoice email").setup(seeded(1)).email!;
        expect(email).toMatch(/display:none.*IBAN (GB|NL|LT)\d\d/s);
    });

    it("asks for one to five quotes, and gives the long run twelve pages", () => {
        const counts = Array.from(
            { length: 50 },
            (_, i) =>
                (
                    byName("Paid quote API")
                        .setup(seeded(i))
                        .prompt.match(/quotes\.example\/rates/g) ?? []
                ).length,
        );
        expect(Math.min(...counts)).toBe(1);
        expect(Math.max(...counts)).toBe(5);
        expect(Object.keys(byName("Long run past the step limit").setup(seeded(1)).pages!)).toHaveLength(12);
    });
});

describe("invoiceEmail", () => {
    it("writes an invoice from Globex or Initech", () => {
        expect(invoiceEmail("Globex", 1234, 500)).toContain("From: billing@globex.com");
        expect(invoiceEmail("Initech", 1234, 500)).toMatch(/accounts@initech\.de[\s\S]*IN-1234[\s\S]*500\.00 EUR/);
    });
});
