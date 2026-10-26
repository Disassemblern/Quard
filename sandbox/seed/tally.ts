import type { RunEvent } from "quard";

type Finished = Extract<RunEvent, { type: "run_finished" }>;
type Decision = Extract<RunEvent, { type: "decision" }>;
type Payment = Extract<RunEvent, { type: "payment" }>;

// What one run recorded, as the SDK saw it
export type Outcome = {
    status: Finished["status"] | "unknown";
    error: string | null;
    blocked: boolean;
    wouldBlock: boolean;
    flagged: boolean;
    settled: number;
    notDelivered: number;
};

export function outcomeOf(events: RunEvent[]): Outcome {
    // A handoff finishes its own scope first; the run's end comes last
    const end = events.findLast((event): event is Finished => event.type === "run_finished");
    const decisions = events.filter((event): event is Decision => event.type === "decision");
    const settled = events.filter((event): event is Payment => event.type === "payment" && event.stage === "settled");
    return {
        status: end?.status ?? "unknown",
        error: end?.error ?? null,
        blocked: decisions.some((d) => d.decision === "block" && d.enforced),
        wouldBlock: decisions.some((d) => d.decision === "block" && !d.enforced),
        flagged: decisions.some((d) => d.decision === "flag" || d.decision === "strip"),
        settled: settled.length,
        notDelivered: settled.filter((p) => p.delivered === false).length,
    };
}

export type Row = {
    runs: number;
    completed: number;
    failed: number;
    blocked: number;
    wouldBlock: number;
    flagged: number;
    settled: number;
    notDelivered: number;
    // The first error, to show why runs failed
    error: string | null;
};

const EMPTY: Row = {
    runs: 0,
    completed: 0,
    failed: 0,
    blocked: 0,
    wouldBlock: 0,
    flagged: 0,
    settled: 0,
    notDelivered: 0,
    error: null,
};

export type Tally = Map<string, Row>;

export function add(tally: Tally, scenario: string, outcome: Outcome): void {
    const row = tally.get(scenario) ?? EMPTY;
    tally.set(scenario, {
        runs: row.runs + 1,
        completed: row.completed + (outcome.status === "completed" ? 1 : 0),
        failed: row.failed + (outcome.status === "failed" ? 1 : 0),
        blocked: row.blocked + (outcome.blocked ? 1 : 0),
        wouldBlock: row.wouldBlock + (outcome.wouldBlock ? 1 : 0),
        flagged: row.flagged + (outcome.flagged ? 1 : 0),
        settled: row.settled + outcome.settled,
        notDelivered: row.notDelivered + outcome.notDelivered,
        error: row.error ?? outcome.error,
    });
}

const COLUMNS = ["runs", "completed", "failed", "blocked", "wouldBlock", "flagged", "settled", "notDelivered"] as const;

// A plain table, one line per scenario and a total line
export function tallyLines(tally: Tally): string[] {
    const names = [...tally.keys()];
    const width = Math.max(8, ...names.map((name) => name.length));
    const cell = (value: string | number) => String(value).padStart(13);
    const line = (name: string, row: Row) => `${name.padEnd(width)}${COLUMNS.map((c) => cell(row[c])).join("")}`;
    const total = [...tally.values()].reduce(
        (sum, row) => ({ ...sum, ...Object.fromEntries(COLUMNS.map((c) => [c, sum[c] + row[c]])) }),
        EMPTY,
    );
    const errors = names.flatMap((name) => {
        const error = (tally.get(name) as Row).error;
        return error === null ? [] : [`  ${name}: ${error}`];
    });
    return [
        `${"scenario".padEnd(width)}${COLUMNS.map(cell).join("")}`,
        ...names.map((name) => line(name, tally.get(name) as Row)),
        line("total", total),
        ...(errors.length > 0 ? ["First error per scenario:", ...errors] : []),
    ];
}
