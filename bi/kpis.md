# Quard BI: personas, user stories and KPIs

What the BI report measures, for whom, and exactly how. Every measure in the Power BI model has the same name as its KPI here, and carries this definition as its description.

## 1. Purpose and scope

Quard records what AI agents do: their model calls, tool calls, guard decisions, incidents and x402 payments. This report turns those records into a monthly view for four people: a security lead, an engineering manager, finance and a platform operator. It shows whether the guards work, what the agents cost and how well they run, and whether the numbers can be trusted. It covers one Quard project at a time, with data refreshed on demand. Out of scope: approval KPIs (how many asks, how fast people answer) and real-time views.

## 2. Personas

### Security lead

- **Goal:** stop attacks without blocking normal work.
- **Questions:** Are the guards working? Which observe-mode rules would block often, and could they block for real? Where does untrusted content come in? Which agents act on risky content?
- **Decisions:** which rules move from observe to block; which agents need stricter guards or fewer tools; which content sources to treat with more care.
- **How often:** weekly, and after a jump in incidents.
- **Page:** Security.

### Engineering manager

- **Goal:** agents that are cheap, reliable and fast enough.
- **Questions:** Which agents cost the most per run? Which models fail or run slow? Did a model change lower the cost or raise the cache use?
- **Decisions:** which agent to optimize first; whether to switch or roll back a model; where prompt caching is worth the work.
- **How often:** weekly, and after a model change.
- **Page:** Engineering.

### Finance

- **Goal:** know and control what AI costs.
- **Questions:** What did AI cost this month, x402 payments included, and is it growing? Whom did the agents pay? Which payments got nothing back? How complete is the cost number?
- **Decisions:** budget and forecast; which payments to dispute; asking engineering to add prices for unpriced models.
- **How often:** monthly, at month close.
- **Page:** Finance.

### Platform operator

- **Goal:** a report people can trust.
- **Questions:** Do all data checks pass? Do the report's totals match the database? How fresh is the data?
- **Decisions:** share the report or hold it back; open a bug on ingest, the SQL views or Power Query; refresh again.
- **How often:** after every refresh, before the report is shared.
- **Page:** Data quality.

Anyone can use the Overview page for the headline numbers.

## 3. User stories

Each story lists its page, the KPIs it needs, and acceptance criteria that someone can check on the finished page.

### ALL-1. Headline KPIs

As anyone, I want the headline KPIs with their change from last month on one page, so that I see the state in ten seconds.

- **Page:** Overview. **KPIs:** K01, K02, K03, K05, K07, K09, K04, K23 to K27.
- Six cards show Run count, Model cost, Cost per run, Spend, Block rate and Incident rate.
- With the date filter inside one month, each card shows its change from the same days one month earlier: in percent for counts and money, in percentage points for rates.
- With a date filter longer than a month, the change is blank, not a misleading number.
- Run count and Model cost for a month equal that month's row in the "By month" DAX query.

### SEC-1. Guard rules ready to block

As a security lead, I want block and would-block counts per guard rule, so that I can switch quiet observe rules to block.

- **Page:** Security. **KPIs:** K07, K08, with Blocks and Would blocks.
- A table has one row per guard rule, with Blocks, Would blocks and Would-block rate as columns.
- It is sorted by Would blocks, highest first.
- The date and agent filters change it.
- With no filter, its Blocks total equals Blocks in the "Totals" DAX query.

### SEC-2. Where attacks come in

As a security lead, I want incidents by category, entry origin and entry agent over time, so that I know where attacks come in.

- **Page:** Security. **KPIs:** K09, K10, with Incident count.
- Incident count by category, where incidents without a verdict yet show as "unknown".
- Incident count by entry origin kind, such as web or email.
- Per agent, Incidents by entry agent next to Incident count (by the agent that did the damage).
- The date filter changes all three, by the day each incident opened.

### SEC-3. Agents that act on untrusted content

