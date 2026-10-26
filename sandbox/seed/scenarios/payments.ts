import { between } from "../random.ts";
import type { Scenario } from "./scenario.ts";

export const QUOTES = "https://quotes.example";
export const FORECAST = "https://forecast-pro.example";

const PAIRS = ["eur-usd", "gbp-usd", "usd-jpy", "eur-gbp", "usd-chf"];

// x402 payments to the local paid APIs
export const PAYMENTS: Scenario[] = [
    {
        name: "Paid quote API",
        weight: 10,
        agent: "procurement",
        model: "gpt-6-luna",
        tools: ["fetchPaid"],
        setup: (random) => {
            const urls = PAIRS.slice(0, between(random, 1, PAIRS.length)).map((pair) => `${QUOTES}/rates/${pair}`);
            return {
                prompt: `Get the latest rate for each of these currency pairs from the paid API, one call per URL: ${urls.join(", ")}. Then list the rates.`,
            };
        },
    },
    {
        name: "Paid API fails after payment",
        weight: 2,
        agent: "procurement",
        model: "gpt-6-luna",
        tools: ["fetchPaid"],
        setup: (random) => ({
            prompt: `Download the market report at ${QUOTES}/reports/q${between(random, 1, 4)} from the paid API and summarize it.`,
        }),
    },
    {
        name: "Paid link found in a web page",
        weight: 2,
        agent: "procurement",
        model: "gpt-6-luna",
        tools: ["fetchPage", "fetchPaid"],
        setup: () => ({
            prompt: "Read https://markets.example/today and get the full forecast it links to.",
            pages: {
                "https://markets.example/today": `<h1>Markets today</h1><p>Stocks flat, EUR slightly up.</p><p>Full forecast (paid): ${FORECAST}/full</p>`,
            },
        }),
    },
];
