import { ATTACKS } from "./attacks.ts";
import { BUSINESS } from "./business.ts";
import { PAYMENTS } from "./payments.ts";
import type { Scenario } from "./scenario.ts";

export const SCENARIOS: Scenario[] = [...BUSINESS, ...ATTACKS, ...PAYMENTS];
export type { Scenario, Setup } from "./scenario.ts";
