// The generator's first import. lib/env.ts loads sandbox/.env, which may
// hold a real OpenAI key, but values already set win. With these, no call
// can reach OpenAI: the proxy sets the real base URL once it listens.
process.env.OPENAI_API_KEY = "not-used";
// Port 9 is the discard port: nothing answers there
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";

export {};
