from datetime import timedelta

import pytest
from factories import decision, finish, hex_id, incident, model_call, now, payment, project, run, tool_call
from psycopg import Connection, sql

import apply

BACKDATE = apply.HERE / "seed" / "backdate.sql"

# Every timestamp column of every table that has a run_id
RUN_COLUMNS = """
SELECT c.table_name, c.column_name
FROM information_schema.columns c
JOIN information_schema.columns r
    ON r.table_schema = c.table_schema AND r.table_name = c.table_name AND r.column_name = 'run_id'
WHERE c.table_schema = 'public' AND c.data_type = 'timestamp with time zone'
ORDER BY 1, 2
"""

# One row in each run table the helpers don't write, every timestamp set
OTHER_ROWS = [
    """INSERT INTO labels (project_id, run_id, content_id, step_id, agent, origin, trust, sensitivity, at)
    VALUES (%(p)s, %(r)s, 'c1', %(s)s, 'billing', 'email:inbox', 'untrusted', 'internal', %(at)s)""",
    """INSERT INTO chunk_labels (project_id, event_id, run_id, step_id, agent, tool, origin, detector, chunk,
        text, label, probabilities, confidence, score, at, reviewed_at, leased_until)
    VALUES (%(p)s, %(e)s, %(r)s, %(s)s, 'billing', 'read_email', 'email:inbox', 'qwen', 0, 'text', 'benign',
        '{}', 0.9, 0.1, %(at)s, %(at)s + interval '1 minute', %(at)s + interval '2 minutes')""",
    """INSERT INTO agent_messages (project_id, event_id, run_id, step_id, kind, from_agent, to_agent, trust,
        sensitivity, at)
    VALUES (%(p)s, %(e)s, %(r)s, %(s)s, 'handoff', 'research', 'billing', 'trusted', 'internal', %(at)s)""",
    "INSERT INTO fleet_values (project_id, key, kind, field) VALUES (%(p)s, 'k1', 'iban', 'iban')",
    """INSERT INTO fleet_uses (project_id, key, run_id, agent, tool, blocked, at)
    VALUES (%(p)s, 'k1', %(r)s, 'billing', 'pay_invoice', false, %(at)s)""",
    "INSERT INTO run_counters (project_id, run_id, counter, updated_at) VALUES (%(p)s, %(r)s, 'steps', %(at)s)",
    """INSERT INTO message_records (project_id, ref, run_id, sender, depth, print, label, stored_at)
    VALUES (%(p)s, %(e)s, %(r)s, 'research', 0, %(print)s, '{}', %(at)s)""",
    """INSERT INTO memory_labels (project_id, print, store, run_id, agent, label, first_written_at, last_written_at)
    VALUES (%(p)s, %(print)s, 'notes', %(r)s, 'billing', '{}', %(at)s, %(at)s + interval '1 minute')""",
    """INSERT INTO approval_requests (project_id, id, run_id, step_id, agent, tool, args_hash, masked, opened_at,
        answer, decided_at, used_at)
    VALUES (%(p)s, 'apr_' || %(e)s, %(r)s, %(s)s, 'billing', 'pay_invoice', %(r)s, '{}', %(at)s,
        'once', %(at)s + interval '1 minute', %(at)s + interval '2 minutes')""",
    """INSERT INTO approval_waiters (project_id, ask_id, request_id, run_id, step_id, agent, since, last_beat_at,
        done_at)
    VALUES (%(p)s, %(e)s, 'apr_' || %(e)s, %(r)s, %(s)s, 'billing', %(at)s, %(at)s, %(at)s + interval '1 minute')""",
]


def backdate(conn: Connection) -> None:
    apply.run_file(conn, BACKDATE)


def stamps(conn: Connection, run_id: str) -> dict[str, list]:
    result = {}
    for table, column in conn.execute(RUN_COLUMNS).fetchall():
        query = sql.SQL("SELECT {c} FROM {t} WHERE run_id = %s ORDER BY {c}").format(
            c=sql.Identifier(column), t=sql.Identifier(table)
        )
        result[f"{table}.{column}"] = [value for (value,) in conn.execute(query, (run_id,))]
    return result