As a security lead, I want the share of tool calls made under untrusted influence, per agent, so that I know which agents read risky content.

- **Page:** Security. **KPIs:** K11.
- Influenced share for the whole filter.
- Influenced share per agent, one row per agent, highest first.
- A tooltip says that influenced means "read untrusted content earlier in the run", not "did harm".

### ENG-1. Where to optimize cost first

As an engineering manager, I want agents ranked by model cost, with cost per run, so that I know where to optimize first.

- **Page:** Engineering. **KPIs:** K02, K03, K14, K12, K20.
- One bar per agent shows Cost per run, labeled with its Agent cost rank.
- Rank 1 is the agent with the highest Model cost in the current filter; equal costs share a rank.
- Each agent's tooltip shows its Failure rate and Avg steps per run, the usual reasons a run costs more.
- The date and agent filters change both the values and the ranks.

### ENG-2. Unreliable models

As an engineering manager, I want latency p95 and failure rate per model, so that I can spot unreliable models.

- **Page:** Engineering. **KPIs:** K13, K18, with Model call count.
- A table has one row per model, with Model call count, Latency p95 ms and Model call error rate.
- Each model row shows its own values, not the same number on every row.
- The date filter changes the table.

### ENG-3. Effect of model changes

As an engineering manager, I want the model mix and cached token share by month, so that I can see the effect of model changes.

- **Page:** Engineering. **KPIs:** K02, K19.
- Model cost by month, stacked by model, so a model change shows as a change in the mix.
- Cached token share by month, and per model.

### FIN-1. Monthly AI cost

As finance, I want monthly Total AI cost with the change from last month, so that I can track the budget.

- **Page:** Finance. **KPIs:** K06, K28, K04.
- A line chart shows Total AI cost by month.
- Each month's tooltip shows Total AI cost MoM %.
- For every month, Total AI cost equals Model cost plus Spend.

### FIN-2. Payments to dispute

As finance, I want spend by host and payee and the paid-not-delivered payments, so that I can dispute them.

- **Page:** Finance. **KPIs:** K05, K15.
- Spend by host and Spend by payee, highest first.
- Cards show Paid not delivered and Paid not delivered USD.
- A table lists each paid-not-delivered payment with its date, host, payee, USD value and run ID, so it can be found in Quard.

### FIN-3. How complete the cost is

As finance, I want to know how much cost is unknown, so that I know how complete the numbers are.

- **Page:** Finance. **KPIs:** K16.
- A card shows Cost coverage as a percent of runs.
- The date and agent filters change it.
- A tooltip says that runs with an unpriced model call still count in Run count, but their unpriced calls add nothing to Model cost.

### OPS-1. Failing data checks

As a platform operator, I want to see which data checks fail and by how much, so that I trust the report before I share it.

- **Page:** Data quality. **KPIs:** K17.
- A table has one row per check: check name, kind, failing, total, rate, threshold and passed.
- Passed shows as an icon and a word, never by color alone.
- The Failing checks card equals the number of rows where Passed is false.
- The date and agent filters don't change the checks.

### OPS-2. Report against database

As a platform operator, I want the report's totals compared with the database, so that I know nothing was lost on the way.

- **Page:** Data quality. **KPIs:** K21, K22.
- Cards show Runs gap vs source and Cost gap vs source, both 0 on clean data.
- The gaps stay the same with any date or agent filter.
- The page shows when the data was last refreshed.

## 4. KPI catalog

How to read each entry:

- **Source:** the view in the `bi` schema the KPI reads.
- **Grain:** what one row of that source is.
- **Filtered by:** which date column the date filter uses, and which agent the agent filter matches.
- Money is in USD. The views carry whole micro-dollars (1 USD = 1,000,000), and the measures divide.

