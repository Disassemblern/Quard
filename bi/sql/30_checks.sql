-- One row per project and check. A check passes when the share of
-- failing rows is at most its threshold. Each source table is read once,
-- then the counts turn into one row per check.
CREATE VIEW bi.dq_checks AS
WITH steps_by_run AS (
    SELECT
        project_id,
        run_id,
        count(*) FILTER (WHERE kind = 'model_call') AS model_calls,
        count(*) FILTER (WHERE kind = 'tool_call') AS tool_calls,
        sum((detail ->> 'costUsd')::numeric) FILTER (WHERE kind = 'model_call') AS cost_usd
    FROM steps
    GROUP BY project_id, run_id
),
spend_by_run AS (
    SELECT project_id, run_id, sum(usd::numeric) AS spend_usd
    FROM payments
    WHERE stage = 'settled'
    GROUP BY project_id, run_id
),
blocked_runs AS (
    -- Enforced or observed: both open an incident
    SELECT DISTINCT project_id, run_id FROM decisions WHERE decision = 'block'
),
by_run AS (
    -- Money is compared in whole micro-dollars
    SELECT
        r.project_id,
        count(*) AS runs,
        count(*) FILTER (
            WHERE round(r.cost_usd::numeric * 1000000) <> round(coalesce(s.cost_usd, 0) * 1000000)
        ) AS cost_off,
        count(*) FILTER (WHERE r.model_calls <> coalesce(s.model_calls, 0)) AS model_calls_off,
        count(*) FILTER (WHERE r.tool_calls <> coalesce(s.tool_calls, 0)) AS tool_calls_off,
        count(*) FILTER (
            WHERE round(r.spend_usd::numeric * 1000000) <> round(coalesce(p.spend_usd, 0) * 1000000)
        ) AS spend_off,
        count(b.run_id) AS blocked,
        count(b.run_id) FILTER (WHERE i.id IS NULL) AS blocked_no_incident,
        count(*) FILTER (WHERE NOT r.cost_known) AS cost_unknown,
        count(p.run_id) AS paid,
        count(p.run_id) FILTER (WHERE NOT r.spend_known) AS spend_unknown
    FROM runs r
    LEFT JOIN steps_by_run s ON s.project_id = r.project_id AND s.run_id = r.run_id
    LEFT JOIN spend_by_run p ON p.project_id = r.project_id AND p.run_id = r.run_id
    LEFT JOIN blocked_runs b ON b.project_id = r.project_id AND b.run_id = r.run_id
    LEFT JOIN incidents i ON i.project_id = r.project_id AND i.run_id = r.run_id
    GROUP BY r.project_id
),
by_event AS (
    -- Raw events against the tables built from them
    SELECT
        e.project_id,
        count(*) AS events,
        count(*) FILTER (WHERE e.degraded) AS late,
        count(*) FILTER (WHERE e.type IN ('model_call', 'tool_call')) AS step_events,
        count(*) FILTER (WHERE e.type IN ('model_call', 'tool_call') AND s.step_id IS NULL) AS no_step,
        count(*) FILTER (WHERE e.type = 'decision') AS decision_events,
        count(*) FILTER (WHERE e.type = 'decision' AND d.event_id IS NULL) AS no_decision,
        count(*) FILTER (WHERE e.type = 'payment') AS payment_events,
        count(*) FILTER (WHERE e.type = 'payment' AND x.event_id IS NULL) AS no_payment
    FROM events e
    LEFT JOIN steps s ON s.project_id = e.project_id AND s.run_id = e.run_id AND s.step_id = e.step_id
    LEFT JOIN decisions d ON d.project_id = e.project_id AND d.event_id = e.event_id
    LEFT JOIN payments x ON x.project_id = e.project_id AND x.event_id = e.event_id
    GROUP BY e.project_id
),
by_incident AS (
    SELECT
        project_id,
        count(*) AS incidents,
        count(*) FILTER (WHERE find_state = 'pending' AND opened_at < now() - interval '15 minutes') AS stuck
    FROM incidents
    GROUP BY project_id
),
by_payment AS (
    SELECT
        project_id,
        count(*) AS settled,
        count(*) FILTER (WHERE delivered = false) AS undelivered
    FROM payments
    WHERE stage = 'settled'
    GROUP BY project_id
),
by_drop AS (
    SELECT project_id, sum(count) AS dropped FROM upload_drops GROUP BY project_id
),
counted AS (
    SELECT p.id AS project_id, c.check_name, c.kind, c.description,
        coalesce(c.failing, 0) AS failing, coalesce(c.total, 0) AS total, c.threshold
    FROM projects p
    LEFT JOIN by_run r ON r.project_id = p.id
    LEFT JOIN by_event e ON e.project_id = p.id
    LEFT JOIN by_incident i ON i.project_id = p.id
    LEFT JOIN by_payment x ON x.project_id = p.id
    LEFT JOIN by_drop d ON d.project_id = p.id
    CROSS JOIN LATERAL (
        VALUES
            ('run_cost_vs_model_calls', 'reconcile',
                'Runs whose cost is not the sum of their model calls'' cost', r.cost_off, r.runs, 0),
            ('run_model_calls_vs_steps', 'reconcile',
                'Runs whose model_calls is not the count of their model-call steps', r.model_calls_off, r.runs, 0),
            ('run_tool_calls_vs_steps', 'reconcile',
                'Runs whose tool_calls is not the count of their tool-call steps', r.tool_calls_off, r.runs, 0),
            ('run_spend_vs_payments', 'reconcile',
                'Runs whose spend is not the sum of their settled payments', r.spend_off, r.runs, 0),
            ('events_vs_steps', 'reconcile',
                'Model-call and tool-call events with no step row', e.no_step, e.step_events, 0),
            ('events_vs_decisions', 'reconcile',
                'Decision events with no decisions row', e.no_decision, e.decision_events, 0),
            ('events_vs_payments', 'reconcile',
                'Payment events with no payments row', e.no_payment, e.payment_events, 0),
            ('block_has_incident', 'rule',
                'Runs with a block decision, enforced or observed, but no incident',
                r.blocked_no_incident, r.blocked, 0),
            ('incident_not_stuck', 'rule',
                'Incidents still pending 15 minutes after they opened', i.stuck, i.incidents, 0),
            ('cost_unknown_share', 'monitor',
                'Runs whose cost is unknown', r.cost_unknown, r.runs, 0.05),
            ('spend_unknown_share', 'monitor',
                'Runs with spend in a token of unknown value', r.spend_unknown, r.paid, 0.05),
            ('paid_not_delivered_share', 'monitor',
                'Settled payments whose paid response never arrived', x.undelivered, x.settled, 0.02),
            ('late_events_share', 'monitor',
                'Events sent late', e.late, e.events, 0.01),
            ('dropped_events_share', 'monitor',
                'Events the SDK dropped', d.dropped, coalesce(e.events, 0) + coalesce(d.dropped, 0), 0.001)
    ) AS c (check_name, kind, description, failing, total, threshold)
)
SELECT
    project_id,
    check_name,
    kind,
    description,
    failing,
    total,
    CASE WHEN total = 0 THEN 0 ELSE round(failing::numeric / total, 6) END AS rate,
    threshold,
    CASE WHEN total = 0 THEN 0 ELSE failing::numeric / total END <= threshold AS passed
FROM counted;
