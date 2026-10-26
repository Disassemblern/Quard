import { quard } from "quard";
import { describe, expect, it } from "vitest";
import type { Tools } from "../lib/agent.ts";
import { seedTools, type Fetch, type ToolName } from "./tools.ts";

const ALL: ToolName[] = [
    "readEmail",
    "fetchPage",
    "getSupplier",
    "getCustomers",
    "payInvoice",
    "sendEmail",
    "fetchPaid",
];

// Guarded tools run inside a run, as the agent loop calls them
function call(tools: Tools, name: string, input: object = {}): Promise<unknown> {
    return quard.run({ agent: "test" }, () => (tools[name] as (input: object) => Promise<unknown>)(input));
}

const noPaid: Fetch = async () => new Response("unused");

describe("seedTools", () => {
    it("builds only the named tools", () => {
        expect(Object.keys(seedTools(["readEmail", "payInvoice"], {}, noPaid))).toEqual(["readEmail", "payInvoice"]);
    });

    it("returns the run's email, or an empty inbox", async () => {
        expect(await call(seedTools(ALL, { email: "Hello" }, noPaid), "readEmail")).toBe("Hello");
        expect(await call(seedTools(ALL, {}, noPaid), "readEmail")).toBe("The inbox is empty.");
    });

    it("finds a page by its URL, with or without a trailing slash", async () => {
        const tools = seedTools(ALL, { pages: { "https://a.example": "A", "https://b.example": "B" } }, noPaid);
        expect(await call(tools, "fetchPage", { url: "https://b.example" })).toBe("B");
        expect(await call(tools, "fetchPage", { url: "https://a.example/" })).toBe("A");
        expect(await call(tools, "fetchPage", { url: "https://c.example" })).toBe("404: no page at https://c.example");
    });

    it("gives the only page for any URL, and a 404 with no pages", async () => {
        const one = seedTools(ALL, { pages: { "https://a.example/about": "About" } }, noPaid);
        expect(await call(one, "fetchPage", { url: "https://a.example/About-us" })).toBe("About");
        expect(await call(seedTools(ALL, {}, noPaid), "fetchPage", { url: "https://x.example" })).toBe(
            "404: no page at https://x.example",
        );
    });

    it("looks suppliers up in our records, and answers the other tools", async () => {
        const tools = seedTools(ALL, {}, noPaid);
        expect(await call(tools, "getSupplier", { name: "Globex Corp" })).toContain("DE89 3704 0044 0532 0130 00");
        expect(await call(tools, "getSupplier", { name: "Umbrella" })).toBe(
            'No supplier named "Umbrella" in our records.',
        );
        expect(await call(tools, "getCustomers")).toContain("Jane Roe");
        expect(await call(tools, "payInvoice", { iban: "DE89", amount: 10 })).toBe("Paid 10 EUR to DE89.");
        expect(await call(tools, "sendEmail", { to: "a@acme.com", body: "Hi" })).toBe("Email sent to a@acme.com.");
    });

    it("returns a paid API's answer, its error status, or the refusal it throws", async () => {
        const ok = seedTools(ALL, {}, async () => new Response("EUR-USD 1.08"));
        expect(await call(ok, "fetchPaid", { url: "https://quotes.example/rates/eur-usd" })).toBe("EUR-USD 1.08");
        const failed = seedTools(ALL, {}, async () => new Response("Internal error", { status: 500 }));
        expect(await call(failed, "fetchPaid", { url: "https://quotes.example/x" })).toBe(
            "The API answered 500: Internal error",
        );
        const refused = seedTools(ALL, {}, async () => {
            throw new Error("Blocked by the x402 guard");
        });
        expect(await call(refused, "fetchPaid", { url: "https://evil.example" })).toBe("Blocked by the x402 guard");
    });
});
