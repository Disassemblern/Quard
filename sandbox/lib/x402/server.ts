import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeX402, paidOption, type PaymentRequired, type PaymentResponse } from "@quard/shared";
import { NETWORK } from "./wallet.ts";

// Test USDC on Base Sepolia. Quard knows its USD value.
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";

export type PaidApiOptions = {
    // The public origin the app calls, such as https://quotes.example
    origin: string;
    // Price per call in atomic units: 10000 is $0.01 in USDC
    amount: string;
    payTo: string;
    answer: (path: string) => string;
    // Paths that settle the payment, then fail: "paid, not delivered"
    fail?: (path: string) => boolean;
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");

// A stand-in for an x402 facilitator: checks the fake signature and
// "settles" without touching a chain
function stubFacilitator() {
    let settled = 0;
    return {
        verify(payment: unknown): boolean {
            return (payment as { payload?: { signature?: unknown } }).payload?.signature === "0xfake";
        },
        settle(): PaymentResponse {
            settled += 1;
            const transaction = `0x${settled.toString(16).padStart(64, "0")}`;
            return { success: true, transaction, network: NETWORK, payer: PAYER };
        },
    };
}

// A local x402 server for one paid host. The fetch it returns sends
// requests for that host to the local server, so no DNS is needed.
export async function startPaidApi(options: PaidApiOptions) {
    const facilitator = stubFacilitator();
    const price = (path: string, error?: string): PaymentRequired => ({
        x402Version: 2,
        resource: { url: `${options.origin}${path}` },
        accepts: [
            {
                scheme: "exact",
                network: NETWORK,
                amount: options.amount,
                asset: USDC,
                payTo: options.payTo,
                maxTimeoutSeconds: 60,
                extra: { name: "USDC", version: "2" },
            },
        ],
        ...(error ? { error } : {}),
    });
    const askPrice = (res: ServerResponse, path: string, error?: string) => {
        res.writeHead(402, { "content-type": "application/json", "payment-required": encode(price(path, error)) });
        res.end("{}");
    };

    const server = createServer((req, res) => {
        const path = req.url ?? "/";
        const header = req.headers["payment-signature"];
        if (typeof header !== "string") {
            askPrice(res, path);
            return;
        }
        const payment = decodeX402(header);
        if (paidOption(payment, price(path)) === undefined || !facilitator.verify(payment)) {
            askPrice(res, path, "invalid_payment");
            return;
        }
        const settlement = facilitator.settle();
        const failed = options.fail?.(path) === true;
        res.writeHead(failed ? 500 : 200, { "content-type": "text/plain", "payment-response": encode(settlement) });
        res.end(failed ? "Internal error" : options.answer(path));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const fetchApi = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin !== options.origin) {
            throw new Error(`The sandbox can't reach ${url.origin}`);
        }
        return fetch(`${local}${url.pathname}${url.search}`, { method: request.method, headers: request.headers });
    };
    return { fetch: fetchApi, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
