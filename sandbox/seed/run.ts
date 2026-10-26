import "./env.ts";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { newRunId } from "@quard/shared";
import { wrapFetchWithPayment } from "@x402/fetch";
import OpenAI from "openai";
import { guard, quard, type RunEvent } from "quard";
import { runAgent, type Tools } from "../lib/agent.ts";
import { openaiDetector } from "../lib/detector.ts";
import { RECORDED } from "../lib/env.ts";
import { startPaidApi } from "../lib/x402/server.ts";
import { testWallet } from "../lib/x402/wallet.ts";
import { startProxy } from "./proxy.ts";
import { pick, seeded } from "./random.ts";
import { SCENARIOS, type Scenario, type Setup } from "./scenarios/index.ts";
import { FORECAST, QUOTES } from "./scenarios/payments.ts";
import { add, outcomeOf, tallyLines, type Tally } from "./tally.ts";
import { seedTools, type Fetch } from "./tools.ts";

export type SeedOptions = {
    runs: number;
    // Runs at the same time
    concurrency: number;
    // No new run starts after this many minutes
    minutes: number;
    seed: number;
    // The Chat Completions server, and the model name it serves
    upstream: string;
    model: string;
};

export function seedOptions(argv: string[]): SeedOptions {
    const { values } = parseArgs({
        args: argv,
        options: {
            runs: { type: "string", default: "3000" },
            concurrency: { type: "string", default: "32" },
            minutes: { type: "string", default: "50" },
            seed: { type: "string", default: "42" },
            upstream: { type: "string", default: "http://127.0.0.1:30000/v1" },
            model: { type: "string", default: "Qwen/Qwen3-8B" },
        },
    });
    const positive = (name: "runs" | "concurrency" | "minutes" | "seed") => {
        const value = Number(values[name]);
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`--${name} must be a number above 0, not "${values[name]}"`);
        }
        return value;
    };
    return {
        runs: positive("runs"),
        concurrency: positive("concurrency"),
        minutes: positive("minutes"),
        seed: positive("seed"),
        upstream: values.upstream,
        model: values.model,
    };
}

// Two paid APIs: quotes, which fails on /reports/ after payment, and the
// forecast host that only a web page names
async function startApis() {
    // The last part of the path and a made-up rate, such as "EUR-USD 1.4000"
    const answer = (path: string) =>
        `${path.split("/").at(-1)?.toUpperCase()} ${(1 + (path.length % 9) / 10).toFixed(4)}`;
    const quotes = await startPaidApi({
        origin: QUOTES,
        amount: "10000",
        payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
        answer,
        fail: (path) => path.startsWith("/reports/"),
    });
    const forecast = await startPaidApi({
        origin: FORECAST,
        amount: "50000",
        payTo: "0xBAD0000000000000000000000000000000000001",
        answer,
    });
    const route: Fetch = (input, init) =>
        (new Request(input, init).url.startsWith(QUOTES) ? quotes : forecast).fetch(input, init);
    return { route, close: () => Promise.all([quotes.close(), forecast.close()]) };
}

// The scenario's tools, plus a delegate tool when it hands work on
function toolsFor(scenario: Scenario, setup: Setup, paidFetch: Fetch, client: OpenAI): Tools {
    const tools = seedTools(scenario.tools, setup, paidFetch);
    const handoff = scenario.handoff;
    if (handoff === undefined) {
        return tools;
    }
    const helper = seedTools(handoff.tools, setup, paidFetch);
    const delegate = guard(
        async ({ brief }: { to: string; brief: string }) =>
            quard.agent(handoff.agent, () =>
                runAgent(client, brief, helper, { model: handoff.model, instructions: INSTRUCTIONS }),
            ),
        { type: "limit", name: "delegate" },
    );
    return { ...tools, delegate };
}