| Id | KPI | Persona |
| --- | --- | --- |
| K01 | Run count | All |
| K02 | Model cost | Finance, Engineering |
| K03 | Cost per run | Engineering, Finance |
| K04 | Model cost MoM % | Finance |
| K05 | Spend | Finance |
| K06 | Total AI cost | Finance |
| K07 | Block rate | Security |
| K08 | Would-block rate | Security |
| K09 | Incident rate | Security |
| K10 | Incidents by entry agent | Security |
| K11 | Influenced share | Security |
| K12 | Failure rate | Engineering |
| K13 | Latency p95 ms | Engineering |
| K14 | Agent cost rank | Engineering |
| K15 | Paid not delivered | Finance, Operator |
| K16 | Cost coverage | Finance, Operator |
| K17 | Failing checks | Operator |
| K18 | Model call error rate | Engineering |
| K19 | Cached token share | Engineering |
| K20 | Avg steps per run | Engineering |
| K21 | Runs gap vs source | Operator |
| K22 | Cost gap vs source | Operator |
| K23 to K28 | Month-over-month changes | All, Finance |

### K01. Run count

- **Question:** How much work did the agents do?
- **Definition:** Runs started in the period.
- **Formula:** Count the runs.
- **Source:** `bi.fact_run`. **Grain:** one run.
- **Filtered by:** Start date; the agent that started the run.
- **Caveats:** Runs still going count. Work handed to another agent counts under the agent that started the run.

### K02. Model cost

- **Question:** What do model calls cost?
- **Definition:** Priced model-call cost, by the agent that made the call and the day of the call.
- **Formula:** Sum the cost of every model call, divided by 1,000,000.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date; the agent that made the call; model.
- **Caveats:** A call to a model with no known price adds nothing, so this is a lower bound (see K16). Ingest prices each call when it is stored, with the list prices in `packages/shared/prices/models.ts`; discounts and later price changes don't show. Per agent, it differs from Run cost when one agent hands work to another.

### K03. Cost per run

- **Question:** How expensive is one run of an agent?
- **Definition:** Run cost / Run count, by the agent that started the run.
- **Formula:** Sum the cost of every run, divided by 1,000,000, then divided by Run count.
- **Source:** `bi.fact_run`. **Grain:** one run.
- **Filtered by:** Start date; the agent that started the run.
- **Caveats:** A run's cost includes every model call in it, by any agent, under the agent that started the run. A run with an unpriced call counts with its priced calls only. Runs still going have their cost so far.

### K04. Model cost MoM %

- **Question:** Is model cost growing or shrinking?
- **Definition:** Change in Model cost from the same days one month earlier.
- **Formula:** (Model cost minus Model cost one month earlier) divided by Model cost one month earlier.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date, within one month; the agent that made the call; model.
- **Caveats:** Blank when the date filter is longer than a month, or when the month before had no cost. See "Month-over-month" in the shared definitions.

### K05. Spend

- **Question:** How much did agents pay for paid APIs?
- **Definition:** Settled x402 payments in USD, delivered or not.
- **Formula:** Sum the USD value of payments at the settled stage, divided by 1,000,000.
- **Source:** `bi.fact_payment`. **Grain:** one payment event.
- **Filtered by:** Payment date; the agent that paid.
- **Caveats:** One payment leaves several events (challenged, signed, settled); only the settled one counts. A payment that was not delivered still counts, because the money is gone. A token with no known USD value adds nothing; the data check `spend_unknown_share` watches for this.

### K06. Total AI cost

- **Question:** What does AI cost in total?
- **Definition:** Model cost + Spend.
- **Formula:** K02 plus K05.
- **Source:** `bi.fact_model_call` and `bi.fact_payment`. **Grain:** one model call; one payment event.
- **Filtered by:** Call date and payment date; the agent that made the call or paid.
- **Caveats:** A lower bound, for the reasons in K02 and K05. It leaves out what Quard's own worker spends on incident reviews and replays.

### K07. Block rate

