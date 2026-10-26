-- Dimensions. Each one is unique by project_id and its key.

-- Every agent a fact can name, so no fact key is missing
CREATE VIEW bi.dim_agent AS
WITH seen AS (
    SELECT project_id, agent, started_at AS at FROM runs
    UNION ALL
    SELECT project_id, agent, at FROM steps
    UNION ALL
    SELECT project_id, agent, at FROM decisions
    UNION ALL
    SELECT project_id, agent, at FROM payments
    UNION ALL
    SELECT project_id, damage_agent, opened_at FROM incidents WHERE damage_agent IS NOT NULL
    UNION ALL
    SELECT project_id, entry_agent, opened_at FROM incidents WHERE entry_agent IS NOT NULL
    UNION ALL
    SELECT project_id, turning_agent, opened_at FROM incidents WHERE turning_agent IS NOT NULL
),
versions AS (
    -- The model of the version seen last, and how many versions there are
    SELECT DISTINCT ON (project_id, agent)
        project_id,
        agent,
        model AS current_model,
        count(*) OVER (PARTITION BY project_id, agent) AS versions
    FROM agent_versions
    ORDER BY project_id, agent, last_seen_at DESC, version
)
SELECT
    s.project_id,
    s.agent,
    (min(s.at) AT TIME ZONE 'UTC')::date AS first_seen_date,
    v.current_model,
    coalesce(v.versions, 0) AS versions
FROM seen s
LEFT JOIN versions v ON v.project_id = s.project_id AND v.agent = s.agent
GROUP BY s.project_id, s.agent, v.current_model, v.versions;

-- A model is priced when any of its calls has a cost
CREATE VIEW bi.dim_model AS
SELECT
    project_id,
    name AS model,
    bool_or(detail ->> 'costUsd' IS NOT NULL) AS is_priced
FROM steps
WHERE kind = 'model_call'
GROUP BY project_id, name;

CREATE VIEW bi.dim_tool AS
SELECT project_id, name AS tool FROM steps WHERE kind = 'tool_call'
UNION
SELECT project_id, tool FROM decisions
UNION
SELECT project_id, damage_tool FROM incidents WHERE damage_tool IS NOT NULL;

CREATE VIEW bi.dim_guard AS
SELECT DISTINCT
    project_id,
    guard || ' / ' || rule AS guard_rule,
    guard,
    rule
FROM decisions;
