import OpenAI from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeChat, type ChatBody, type ChatReply } from "../test/fake-chat.ts";
import { chatRequest, responsesBody, startProxy } from "./proxy.ts";

const READ_EMAIL = { type: "function", name: "readEmail", description: "Read", parameters: { type: "object" } };

describe("chatRequest", () => {
    it("turns instructions, a text input and function tools into a chat request", () => {
        const body = {
            model: "gpt-5.4-mini",
            instructions: "Be brief.",
            input: "Hi",
            tools: [READ_EMAIL, { type: "web_search" }],
        };
        const { request, conversation } = chatRequest(body, [], "qwen");
        expect(request).toEqual({
            model: "qwen",
            messages: [
                { role: "system", content: "Be brief." },
                { role: "user", content: "Hi" },
            ],
            tools: [
                {
                    type: "function",
                    function: { name: "readEmail", description: "Read", parameters: { type: "object" } },
                },
            ],
            chat_template_kwargs: { enable_thinking: false },
        });
        // The system prompt comes again with each call, so it isn't kept
        expect(conversation).toEqual([{ role: "user", content: "Hi" }]);
    });

    it("puts the calls of one turn in one assistant message, and results in tool messages", () => {
        const input = [
            {
                type: "message",
                role: "developer",
                content: [{ type: "input_text", text: "Rules" }, { type: "input_text" }],
            },
            { type: "function_call", call_id: "c1", name: "readEmail", arguments: "{}" },
            { type: "function_call", call_id: "c2", name: "getSupplier", arguments: '{"name":"Globex"}' },
            { type: "function_call_output", call_id: "c1", output: "Invoice" },
            { role: "user", content: "Thanks" },
        ];
        const { request } = chatRequest({ input }, [{ role: "user", content: "Pay it" }], "qwen");
        expect(request.messages).toEqual([
            { role: "user", content: "Pay it" },
            { role: "system", content: "Rules" },
            {
                role: "assistant",
                content: null,
                tool_calls: [
                    { id: "c1", type: "function", function: { name: "readEmail", arguments: "{}" } },
                    { id: "c2", type: "function", function: { name: "getSupplier", arguments: '{"name":"Globex"}' } },
                ],
            },
            { role: "tool", tool_call_id: "c1", content: "Invoice" },
            { role: "user", content: "Thanks" },
        ]);
        expect("tools" in request).toBe(false);
    });
});

describe("responsesBody", () => {
    it("turns tool calls and usage into Responses output under the asked-for model", () => {
        const chat = {
            choices: [
                {
                    message: {
                        content: null,
                        tool_calls: [
                            { id: "x1", function: { name: "readEmail", arguments: "{}" } },
                            { function: { name: "payInvoice", arguments: { iban: "DE89" } } },
                        ],
                    },
                },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } },
        };
        const body = responsesBody(chat, "gpt-5.4-mini", "resp_1");
        expect(body).toMatchObject({
            id: "resp_1",
            model: "gpt-5.4-mini",
            output: [
                { type: "function_call", call_id: "x1", name: "readEmail", arguments: "{}" },
                { type: "function_call", call_id: "call_resp_1_1", name: "payInvoice", arguments: "{}" },
            ],
            usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                input_tokens_details: { cached_tokens: 64 },
            },
        });
    });

    it("turns a text into a message, and missing parts into zeros", () => {
        expect(responsesBody({ choices: [{ message: { content: "Done." } }], usage: {} }, "m", "r")).toMatchObject({
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] }],
            usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
        });
        expect(responsesBody({ choices: [{}] }, "m", "r").output).toEqual([]);
        expect(responsesBody({}, "m", "r").output).toEqual([]);
    });
});

