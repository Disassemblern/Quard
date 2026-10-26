import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type ChatMessage = { role: string; content?: string | null; tool_calls?: unknown[]; tool_call_id?: string };

export type ChatBody = {
    model?: string;
    messages: ChatMessage[];
    tools?: Array<{ function: { name: string } }>;
};

// One answer: tool calls, a text, an error status, or a raw body
export type ChatReply = {
    calls?: Array<{ name: string; args: object }>;
    text?: string;
    status?: number;
    raw?: string;
};

// A fake Chat Completions server for tests; respond picks each answer
export async function startFakeChat(respond: (body: ChatBody) => ChatReply) {
    const bodies: ChatBody[] = [];
    let counter = 0;
    const server = createServer(async (request, response) => {
        let text = "";
        for await (const chunk of request) {
            text += String(chunk);
        }
        const body = JSON.parse(text) as ChatBody;
        bodies.push(body);
        const reply = respond(body);
        counter += 1;
        if (reply.raw !== undefined || reply.status !== undefined) {
            const error = JSON.stringify({ error: { message: reply.text ?? "failed" } });
            response.writeHead(reply.status ?? 200, { "content-type": "application/json" }).end(reply.raw ?? error);
            return;
        }
        const calls = (reply.calls ?? []).map((call, i) => ({
            id: `call_${counter}_${i}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
        }));
        const message =
            calls.length > 0
                ? { role: "assistant", content: reply.text ?? null, tool_calls: calls }
                : { role: "assistant", content: reply.text ?? "" };
        const usage = { prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 40 } };
        response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ id: `chat_${counter}`, model: body.model, choices: [{ index: 0, message }], usage }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        bodies,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
