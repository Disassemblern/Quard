import { hostname } from "node:os";
import { helloMessage } from "@quard/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGuardedTool } from "../../context/registry.ts";
import { dayUsed, utcDay } from "../../guards/limit/daily.ts";
import { rememberVersion, type AgentVersion } from "../../monitor/versions.ts";
import { rulesSnapshot } from "../../policy/rules.ts";
import { fakeSockets, READY, sentOf } from "../../test/fake-socket.ts";
import { resetAll } from "../../test/reset.ts";
import { createControl } from "./control.ts";
import { SDK_VERSION } from "./version.ts";

const VERSION: AgentVersion = {
    agent: "billing",
    version: "f".repeat(16),
    model: "gpt-test",
    tools: ["payInvoice", "", "x".repeat(201)],
    instructions: "Mail jane@acme.com before paying.",
};

function setup() {
    const fake = fakeSockets();
    const control = createControl({
        url: "ws://control.test/v1/connect",
        key: "qk_live_k",
        open: fake.open,
    });
    return { fake, control };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    resetAll();
    vi.useRealTimers();
});

describe("createControl", () => {
    it("connects at once and says hello with the SDK version, host, pid and rules", () => {
        registerGuardedTool("payInvoice", [{ type: "approval" }]);
        const { fake } = setup();
        const socket = fake.last();

        socket.accept();

        const [hello] = socket.sent;
        expect([socket.url, socket.key]).toEqual(["ws://control.test/v1/connect", "qk_live_k"]);
        expect(helloMessage.safeParse(hello).success).toBe(true);
        expect(hello).toEqual({
            type: "hello",
            sdk: SDK_VERSION,
            host: hostname().slice(0, 255),
            pid: process.pid,
            rules: rulesSnapshot(),
        });
    });

    it("takes today's counts from ready and sends the agent versions it knows, redacted", () => {
        const { fake } = setup();
        rememberVersion(VERSION);
        rememberVersion({ ...VERSION, agent: "support", instructions: undefined });

        const socket = fake.connect({
            ...READY,
            counters: [{ tool: "payInvoice", counter: "calls", day: utcDay(), used: 4 }],
        });

        expect(dayUsed(utcDay(), "payInvoice", "calls")).toBe(4);
        expect(sentOf(socket, "agent")).toEqual([
            {
                type: "agent",
                agent: "billing",
                version: VERSION.version,
                model: "gpt-test",
                tools: ["payInvoice"],
                instructions: "Mail j…@acme.com before paying.",
            },
            { type: "agent", agent: "support", version: VERSION.version, model: "gpt-test", tools: ["payInvoice"] },
        ]);
    });

    it("sends a new agent version while connected, and none before", () => {
        const { fake, control } = setup();
        control.sendAgent(VERSION);
        const socket = fake.connect();

        control.sendAgent({ ...VERSION, version: "e".repeat(16) });

        expect(sentOf(socket, "agent").map((message) => message.version)).toEqual(["e".repeat(16)]);
    });

    it("sends the rules only when they changed since control last saw them", () => {
        registerGuardedTool("payInvoice", [{ type: "approval" }]);
        const { fake, control } = setup();
        control.syncRules();
        const socket = fake.connect();

        control.syncRules();
        registerGuardedTool("sendEmail", [{ type: "egress" }]);
        control.syncRules();
        control.syncRules();

        expect(sentOf(socket, "rules")).toEqual([{ type: "rules", rules: rulesSnapshot() }]);
    });

    it("says hello with the newest rules after a reconnect, so they need no resend", () => {
        const { fake, control } = setup();
        fake.connect().drop();
        registerGuardedTool("payInvoice", [{ type: "approval" }]);
        vi.advanceTimersByTime(1000);

        const socket = fake.connect();
        control.syncRules();

        expect(sentOf(socket, "hello")[0]?.rules).toEqual(rulesSnapshot());
        expect(sentOf(socket, "rules")).toEqual([]);
    });

    it("closes the link and settles every waiting call when it stops", async () => {
        const { fake, control } = setup();
        const socket = fake.connect();
        const message = {
            type: "ask" as const,
            askId: "c".repeat(16),
            runId: "a".repeat(32),
            stepId: "b".repeat(16),
            agent: "billing",
            tool: "payInvoice",
            argsHash: "d".repeat(32),
            args: {},
            labels: [],
            context: { trust: "trusted" as const, sensitivity: "internal" as const, origins: [], flagged: false },
            reasons: [{ guard: "approval", rule: "approval", reason: "approval_required" as const }],
        };
        const ask = control.approvals.ask({ askId: message.askId, message: () => message }, undefined);
        const count = control.requests.request(
            {
                type: "count",
                id: "1".repeat(16),
                tool: "pay",
                day: "2026-10-03",
                counts: [{ counter: "calls", add: 1 }],
            },
            { ms: 5000 },
        );

        control.stop();

        expect(socket.closed).toBe(true);
        expect(await ask).toEqual({ kind: "down" });
        expect(await count).toBeUndefined();
        expect(control.replyMs).toBe(5000);
    });
});
