-- Spreads demo runs over the last 6 months. Only runs that started after
-- their project was created move, and they land months before that, so
-- a second run of this script moves nothing.
SET LOCAL timezone = 'UTC';
SELECT setseed(0.42);

CREATE TEMP TABLE moves AS
WITH fresh AS (
    -- 3 to 181 days ago, more often recent: a growth trend
    SELECT r.project_id, r.run_id, r.started_at,
        current_date - (3 + floor(178 * (1 - sqrt(random()))))::integer AS day
    FROM runs r
    JOIN projects p ON p.id = r.project_id
    WHERE r.started_at >= p.created_at
),
workdays AS (
    -- Most weekend runs move to the nearest weekday
    SELECT *,
        CASE
            WHEN extract(isodow FROM day) = 6 AND random() < 0.6 THEN day - 1
            WHEN extract(isodow FROM day) = 7 AND random() < 0.6 THEN day + 1
            ELSE day
        END AS workday
    FROM fresh
)
SELECT project_id, run_id,
    -- Mostly working hours
    workday + make_interval(
        hours => CASE WHEN random() < 0.9 THEN 8 + floor(random() * 10) ELSE floor(random() * 24) END::integer,
        mins => floor(random() * 60)::integer,
        secs => floor(random() * 60)
    ) - started_at AS shift
FROM workdays;

-- Every timestamp of a run moves by the same amount, so durations and
-- the order of events stay.
UPDATE runs x
SET started_at = x.started_at + m.shift,
    last_event_at = x.last_event_at + m.shift,
    ended_at = x.ended_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE steps x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE events x SET at = x.at + m.shift, received_at = x.received_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE labels x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE decisions x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE agent_messages x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE payments x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE chunk_labels x
SET at = x.at + m.shift,
    reviewed_at = x.reviewed_at + m.shift,
    leased_until = x.leased_until + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE incidents x
SET opened_at = x.opened_at + m.shift,
    run_after = x.run_after + m.shift,
    leased_until = x.leased_until + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE fleet_uses x SET at = x.at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE run_counters x SET updated_at = x.updated_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE message_records x SET stored_at = x.stored_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE memory_labels x
SET first_written_at = x.first_written_at + m.shift,
    last_written_at = x.last_written_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE approval_requests x
SET opened_at = x.opened_at + m.shift,
    decided_at = x.decided_at + m.shift,
    used_at = x.used_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

UPDATE approval_waiters x
SET since = x.since + m.shift,
    last_beat_at = x.last_beat_at + m.shift,
    done_at = x.done_at + m.shift
FROM moves m
WHERE x.project_id = m.project_id AND x.run_id = m.run_id;

-- The worker's hourly cleanup deletes runs past the retention
UPDATE projects SET retention_days = greatest(retention_days, 400);

DROP TABLE moves;
