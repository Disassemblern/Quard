-- Facts. Dates are UTC days. Money is whole micro-dollars, because a
-- model call can cost less than Power BI's 4 decimal places hold.

-- One row per run. Ingest keeps the totals in step with the steps.
CREATE VIEW bi.fact_run AS
SELECT
    r.project_id,
    r.run_id,
    r.agent,
    (r.started_at AT TIME ZONE 'UTC')::date AS start_date,
    r.started_at,
    coalesce(r.outcome, 'running') AS outcome,
    -- A run still going counts up to its last event
    round(extract(epoch FROM coalesce(r.ended_at, r.last_event_at) - r.started_at) * 1000)::bigint AS duration_ms,
    r.model_calls + r.tool_calls AS step_count,
    round(r.cost_usd::numeric * 1000000)::bigint AS cost_micro_usd,
    r.cost_known,
    round(r.spend_usd::numeric * 1000000)::bigint AS spend_micro_usd,
    r.spend_known,
    r.influenced,
    r.flagged,
    r.degraded,
    r.blocked > 0 AS has_block,
    EXISTS (
        SELECT 1 FROM incidents i WHERE i.project_id = r.project_id AND i.run_id = r.run_id
    ) AS has_incident
FROM runs r;

-- One row per model call. Ingest priced it when it was stored.
CREATE VIEW bi.fact_model_call AS
SELECT
    s.project_id,
    s.run_id,
    s.step_id,
    s.agent,
    s.name AS model,
    (s.at AT TIME ZONE 'UTC')::date AS call_date,
    s.at AS called_at,
    s.status,
    (s.detail -> 'usage' ->> 'inputTokens')::integer AS input_tokens,
    (s.detail -> 'usage' ->> 'cachedTokens')::integer AS cached_tokens,
    (s.detail -> 'usage' ->> 'outputTokens')::integer AS output_tokens,
    round((s.detail ->> 'costUsd')::numeric * 1000000)::bigint AS cost_micro_usd,
    s.duration_ms
FROM steps s
WHERE s.kind = 'model_call';

-- One row per tool call, without its arguments
CREATE VIEW bi.fact_tool_call AS
SELECT
    s.project_id,
    s.run_id,
    s.step_id,
    s.agent,
    s.name AS tool,
    (s.at AT TIME ZONE 'UTC')::date AS call_date,
    s.at AS called_at,
    s.status,
    s.influenced,
    s.flagged,
    s.duration_ms
FROM steps s
WHERE s.kind = 'tool_call';

-- One row per guard decision, allows included, without the reason
CREATE VIEW bi.fact_decision AS
SELECT
    d.project_id,
    d.event_id,
    d.run_id,
    d.agent,
    d.tool,
    d.guard || ' / ' || d.rule AS guard_rule,
    (d.at AT TIME ZONE 'UTC')::date AS decision_date,
    d.at AS decided_at,
    d.decision,
    d.mode,
    d.decision = 'block' AND d.enforced AS is_block,
    -- Observe mode: it would have blocked
    d.decision = 'block' AND NOT d.enforced AS is_would_block
FROM decisions d;

-- One row per incident, without the verdict's text
CREATE VIEW bi.fact_incident AS
SELECT
    i.project_id,
    i.id AS incident_id,
    i.run_id,
    (i.opened_at AT TIME ZONE 'UTC')::date AS opened_date,
    coalesce(i.category, 'unknown') AS category,
    i.damage_agent,
    i.entry_agent,
    i.turning_agent,
    i.entry_origin,
    -- Such as web or email
    split_part(i.entry_origin, ':', 1) AS entry_origin_kind,
    i.entry_trust,
    i.damage_tool,
    i.find_state,
    i.replay_state,
    round(i.spent_usd::numeric * 1000000)::bigint AS spent_micro_usd
FROM incidents i;

-- One row per payment event, without the resource path or the reason
CREATE VIEW bi.fact_payment AS
SELECT
    p.project_id,
    p.event_id,
    p.run_id,
    p.agent,
    (p.at AT TIME ZONE 'UTC')::date AS payment_date,
    p.at AS paid_at,
    p.stage,
    p.host,
    p.network,
    p.asset,
    p.pay_to,
    -- Null when the token's value is unknown
    round(p.usd::numeric * 1000000)::bigint AS value_micro_usd,
    -- Up to 78 digits, more than any Power BI number holds
    p.amount::text AS amount_atomic,
    p.delivered
FROM payments p;
