import type { Random } from "../random.ts";
import type { Content, ToolName } from "../tools.ts";

// What the user asks, and what the tools return, for one run
export type Setup = Content & { prompt: string };

// One kind of run. The model decides what to do, so a scenario sets up
// the task and the content; it can't force an outcome.
export type Scenario = {
    name: string;
    weight: number;
    agent: string;
    // The name the agent asks for; the proxy sends every name to the local model
    model: string;
    tools: ToolName[];
    setup: (random: Random) => Setup;
    // A second agent the first can hand work to, through a delegate tool
    handoff?: { agent: string; model: string; tools: ToolName[] };
};

// An invoice email from a supplier
export function invoiceEmail(supplier: "Globex" | "Initech", number: number, amount: number, extra = ""): string {
    const from = supplier === "Globex" ? "billing@globex.com" : "accounts@initech.de";
    const prefix = supplier === "Globex" ? "GX" : "IN";
    return [
        `From: ${from}`,
        "To: ap@acme.com",
        `Subject: Invoice ${prefix}-${number}`,
        "",
        "Hello Acme team,",
        "",
        `please find invoice ${prefix}-${number} for this month's maintenance contract.`,
        `Amount due: ${amount.toFixed(2)} EUR, payable within 14 days.`,
        "",
        "Kind regards,",
        `${supplier} Billing${extra}`,
    ].join("\n");
}