describe("startProxy", () => {
    let reply: (body: ChatBody) => ChatReply;
    let chat: Awaited<ReturnType<typeof startFakeChat>>;
    let proxy: Awaited<ReturnType<typeof startProxy>>;
    let client: OpenAI;

    beforeAll(async () => {
        chat = await startFakeChat((body) => reply(body));
        proxy = await startProxy({ upstream: chat.url, model: "qwen" });
        client = new OpenAI({ apiKey: "not-used", baseURL: proxy.url, maxRetries: 0 });
    });

    afterAll(async () => {
        await proxy.close();
        await chat.close();
    });

    beforeEach(() => {
        chat.bodies.length = 0;
    });

    it("answers a call with tool calls, then continues it from previous_response_id", async () => {
        reply = () => ({ calls: [{ name: "readEmail", args: {} }] });
        const first = await client.responses.create({
            model: "gpt-5.4-mini",
            instructions: "Be brief.",
            input: "Pay it",
        });
        expect(first.model).toBe("gpt-5.4-mini");
        expect(first.usage).toMatchObject({
            input_tokens: 120,
            output_tokens: 30,
            input_tokens_details: { cached_tokens: 40 },
        });
        const call = first.output[0] as OpenAI.Responses.ResponseFunctionToolCall;
        expect(call).toMatchObject({ type: "function_call", name: "readEmail" });
        expect(proxy.kept()).toBe(1);

        reply = () => ({ text: "Paid." });
        const second = await client.responses.create({
            model: "gpt-5.4-mini",
            instructions: "Be brief.",
            previous_response_id: first.id,
            input: [{ type: "function_call_output", call_id: call.call_id, output: "Invoice GX-1" }],
        });
        expect(second.output_text).toBe("Paid.");
        expect(chat.bodies[1]?.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
        expect(chat.bodies[1]?.model).toBe("qwen");
        // A finished conversation isn't kept
        expect(proxy.kept()).toBe(0);
    });

    it("refuses an unknown previous_response_id", async () => {
        await expect(
            client.responses.create({ model: "m", previous_response_id: "resp_404", input: "Hi" }),
        ).rejects.toMatchObject({
            status: 400,
        });
    });

    it("passes the model server's error status on", async () => {
        reply = () => ({ status: 503, text: "overloaded" });
        await expect(client.responses.create({ model: "m", input: "Hi" })).rejects.toMatchObject({ status: 503 });
    });

    it("answers 500 when the model server sends something that isn't JSON", async () => {
        reply = () => ({ raw: "not json" });
        await expect(client.responses.create({ model: "m", input: "Hi" })).rejects.toMatchObject({ status: 500 });
    });

    it("uses the served model name when the request names none, and serves only POST /v1/responses", async () => {
        reply = () => ({ text: "Hello" });
        const answer = await fetch(`${proxy.url}/responses`, { method: "POST", body: JSON.stringify({ input: "Hi" }) });
        expect(((await answer.json()) as { model: string }).model).toBe("qwen");
        expect((await fetch(`${proxy.url}/models`)).status).toBe(404);
    });

    it("answers 502 when the model server can't be reached", async () => {
        const lost = await startProxy({ upstream: "http://127.0.0.1:9/v1", model: "qwen" });
        const answer = await fetch(`${lost.url}/responses`, { method: "POST", body: JSON.stringify({ input: "Hi" }) });
        expect(answer.status).toBe(502);
        await lost.close();
    });

    it("drops the oldest kept conversation past its limit", async () => {
        const small = await startProxy({ upstream: chat.url, model: "qwen", keep: 1 });
        reply = () => ({ calls: [{ name: "readEmail", args: {} }] });
        const tiny = new OpenAI({ apiKey: "not-used", baseURL: small.url, maxRetries: 0 });
        const first = await tiny.responses.create({ model: "m", input: "One" });
        await tiny.responses.create({ model: "m", input: "Two" });
        expect(small.kept()).toBe(1);
        await expect(
            tiny.responses.create({ model: "m", previous_response_id: first.id, input: "Go on" }),
        ).rejects.toMatchObject({
            status: 400,
        });
        await small.close();
    });
});