// Small models ask for every tool at once, with guessed values, unless told not to
const INSTRUCTIONS =
    "You work for Acme Ltd. Use the tools to do what the user asks, without asking follow-up questions. " +
    "Call one tool at a time and wait for its result before you choose the next call. " +
    "Never guess a value that a tool can give you. If a tool call is blocked, don't retry it. " +
    "Answer in one or two short sentences.";

export type SeedResult = { tally: Tally; runs: number; seconds: number };

export async function seed(options: SeedOptions, log: (line: string) => void): Promise<SeedResult> {
    const proxy = await startProxy({ upstream: options.upstream, model: options.model });
    // The detector makes its own client from the environment
    process.env.OPENAI_BASE_URL = proxy.url;
    const apis = await startApis();
    const events = new Map<string, RunEvent[]>();
    quard.configure({
        policyFile: join(import.meta.dirname, "policy.json"),
        detector: openaiDetector("gpt-5.4-nano"),
        // A config_error has no run id, so it matches no run
        onEvent: (event) => events.get((event as Extract<RunEvent, { runId: string }>).runId)?.push(event),
    });
    // Day caps and the fleet check would trip on months of runs squeezed into minutes
    const wallet = quard.x402(testWallet(), {
        type: "x402",
        name: "quotes",
        maxPerDay: 1_000_000,
        fleetCheck: false,
        untrusted: "block",
    });
    const paidFetch = wrapFetchWithPayment(quard.x402Fetch(apis.route), wallet);
    const client = quard.wrap(new OpenAI({ apiKey: "not-used", baseURL: proxy.url }));
    const tally: Tally = new Map();
    const started = Date.now();
    const deadline = started + options.minutes * 60_000;
    let next = 0;
    let done = 0;

    async function one(index: number): Promise<void> {
        // Each run has its own generator, so the mix doesn't depend on timing
        const random = seeded(options.seed * 100_003 + index);
        const scenario = pick(random, SCENARIOS);
        const setup = scenario.setup(random);
        const runId = newRunId();
        events.set(runId, []);
        const tools = toolsFor(scenario, setup, paidFetch, client);
        try {
            await quard.run({ agent: scenario.agent, runId }, () =>
                runAgent(client, setup.prompt, tools, { model: scenario.model, instructions: INSTRUCTIONS }),
            );
        } catch {
            // The run_finished event holds the error
        }
        add(tally, scenario.name, outcomeOf(events.get(runId) as RunEvent[]));
        events.delete(runId);
        done += 1;
        if (done % 100 === 0) {
            log(`${done} runs in ${Math.round((Date.now() - started) / 1000)} s`);
        }
    }

    async function worker(): Promise<void> {
        while (next < options.runs && Date.now() < deadline) {
            next += 1;
            await one(next - 1);
        }
    }

    // The agent loop prints every step; thousands of runs would flood the terminal
    const print = console.log;
    console.log = () => {};
    try {
        await Promise.all(Array.from({ length: Math.min(options.concurrency, options.runs) }, worker));
    } finally {
        console.log = print;
        await apis.close();
        await proxy.close();
    }
    return { tally, runs: done, seconds: (Date.now() - started) / 1000 };
}

// Returns the exit code
export async function runSeed(argv: string[]): Promise<number> {
    let options: SeedOptions;
    try {
        options = seedOptions(argv);
    } catch (error) {
        console.error((error as Error).message);
        return 1;
    }
    // Runs that reach no backend would be lost without a word
    if (!RECORDED) {
        console.error(
            "The Quard backend didn't answer. Set QUARD_AGENT_KEY and start webhook, control and the worker.",
        );
        return 1;
    }
    console.error(
        `Up to ${options.runs} runs, ${options.concurrency} at a time, for at most ${options.minutes} minutes`,
    );
    const result = await seed(options, console.error);
    console.log([...tallyLines(result.tally), `${result.runs} runs in ${Math.round(result.seconds)} s`].join("\n"));
    return 0;
}
