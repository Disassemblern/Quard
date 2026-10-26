-- Totals counted straight from the app tables, not from the bi views.
-- The report compares its own totals with these, which tests Power
-- Query and the model.
CREATE VIEW bi.control_totals AS
SELECT
    p.id AS project_id,
    (SELECT count(*) FROM runs r WHERE r.project_id = p.id) AS source_runs,
    (SELECT count(*) FROM steps s WHERE s.project_id = p.id AND s.kind = 'model_call') AS source_model_calls,
    (SELECT count(*) FROM steps s WHERE s.project_id = p.id AND s.kind = 'tool_call') AS source_tool_calls,
    (SELECT count(*) FROM decisions d WHERE d.project_id = p.id) AS source_decisions,
    (
        SELECT count(*) FROM decisions d WHERE d.project_id = p.id AND d.decision = 'block' AND d.enforced
    ) AS source_blocks,
    (SELECT count(*) FROM incidents i WHERE i.project_id = p.id) AS source_incidents,
    -- Each call rounded, then added up, as the Model cost measure does
    (
        SELECT coalesce(sum(round((s.detail ->> 'costUsd')::numeric * 1000000)), 0)::bigint
        FROM steps s
        WHERE s.project_id = p.id AND s.kind = 'model_call'
    ) AS source_cost_micro_usd,
    (
        SELECT coalesce(sum(round(x.usd::numeric * 1000000)), 0)::bigint
        FROM payments x
        WHERE x.project_id = p.id AND x.stage = 'settled'
    ) AS source_spend_micro_usd
FROM projects p;