- **Question:** How often do guards stop something?
- **Definition:** Enforced blocks / all guard decisions.
- **Formula:** Blocks (decisions that are "block" and enforced) divided by Decision count (all decisions: allow, block, ask, pass, strip and flag).
- **Source:** `bi.fact_decision`. **Grain:** one guard decision.
- **Filtered by:** Decision date; the agent the decision was about; tool; guard rule.
- **Caveats:** Observe-mode blocks don't count; they are in K08. One tool call can get several decisions, one per guard rule, and content scans add decisions too, so this is a share of decisions, not of tool calls.

### K08. Would-block rate

- **Question:** How often would observe-mode guards block?
- **Definition:** Observe-mode blocks / all guard decisions.
- **Formula:** Would blocks (decisions that are "block" and not enforced) divided by Decision count.
- **Source:** `bi.fact_decision`. **Grain:** one guard decision.
- **Filtered by:** Decision date; the agent the decision was about; tool; guard rule.
- **Caveats:** These calls went through. A rule with many would-blocks and no false alarms is ready to switch to block mode. The denominator is the same as in K07.

### K09. Incident rate

- **Question:** How many runs needed a closer look?
- **Definition:** Incident count / Run count.
- **Formula:** Count the incidents, divided by Run count.
- **Source:** `bi.fact_incident` and `bi.fact_run`. **Grain:** one incident; one run.
- **Filtered by:** Opened date for incidents and start date for runs; the agent that did the damage for incidents and the agent that started the run for runs.
- **Caveats:** A run has at most one incident, so this is close to the share of runs with one. Incidents open for observe-mode blocks and flagged content too, not only for enforced blocks. A run that starts just before midnight can have its incident open the next day, sometimes in the next month.

### K10. Incidents by entry agent

- **Question:** Through which agent does untrusted content come in?
- **Definition:** Incidents counted by the agent where untrusted content came in.
- **Formula:** Count the incidents, with the agent filter matching the entry agent instead of the agent that did the damage.
- **Source:** `bi.fact_incident`. **Grain:** one incident.
- **Filtered by:** Opened date; the entry agent.
- **Caveats:** The entry agent is empty until the root-cause finder has a verdict, and stays empty when the finder fails or finds no entry point. Those incidents show under a blank agent.

### K11. Influenced share

- **Question:** How often do agents act after reading untrusted content?
- **Definition:** Tool calls made after the model read untrusted content / tool calls.
- **Formula:** Count the tool calls marked influenced, divided by all tool calls.
- **Source:** `bi.fact_tool_call`. **Grain:** one tool call.
- **Filtered by:** Call date; the agent that made the call; tool.
- **Caveats:** Influenced doesn't mean harmful: the model had read something untrusted earlier in the run. Agents that browse the web are almost always influenced.

### K12. Failure rate

- **Question:** How often do runs fail?
- **Definition:** Failed runs / finished runs.
- **Formula:** Count the runs with outcome "failed", divided by Finished runs.
- **Source:** `bi.fact_run`. **Grain:** one run.
- **Filtered by:** Start date; the agent that started the run.
- **Caveats:** A blocked run is finished but not failed. Runs still going are left out, and a run whose process died before it reported its end stays "running". A run has no single model, so this can't be split by model; K18 does that.

### K13. Latency p95 ms

- **Question:** How slow are model calls at worst, leaving out rare extremes?
- **Definition:** 95th percentile of model-call duration.
- **Formula:** The duration in milliseconds that 95% of the model calls in the filter are at or under.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date; the agent that made the call; model.
- **Caveats:** Failed calls count. The SDK measures it, so it includes network time. Percentiles don't add up: a total row is computed from all its calls, not from the rows above it.

### K14. Agent cost rank

- **Question:** Which agent costs the most?
- **Definition:** Rank of each agent by Model cost in the current filter.
- **Formula:** Rank the agents in the current filter by Model cost, the highest as 1. Equal costs share a rank, and the next rank follows on.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date; model; the agent filter limits which agents are ranked.
- **Caveats:** Shows only on rows for one agent and is blank on totals. It ranks by Model cost, the agent that made the call, not by Run cost.

