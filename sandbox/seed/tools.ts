import { guard } from "quard";
import type { Tools } from "../lib/agent.ts";
import { CUSTOMERS, SUPPLIERS } from "../playground/tools.ts";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ToolName =
    "readEmail" | "fetchPage" | "getSupplier" | "getCustomers" | "payInvoice" | "sendEmail" | "fetchPaid";

// What one run's tools return
export type Content = { email?: string; pages?: Record<string, string> };

type Tool = (input: never) => Promise<string>;

// A page by its URL. With one page, any URL gets it, since a model may
// change a URL a little.
function pageAt(pages: Record<string, string>, url: string): string {
    const all = Object.values(pages);
    return (
        pages[url] ??
        pages[url.replace(/\/$/, "")] ??
        (all.length === 1 ? (all[0] as string) : `404: no page at ${url}`)
    );
}

// The tool error the model reads in place of a result
async function paid(fetchPaid: Fetch, url: string): Promise<string> {
    try {
        const response = await fetchPaid(url);
        const text = await response.text();
        return response.ok ? text : `The API answered ${response.status}: ${text}`;
    } catch (error) {
        return (error as Error).message;
    }
}

function plainTools(content: Content, fetchPaid: Fetch): Record<ToolName, Tool> {
    return {
        readEmail: async () => content.email ?? "The inbox is empty.",
        fetchPage: async ({ url }: { url: string }) => pageAt(content.pages ?? {}, url),
        getSupplier: async ({ name }: { name: string }) =>
            Object.entries(SUPPLIERS).find(([key]) => name.toLowerCase().includes(key))?.[1] ??
            `No supplier named "${name}" in our records.`,
        getCustomers: async () => CUSTOMERS,
        payInvoice: async ({ iban, amount }: { iban: string; amount: number }) => `Paid ${amount} EUR to ${iban}.`,
        sendEmail: async ({ to }: { to: string; body: string }) => `Email sent to ${to}.`,
        fetchPaid: async ({ url }: { url: string }) => paid(fetchPaid, url),
    };
}

// The named tools, each in a limit guard with no limits. The policy
// file's list for a tool replaces it, as in the playground.
export function seedTools(names: readonly ToolName[], content: Content, fetchPaid: Fetch): Tools {
    const all = plainTools(content, fetchPaid);
    return Object.fromEntries(names.map((name) => [name, guard(all[name], { type: "limit", name })]));
}