@pytest.fixture
def fresh(conn):
    """A project made 2 hours ago, and a run from an hour ago with a row in every run table."""
    start = now(conn) - timedelta(hours=1)
    project_id = project(conn, created_at=start - timedelta(hours=1))
    run_id = run(conn, project_id, at=start)
    model_call(conn, project_id, run_id, at=start + timedelta(seconds=1))
    step_id = tool_call(conn, project_id, run_id, at=start + timedelta(seconds=2))
    decision(conn, project_id, run_id, step_id, decision="block", at=start + timedelta(seconds=3))
    payment(conn, project_id, run_id, step_id, at=start + timedelta(seconds=4))
    later = start + timedelta(minutes=5)
    incident(conn, project_id, run_id, start + timedelta(seconds=3), run_after=later, leased_until=later)
    params = {"p": project_id, "r": run_id, "s": step_id, "e": hex_id(16), "print": hex_id(64), "at": later}
    for statement in OTHER_ROWS:
        conn.execute(statement, params)
    finish(conn, project_id, run_id, at=start + timedelta(minutes=10))
    return project_id, run_id


def test_every_timestamp_of_a_run_moves_together(conn, fresh):
    _, run_id = fresh
    before = stamps(conn, run_id)
    backdate(conn)
    after = stamps(conn, run_id)

    # The run has a value in every column, so a table the script misses fails here
    assert [column for column, values in before.items() if not any(values)] == []
    shifts = {new - old for column in before for old, new in zip(before[column], after[column]) if old is not None}
    assert len(shifts) == 1
    assert shifts.pop() < -timedelta(days=1)


def test_new_start_is_within_the_last_6_months(conn, fresh):
    _, run_id = fresh
    backdate(conn)
    day, today = conn.execute(
        "SELECT (started_at AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'UTC')::date FROM runs WHERE run_id = %s",
        (run_id,),
    ).fetchone()
    assert today - timedelta(days=182) <= day <= today - timedelta(days=2)


def test_runs_from_before_the_project_was_made_stay(conn, fresh):
    project_id, _ = fresh
    old_id = run(conn, project_id, at=now(conn) - timedelta(days=3))
    before = stamps(conn, old_id)
    backdate(conn)
    assert stamps(conn, old_id) == before


def test_a_second_run_moves_nothing(conn, fresh):
    _, run_id = fresh
    backdate(conn)
    once = stamps(conn, run_id)
    backdate(conn)
    assert stamps(conn, run_id) == once


def test_retention_keeps_moved_runs(conn, fresh):
    project_id, _ = fresh
    backdate(conn)
    days = conn.execute("SELECT retention_days FROM projects WHERE id = %s", (project_id,)).fetchone()[0]
    assert days >= 400


def test_runs_grow_and_follow_working_days(conn):
    project_id = project(conn, created_at=now(conn) - timedelta(hours=1))
    conn.execute(
        """INSERT INTO runs (project_id, run_id, agent, started_at, last_event_at)
        SELECT %s, md5(i::text), 'billing', now(), now() FROM generate_series(1, 2000) i""",
        (project_id,),
    )
    backdate(conn)
    recent, weekend, work_hours, oldest, newest = conn.execute(
        """SELECT
            avg((started_at > now() - interval '91 days')::int),
            avg((extract(isodow FROM started_at) > 5)::int),
            avg((extract(hour FROM started_at) BETWEEN 8 AND 17)::int),
            min(started_at::date), max(started_at::date)
        FROM runs WHERE project_id = %s""",
        (project_id,),
    ).fetchone()
    # A growth trend puts about 3 in 4 runs in the later half
    assert recent > 0.7
    # Weekdays only would be 0, no change 2 in 7
    assert 0.05 < weekend < 0.2
    assert work_hours > 0.85
    today = now(conn).date()
    assert oldest >= today - timedelta(days=182)
    assert newest <= today - timedelta(days=2)