### K15. Paid not delivered

- **Question:** Which payments got nothing back?
- **Definition:** Settled payments whose paid response never arrived: a count, and their value as Paid not delivered USD.
- **Formula:** Count the payments at the settled stage that were not delivered. Paid not delivered USD sums their USD value, divided by 1,000,000.
- **Source:** `bi.fact_payment`. **Grain:** one payment event.
- **Filtered by:** Payment date; the agent that paid.
- **Caveats:** These payments are in Spend too. The USD value leaves out tokens with no known USD value; the count includes them.

### K16. Cost coverage

- **Question:** How complete is the cost number?
- **Definition:** Runs whose cost is known / Run count.
- **Formula:** Count the runs whose cost is known, divided by Run count.
- **Source:** `bi.fact_run`. **Grain:** one run.
- **Filtered by:** Start date; the agent that started the run.
- **Caveats:** A run with even one unpriced model call counts as unknown. It covers model cost only; spend in tokens with no known USD value is the data check `spend_unknown_share`.

### K17. Failing checks

- **Question:** Can the numbers be trusted right now?
- **Definition:** Rows of `bi.dq_checks` that did not pass.
- **Formula:** Count the check rows where passed is false.
- **Source:** `bi.dq_checks`. **Grain:** one check for the project.
- **Filtered by:** Nothing. Checks always cover all the project's data, so the date and agent filters don't apply.
- **Caveats:** The checks run in the database at refresh time, so they are as fresh as the last refresh. Monitor checks allow a small share of failing rows, so a check with failing rows can still pass.

### K18. Model call error rate

- **Question:** Which models fail most often?
- **Definition:** Failed model calls / model calls.
- **Formula:** Count the model calls with status "error", divided by Model call count.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date; the agent that made the call; model.
- **Caveats:** A call the app retries counts once per try. This is not Failure rate (K12), which counts runs.

### K19. Cached token share

- **Question:** How much of the input comes from the prompt cache?
- **Definition:** Cached input tokens / input tokens.
- **Formula:** Sum the cached tokens, divided by the sum of input tokens, over model calls.
- **Source:** `bi.fact_model_call`. **Grain:** one model call.
- **Filtered by:** Call date; the agent that made the call; model.
- **Caveats:** Cached tokens are part of input tokens, as the API reports them, and cost less. Calls with no token counts, often failed ones, add nothing to either side.

### K20. Avg steps per run

- **Question:** How much work does one run take?
- **Definition:** Average number of model calls and tool calls per run.
- **Formula:** The average, over runs, of each run's model calls plus tool calls.
- **Source:** `bi.fact_run`. **Grain:** one run.
- **Filtered by:** Start date; the agent that started the run.
- **Caveats:** Every agent's steps in a run count, under the agent that started it. Payments are not steps. Runs still going count with their steps so far.

### K21. Runs gap vs source

- **Question:** Did every run reach the report?
- **Definition:** Run count in the report minus runs in the database.
- **Formula:** Run count with every filter removed, minus `source_runs` from `bi.control_totals`. It must be 0.
- **Source:** `bi.fact_run` and `bi.control_totals`. **Grain:** one run; one row per project.
- **Filtered by:** Nothing; it ignores every filter.
- **Caveats:** Anything other than 0 means rows were lost or added between the database and the report, for example by a Power Query step. On a live database, runs that arrive during a refresh could make a small gap; the demo data doesn't change during one.

### K22. Cost gap vs source

- **Question:** Did all model cost reach the report?
- **Definition:** Model cost in the report minus model cost in the database.
- **Formula:** Model cost with every filter removed, minus `source_cost_micro_usd` from `bi.control_totals` divided by 1,000,000. It must be 0.
- **Source:** `bi.fact_model_call` and `bi.control_totals`. **Grain:** one model call; one row per project.
- **Filtered by:** Nothing; it ignores every filter.
- **Caveats:** The source total adds up the model-call steps, the same grain as Model cost. Ingest prices each call to the whole micro-dollar, so rounding never makes a gap. The note on live data in K21 applies too.

