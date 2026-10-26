import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { after, IBAN, use, WALLET } from "../../../test/fleet.ts";
import { startTestDb, type TestDb } from "../../../test/pglite.ts";
import { createProject } from "../../projects.ts";
import { fleetFields, listQuarantined, listWatched } from "./dashboard.ts";
import { recordFleetUse } from "./record.ts";
import { markValueKnown, quarantineList } from "./state.ts";

let test: TestDb;

beforeAll(async () => {
    test = await startTestDb();
}, 60_000);

afterAll(async () => {
    await test.stop();
});

// x402 payments to one wallet from runs from..to, a minute apart
async function pay(projectId: string, from: number, to: number) {
    const results = [];
    for (let n = from; n <= to; n += 1) {
        const call = use(n, [WALLET], { tool: "x402" });
        results.push(await recordFleetUse(test.db, projectId, call, after(n / 60)));
    }
    return results;
}

describe("the fleet check with wallets", () => {
    it("watches a new payee, in clear, until its 5th run", async () => {
        const projectId = await createProject(test.db, "Acme");
        await pay(projectId, 1, 4);

        expect(await listWatched(test.db, projectId, after(1))).toEqual([
            expect.objectContaining({
                kind: "wallet",
                field: "payTo",
                key: WALLET.key,
                value: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
                hash: null,
                runs: 4,
            }),
        ]);
        expect(await fleetFields(test.db, projectId)).toEqual(["payTo"]);
        const stored = await test.db
            .selectFrom("fleet_values")
            .select(["key", "kind"])
            .where("project_id", "=", projectId)
            .execute();
        expect(stored).toEqual([{ key: WALLET.key, kind: "wallet" }]);
    });

    it("quarantines a payee a 5th separate run pays, and lists it for the SDKs", async () => {
        const projectId = await createProject(test.db, "Acme");
        const results = await pay(projectId, 1, 5);
        await recordFleetUse(test.db, projectId, use(9, [IBAN]), after(1));

        expect(results[4]).toMatchObject({ added: [{ key: WALLET.key, observe: true }] });
        expect(await quarantineList(test.db, projectId)).toEqual([{ key: WALLET.key, observe: true }]);
        expect(await listQuarantined(test.db, projectId)).toEqual([
            expect.objectContaining({ kind: "wallet", value: WALLET.key.slice(7), hash: null, runs: 5 }),
        ]);
    });

    it("lets a person mark a payee as known", async () => {
        const projectId = await createProject(test.db, "Acme");
        await pay(projectId, 1, 5);

        expect(await markValueKnown(test.db, projectId, WALLET.key, "ops@acme.com")).toBe(true);
        expect(await quarantineList(test.db, projectId)).toEqual([]);
        expect(await pay(projectId, 6, 10)).toSatisfy((all: { added: unknown[] }[]) =>
            all.every((result) => result.added.length === 0),
        );
    });
});
