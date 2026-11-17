# Quard

Quard watches AI agents while they work. It records every model call, stops dangerous tool calls before they run, and finds which step and which agent caused an incident.

## Run the sandbox

You need Node 24 and an OpenAI API key.

```sh
npm install -g pnpm@12.6.0
pnpm install
cp sandbox/.env.example sandbox/.env    # put your OpenAI key in it
node sandbox/playground/run.ts
```

Tell the agent what to do. Quard guards it and prints each step and what it caught.

To change the run, edit the files in [sandbox/playground/](sandbox/playground):

- `scenario.json`: what the agent sees and which tools it has
- `policy.json`: the guard rules
- `signatures.json`: known-bad patterns

`git checkout sandbox/playground` puts the defaults back.

### Add the dashboard

Make the servers' hash key. Agents never need it: they get their project's key with the agent key.

```sh
KEY=$(openssl rand -hex 32)
printf 'DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres\nQUARD_HASH_KEY=%s\nQUARD_SKIP_SIGN_IN=1\n' "$KEY" > web/.env.local
```

Then start each of these in its own terminal:

```sh
pnpm --filter @quard/db dev:db
pnpm --filter web dev
node --env-file=web/.env.local services/webhook/main.ts
node --env-file=web/.env.local services/control/main.ts
node --env-file=web/.env.local --env-file=sandbox/.env services/worker/main.ts
```

Open http://localhost:3100, create an agent key in **Settings** and add it to `sandbox/.env` as `QUARD_AGENT_KEY=qk_live_...`. Run the sandbox again. The run shows under **Runs** and anything Quard caught under **Incidents**.

## Run the tests

```sh
pnpm test
```

## Learn more

- [PROJECT.md](PROJECT.md): how Quard works and every design decision
- [sandbox/README.md](sandbox/README.md): more runnable examples, one per feature
- [docs/content](docs/content): the user guide (`pnpm --filter docs dev`, then http://localhost:3001)
- [bi/README.md](bi/README.md): a Power BI report on Quard's data, with its star schema, data checks and findings
