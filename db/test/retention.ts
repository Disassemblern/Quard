import type { Db } from "../connect/connect.ts";

// The time every retention test runs at. The real clock, so a run made
// days ago is that old for code that reads the clock too.
export const NOW = new Date();

const DAY = 24 * 60 * 60_000;

export function daysBefore(days: number): Date {
    return new Date(NOW.getTime() - days * DAY);
}

let next = 0;

// A fresh hex id of the given length
export function hexId(length: number): string {
    next += 1;
    return next.toString(16).padStart(length, "0");
}

// A run last touched `days` ago, with a step, an event and an agent message
export async function oldRun(db: Db, projectId: string, days: number): Promise<string> {
    const runId = hexId(32);
    const at = daysBefore(days);
    await db
        .insertInto("runs")
        .values({ project_id: projectId, run_id: runId, agent: "billing", started_at: at, last_event_at: at })
        .execute();
    const row = { project_id: projectId, run_id: runId, agent: "billing", at };
    await db
        .insertInto("steps")
        .values({ ...row, step_id: hexId(16), kind: "tool_call", name: "payInvoice", status: "ok" })
        .execute();
    await db
        .insertInto("events")
        .values({ ...row, event_id: hexId(16), type: "tool_call", body: "{}" })
        .execute();
    await db
        .insertInto("agent_messages")
        .values({
            project_id: projectId,
            run_id: runId,
            event_id: hexId(16),
            step_id: hexId(16),
            kind: "message",
            from_agent: "planner",
            to_agent: "billing",
            trust: "trusted",
            sensitivity: "internal",
            at,
        })
        .execute();
    return runId;
}

// An incident on the run, opened `days` ago
export async function incidentOn(db: Db, projectId: string, runId: string, days: number, leasedUntil?: Date) {
    await db
        .insertInto("incidents")
        .values({
            project_id: projectId,
            id: `inc_${hexId(16)}`,
            run_id: runId,
            opened_at: daysBefore(days),
            leased_until: leasedUntil ?? null,
        })
        .execute();
}

// How many rows of the run are left in each table it cascades to
export async function runRows(db: Db, projectId: string, runId: string): Promise<number[]> {
    const tables = ["runs", "steps", "events", "agent_messages", "incidents"] as const;
    return Promise.all(
        tables.map(async (table) => {
            const row = await db
                .selectFrom(table)
                .select((eb) => eb.fn.countAll<string>().as("n"))
                .where("project_id", "=", projectId)
                .where("run_id", "=", runId)
                .executeTakeFirstOrThrow();
            return Number(row.n);
        }),
    );
}
