// Demo data for the BI work: real runs on a local model.
// Run: node --env-file=bi/.env sandbox/seed/main.ts --runs 3000 --concurrency 32
import { runSeed } from "./run.ts";

process.exitCode = await runSeed(process.argv.slice(2));
