import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

// A Responses API in front of a Chat Completions server such as SGLang.
// Quard records only Responses API calls, so the agents speak that, and
// this turns each call into a chat request for the local model.

type Json = Record<string, unknown>;

export type ProxyOptions = {
    // The chat server's base URL, such as http://127.0.0.1:30000/v1
    upstream: string;
    // The model name the chat server serves
    model: string;
    port?: number;
    // Conversations kept for previous_response_id. Old ones go first.
    keep?: number;
};

const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

function textOf(content: unknown): string {
    return typeof content === "string"
        ? content
        : list(content)
              .map((part) => String(part.text ?? ""))
              .join("");
}

// One Responses input item, added to the chat messages
function addItem(messages: Json[], item: Json): Json[] {
    if (item.type === "function_call") {
        const call = { id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } };
        const last = messages.at(-1);
        // Calls asked for in one turn belong to one assistant message
        if (last?.role === "assistant" && Array.isArray(last.tool_calls)) {
            return [...messages.slice(0, -1), { ...last, tool_calls: [...last.tool_calls, call] }];
        }
        return [...messages, { role: "assistant", content: null, tool_calls: [call] }];
    }
    if (item.type === "function_call_output") {
        return [...messages, { role: "tool", tool_call_id: item.call_id, content: String(item.output) }];
    }
    const role = item.role === "developer" ? "system" : item.role;
    return [...messages, { role, content: textOf(item.content) }];
}

// The chat request, and the conversation so far without the system prompt
export function chatRequest(body: Json, history: Json[], model: string): { request: Json; conversation: Json[] } {
    const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : list(body.input);
    const conversation = input.reduce(addItem, history);
    const system = typeof body.instructions === "string" ? [{ role: "system", content: body.instructions }] : [];
    const tools = list(body.tools)
        .filter((tool) => tool.type === "function")
        .map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        }));
    const request = {
        model,
        messages: [...system, ...conversation],
        ...(tools.length > 0 ? { tools } : {}),
        // Qwen3 thinks before it answers unless told not to
        chat_template_kwargs: { enable_thinking: false },
    };
    return { request, conversation };
}

// The chat answer as a Responses API response, under the model name the agent asked for
// The first choice's message, or an empty one
function messageOf(chat: Json): Json {
    return (list(chat.choices)[0]?.message ?? {}) as Json;
}

export function responsesBody(chat: Json, model: string, id: string): Json {
    const message = messageOf(chat);
    const calls = list(message.tool_calls).map((call, i) => {
        const fn = call.function as Json;
        return {
            type: "function_call",
            id: `fc_${id}_${i}`,
            call_id: String(call.id ?? `call_${id}_${i}`),
            name: String(fn.name),
            arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
            status: "completed",
        };
    });
    const said = typeof message.content === "string" ? message.content : "";
    const text = said === "" ? [] : [{ type: "output_text", text: said, annotations: [] }];
    const output = [
        ...(text.length > 0
            ? [{ type: "message", id: `msg_${id}`, status: "completed", role: "assistant", content: text }]
            : []),
        ...calls,
    ];
    const usage = (chat.usage ?? {}) as Json;
    const input = Number(usage.prompt_tokens ?? 0);
    const outputTokens = Number(usage.completion_tokens ?? 0);
    const cached = Number(((usage.prompt_tokens_details ?? {}) as Json).cached_tokens ?? 0);
    return {
        id,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model,
        output,
        parallel_tool_calls: true,
        tool_choice: "auto",
        tools: [],
        usage: {
            input_tokens: input,
            output_tokens: outputTokens,
            total_tokens: input + outputTokens,
            input_tokens_details: { cached_tokens: cached },
            output_tokens_details: { reasoning_tokens: 0 },
        },
    };
}

async function readBody(request: IncomingMessage): Promise<string> {
    let text = "";
    for await (const chunk of request) {
        text += String(chunk);
    }
    return text;
}

function send(response: ServerResponse, status: number, body: Json): void {
    response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const failure = (message: string) => ({ error: { message, type: "upstream_error" } });

export async function startProxy({ upstream, model, port = 0, keep = 10_000 }: ProxyOptions) {
    const kept = new Map<string, Json[]>();
    let count = 0;

    async function answer(body: Json, response: ServerResponse): Promise<void> {
        const previous = typeof body.previous_response_id === "string" ? body.previous_response_id : undefined;
        const history = previous === undefined ? [] : kept.get(previous);
        if (history === undefined) {
            send(response, 400, failure(`Unknown previous_response_id: ${previous}`));
            return;
        }
        const { request, conversation } = chatRequest(body, history, model);
        let reply: Response;
        try {
            reply = await fetch(`${upstream}/chat/completions`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(request),
            });
        } catch (error) {
            send(response, 502, failure(`The model server is unreachable: ${(error as Error).message}`));
            return;
        }
        const text = await reply.text();
        if (!reply.ok) {
            send(response, reply.status, failure(`The model server answered ${reply.status}: ${text.slice(0, 500)}`));
            return;
        }
        const chat = JSON.parse(text) as Json;
        count += 1;
        const id = `resp_${count}`;
        const out = responsesBody(chat, String(body.model ?? model), id);
        const message = messageOf(chat);
        // Only an answer with tool calls gets a next turn
        if (list(message.tool_calls).length > 0) {
            kept.set(id, [
                ...conversation,
                { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls },
            ]);
            if (kept.size > keep) {
                kept.delete(kept.keys().next().value as string);
            }
        }
        if (previous !== undefined) {
            kept.delete(previous);
        }
        send(response, 200, out);
    }

    const server = createServer(async (request, response) => {
        if (request.method !== "POST" || !request.url?.endsWith("/responses")) {
            send(response, 404, failure(`Only POST /v1/responses is served, not ${request.method} ${request.url}`));
            return;
        }
        try {
            await answer(JSON.parse(await readBody(request)) as Json, response);
        } catch (error) {
            // One bad request or answer must not stop the proxy and every run with it
            send(response, 500, failure(`The proxy failed: ${(error as Error).message}`));
        }
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        // Conversations waiting for their next turn
        kept: () => kept.size,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