### K23 to K28. Month-over-month changes

The same pattern as K04, for the Overview cards and the Finance page. Source, grain, filters and caveats are those of the base KPI, plus the month-over-month rules in the shared definitions.

| Id | KPI | Base KPI | Change in | Used by |
| --- | --- | --- | --- | --- |
| K23 | Run count MoM % | K01 | percent | ALL-1 |
| K24 | Cost per run MoM % | K03 | percent | ALL-1 |
| K25 | Spend MoM % | K05 | percent | ALL-1 |
| K26 | Block rate MoM pp | K07 | percentage points | ALL-1 |
| K27 | Incident rate MoM pp | K09 | percentage points | ALL-1 |
| K28 | Total AI cost MoM % | K06 | percent | FIN-1 |

### Supporting measures

Not KPIs on their own, but shown on pages or used by the KPIs above.

| Measure | Definition | Used by |
| --- | --- | --- |
| Finished runs | Runs with an outcome: completed, failed or blocked | K12 |
| Run cost | Sum of run cost in USD, by the agent that started the run | K03 |
| Model call count | Number of model calls | K18, ENG-2 |
| Decision count | Number of guard decisions of any kind | K07, K08 |
| Blocks | Decisions that are "block" and enforced | K07, SEC-1 |
| Would blocks | Decisions that are "block" in observe mode | K08, SEC-1 |
| Incident count | Number of incidents, by the agent that did the damage | K09, SEC-2, Overview |

## 5. Shared definitions

- **Run:** one call of `quard.run()`: an agent's task from start to end. A run belongs to the agent that started it, even when it hands work to other agents.
- **Step:** a model call or a tool call inside a run. A step belongs to the agent that made it.
- **Finished run:** a run with an outcome: completed, failed or blocked. A run with no outcome yet is "running".
- **Guard decision:** what one guard rule decided about a tool call, a payment or a piece of content: allow, block, ask, pass, strip or flag. One tool call can get several decisions.
- **Guard rule:** a guard and one rule inside it. In the model, its name is the guard's name, " / ", and the rule's name.
- **Enforced and observe:** every guard runs in block mode or observe mode. In block mode a block is enforced, and the call doesn't happen. In observe mode, the guard records that it would have blocked and lets the call through: a would-block. Observe-mode blocks never count as blocks.
- **Incident:** opened for a run when a guard blocks a call or would have, or when a guard flags or strips content (the source scan, the AI detector or a signature). A run has at most one incident, opened at its earliest such decision. Its category is "unknown" until the root-cause finder files a verdict.
- **Influenced:** a tool call the model asked for after it had read untrusted content in the same run.
- **Settled and delivered:** an x402 payment goes through stages: challenged, refused, signed, settled or failed. Settled means the money moved. Delivered means the paid response arrived. Spend counts settled payments only, delivered or not, as in [PROJECT.md](../PROJECT.md#payments-x402).
- **Money:** in USD. The SQL views carry whole micro-dollars (1 USD = 1,000,000), because a model call can cost less than $0.0001, and the measures divide by 1,000,000.
- **Days:** UTC days, as Quard's per-day limits use. A run belongs to the day it started, a model or tool call to the day it was made, a decision to the day it was made, an incident to the day it opened, and a payment to the day of the payment event.
- **Month-over-month (MoM):** the value for the days in the date filter, compared with the same days one month earlier. It needs a date filter inside one month, or a month on a chart's axis; otherwise it is blank. Counts and money change in percent. Rates change in percentage points: a rate going from 4.2% to 4.8% is +0.6 pp. A month that is not over yet looks low next to a whole month, so compare the same days.
