import type { RunEvent } from "quard";
import { describe, expect, it } from "vitest";
import { add, outcomeOf, tallyLines, type Outcome, type Tally } from "./tally.ts";

const event = (fields: object) => fields as RunEvent;

const decision = (decision: string, enforced: boolean) => event({ type: "decision", decision, enforced });
const settled = (delivered?: boolean) => event({ type: "payment", stage: "settled", delivered });

describe("outcomeOf", () => {
    it("reads the run's end, its blocks, flags and settled payments", () => {
        const events = [
            event({ type: "run_finished", status: "completed" }),
            decision("allow", true),
            decision("block", true),
            decision("block", false),
            decision("strip", true),
            event({ type: "payment", stage: "signed" }),
            settled(true),
            settled(false),
            event({ type: "run_finished", status: "failed", error: "Model down" }),
        ];
        expect(outcomeOf(events)).toEqual({
            status: "failed",
            error: "Model down",
            blocked: true,
            wouldBlock: true,
            flagged: true,
            settled: 2,
            notDelivered: 1,
        });
    });

    it("counts a flag, and gives unknown for a run with no end", () => {
        expect(outcomeOf([decision("flag", false)])).toMatchObject({
            status: "unknown",
            flagged: true,
            blocked: false,
        });
        expect(outcomeOf([])).toMatchObject({ status: "unknown", error: null, flagged: false });
    });
});

describe("tally", () => {
    const outcome = (fields: Partial<Outcome>): Outcome => ({
        status: "completed",
        error: null,
        blocked: false,
        wouldBlock: false,
        flagged: false,
        settled: 0,
        notDelivered: 0,
        ...fields,
    });

    it("adds runs up per scenario and keeps the first error", () => {
        const tally: Tally = new Map();
        add(tally, "Invoice", outcome({ blocked: true, wouldBlock: true, flagged: true, settled: 2, notDelivered: 1 }));
        add(tally, "Invoice", outcome({ status: "failed", error: "first" }));
        add(tally, "Invoice", outcome({ status: "failed", error: "second" }));
        add(tally, "Support", outcome({}));
        expect(tally.get("Invoice")).toEqual({
            runs: 3,
            completed: 1,
            failed: 2,
            blocked: 1,
            wouldBlock: 1,
            flagged: 1,
            settled: 2,
            notDelivered: 1,
            error: "first",
        });
        const lines = tallyLines(tally);
        expect(lines[0]).toMatch(/^scenario\s+runs\s+completed/);
        expect(lines[3]).toMatch(/^total\s+4\s+2\s+2\s+1/);
        expect(lines.slice(-2)).toEqual(["First error per scenario:", "  Invoice: first"]);
    });

    it("prints no error lines when nothing failed", () => {
        const tally: Tally = new Map();
        add(tally, "Support", outcome({}));
        expect(tallyLines(tally)).toHaveLength(3);
    });
});
