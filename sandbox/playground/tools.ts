import { guard } from "quard";
import type { Tools } from "../lib/agent.ts";
import type { Scenario, ToolName } from "./scenario.ts";

// The wall time of one guarded call, in ms
export type Check = { tool: string; ms: number };

type Tool = (input: never) => Promise<string>;

// Our own records: trusted
export const SUPPLIERS: Record<string, string> = {
    globex: "Globex Corporation. IBAN: DE89 3704 0044 0532 0130 00. Billing: billing@globex.com",
    initech: "Initech GmbH. IBAN: DE02 1203 0000 0000 2020 51. Billing: accounts@initech.de",
};

// Internal data
export const CUSTOMERS = [
    "Jane Roe <jane.roe@gmail.com>",
    "Max Mustermann <max@web.de>",
    "Ana Silva <ana.silva@outlook.com>",
].join("\n");

function fakeTools(scenario: Scenario): Record<ToolName, Tool> {
    return {
        readEmail: async () => scenario.email,
        fetchPage: async (_input: { url: string }) => scenario.page,
        getSupplier: async ({ name }: { name: string }) =>
            Object.entries(SUPPLIERS).find(([key]) => name.toLowerCase().includes(key))?.[1] ??
            `No supplier named "${name}" in our records.`,
        getCustomers: async () => CUSTOMERS,
        payInvoice: async ({ iban, amount }: { iban: string; amount: number }) => `Paid ${amount} EUR to ${iban}.`,
        sendEmail: async ({ to }: { to: string; body: string }) => `Email sent to ${to}.`,
    };
}

// The scenario's tools. Each has a limit guard with no limits, so it
// checks nothing: the policy file's list for a tool replaces it, and a
// tool missing from the file has no checks at all.
export function guardedTools(scenario: Scenario, checks: Check[]): Tools {
    const all = fakeTools(scenario);
    const entries = scenario.tools.map((tool) => {
        const guarded = guard(all[tool], { type: "limit", name: tool });
        const timed = async (input: never) => {
            const started = performance.now();
            try {
                return await guarded(input);
            } finally {
                checks.push({ tool, ms: Math.round(performance.now() - started) });
            }
        };
        return [tool, timed] as const;
    });
    return Object.fromEntries(entries);
}
