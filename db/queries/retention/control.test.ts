import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../../test/pglite.ts";
import { daysBefore, hexId, NOW } from "../../test/retention.ts";
import { createAgentKey } from "../keys.ts";
import { createProject } from "../projects.ts";
import {
    deleteConnections,
    deleteDayCounters,
    deleteFleetUses,
    deleteFleetValues,
    deleteRevokedGrants,
} from "./control.ts";
import { daysAgo } from "./policy.ts";
import type { Sweep } from "./sweep.ts";

let test: TestDb;

beforeAll(async () => {
    test = await startTestDb();
}, 60_000);

afterAll(async () => {
    await test.stop();
});

async function sweepOf(): Promise<Sweep> {
    const projectId = await createProject(test.db, "Acme");
    return { db: test.db, projectId, now: NOW, runCutoff: daysAgo(NOW, 30), stopped: () => false };
}

describe("deleteDayCounters", () => {
    it("keeps today and the two days before", async () => {
        const sweep = await sweepOf();
        // The UTC day `n` days before NOW
        const dayBefore = (n: number) => daysBefore(n).toISOString().slice(0, 10);
        const days = [dayBefore(0), dayBefore(2), dayBefore(3), dayBefore(33)];
        await test.db
            .insertInto("day_counters")
            .values(days.map((day) => ({ project_id: sweep.projectId, day, tool: "payInvoice", counter: "calls" })))
            .execute();

        expect(await deleteDayCounters(sweep)).toBe(2);
        const left = await test.db
            .selectFrom("day_counters")
            .select(sql<string>`day::text`.as("day"))
            .where("project_id", "=", sweep.projectId)
            .orderBy("day")
            .execute();
        expect(left.map((row) => row.day)).toEqual([dayBefore(2), dayBefore(0)]);
    });
});

// A watched value first seen `days` ago, with a use for each age in `uses`
async function watched(sweep: Sweep, days: number, uses: number[], quarantined = false): Promise<string> {
    const key = `domain:${hexId(8)}.example`;
    await test.db
        .insertInto("fleet_values")
        .values({
            project_id: sweep.projectId,
            key,
            kind: "domain",
            field: "url",
            first_seen_at: daysBefore(days),
            quarantined_at: quarantined ? daysBefore(days) : null,
        })
        .execute();
    for (const age of uses) {
        await test.db
            .insertInto("fleet_uses")
            .values({
                project_id: sweep.projectId,
                key,
                run_id: hexId(32),
                agent: "billing",
                tool: "fetch",
                blocked: false,
                at: daysBefore(age),
            })
            .execute();
    }
    return key;
}

async function usesOf(sweep: Sweep, key: string): Promise<number> {
    const rows = await test.db
        .selectFrom("fleet_uses")
        .select("id")
        .where("project_id", "=", sweep.projectId)
        .where("key", "=", key)
        .execute();
    return rows.length;
}

describe("deleteFleetUses", () => {
    it("deletes old uses but keeps each value's newest one and a quarantined value's uses", async () => {
        const sweep = await sweepOf();
        const busy = await watched(sweep, 100, [90, 60, 40, 5]);
        const idle = await watched(sweep, 100, [90, 60]);
        const held = await watched(sweep, 100, [90, 60], true);

        expect(await deleteFleetUses(sweep)).toBe(4);
        expect(await usesOf(sweep, busy)).toBe(1);
        expect(await usesOf(sweep, idle)).toBe(1);
        expect(await usesOf(sweep, held)).toBe(2);
    });
});

describe("deleteFleetValues", () => {
    it("forgets values not seen for a year, unless they wait in quarantine", async () => {
        const sweep = await sweepOf();
        const forgotten = await watched(sweep, 400, [380]);
        const neverUsed = await watched(sweep, 400, []);
        await watched(sweep, 400, [300]);
        await watched(sweep, 200, []);
        await watched(sweep, 400, [380], true);

        expect(await deleteFleetValues(sweep)).toBe(2);
        const left = await test.db
            .selectFrom("fleet_values")
            .select("key")
            .where("project_id", "=", sweep.projectId)
            .execute();
        expect(left.map((row) => row.key)).not.toContain(forgotten);
        expect(left.map((row) => row.key)).not.toContain(neverUsed);
        expect(left).toHaveLength(3);
        expect(await usesOf(sweep, forgotten)).toBe(0);
    });
});

describe("deleteConnections", () => {
    it("deletes connections closed more than 30 days ago", async () => {
        const sweep = await sweepOf();
        const key = await createAgentKey(test.db, sweep.projectId, "billing");
        const connection = (closedDays: number | null) => ({
            project_id: sweep.projectId,
            id: `con_${hexId(16)}`,
            key_id: key.id,
            sdk: "@quard/sdk 0.1.0",
            host: "billing-1",
            pid: 42,
            connected_at: daysBefore(60),
            disconnected_at: closedDays === null ? null : daysBefore(closedDays),
        });
        await test.db
            .insertInto("sdk_connections")
            .values([connection(31), connection(29), connection(null)])
            .execute();

        expect(await deleteConnections(sweep)).toBe(1);
    });
});

describe("deleteRevokedGrants", () => {
    it("deletes grants revoked longer ago than the project's days, never active ones", async () => {
        const sweep = await sweepOf();
        const grant = (revokedDays: number | null) => ({
            project_id: sweep.projectId,
            id: `grt_${hexId(16)}`,
            request_id: `apr_${hexId(16)}`,
            agent: "billing",
            tool: "payInvoice",
            args_hash: hexId(32),
            masked: "{}",
            approved_by: "ana@example.com",
            approved_at: daysBefore(400),
            revoked_at: revokedDays === null ? null : daysBefore(revokedDays),
            revoked_by: revokedDays === null ? null : "ana@example.com",
        });
        await test.db
            .insertInto("approval_grants")
            .values([grant(31), grant(10), grant(null)])
            .execute();

        expect(await deleteRevokedGrants(sweep)).toBe(1);
    });
});
