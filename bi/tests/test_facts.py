from datetime import UTC, date, datetime, timedelta, timezone

import factories as f
import pytest
from psycopg import sql

# Fact, then its source rows
SOURCES = [
    ("fact_run", "SELECT count(*) FROM runs"),
    ("fact_model_call", "SELECT count(*) FROM steps WHERE kind = 'model_call'"),
    ("fact_tool_call", "SELECT count(*) FROM steps WHERE kind = 'tool_call'"),
    ("fact_decision", "SELECT count(*) FROM decisions"),
    ("fact_incident", "SELECT count(*) FROM incidents"),
    ("fact_payment", "SELECT count(*) FROM payments"),
]

DAYS = """SELECT
    (SELECT start_date FROM bi.fact_run WHERE run_id = %(run)s),
    (SELECT call_date FROM bi.fact_model_call WHERE run_id = %(run)s),
    (SELECT call_date FROM bi.fact_tool_call WHERE run_id = %(run)s),
    (SELECT decision_date FROM bi.fact_decision WHERE run_id = %(run)s),
    (SELECT opened_date FROM bi.fact_incident WHERE run_id = %(run)s),
    (SELECT payment_date FROM bi.fact_payment WHERE run_id = %(run)s)"""


def one(conn, query, params=()):
    return conn.execute(query, params).fetchone()


@pytest.mark.parametrize(("fact", "source"), SOURCES)
def test_one_fact_row_per_source_row(conn, sample, fact, source):
    rows = one(conn, sql.SQL("SELECT count(*) FROM bi.{}").format(sql.Identifier(fact)))[0]
    assert rows > 0
    assert rows == one(conn, source)[0]


def test_model_call_cost_and_tokens(conn):
    project_id = f.project(conn)
    run_id = f.run(conn, project_id)
    priced = f.model_call(conn, project_id, run_id)
    unpriced = f.model_call(conn, project_id, run_id, model="acme-ft-1", cost_usd=None)
    query = """SELECT cost_micro_usd, input_tokens, cached_tokens, output_tokens
        FROM bi.fact_model_call WHERE step_id = %s"""
    assert one(conn, query, (priced,)) == (1234, 1200, 200, 150)
    assert one(conn, query, (unpriced,)) == (None, 1200, 200, 150)


def test_dates_are_utc_days(conn):
    # 23:30 at UTC-2 is already 2 March in UTC
    at = datetime(2026, 3, 1, 23, 30, tzinfo=timezone(timedelta(hours=-2)))
    project_id = f.project(conn)
    run_id = f.run(conn, project_id, at=at)
    f.model_call(conn, project_id, run_id, at=at)
    step_id = f.tool_call(conn, project_id, run_id, at=at)
    f.decision(conn, project_id, run_id, step_id, decision="block", at=at)
    f.payment(conn, project_id, run_id, step_id, at=at)
    assert set(one(conn, DAYS, {"run": run_id})) == {date(2026, 3, 2)}


def test_run_outcome_and_duration(conn):
    start = datetime(2026, 3, 1, 12, tzinfo=UTC)
    project_id = f.project(conn)
    going = f.run(conn, project_id, at=start)
    f.tool_call(conn, project_id, going, at=start + timedelta(seconds=5))
    done = f.run(conn, project_id, at=start)
    f.finish(conn, project_id, done, at=start + timedelta(seconds=7))
    query = "SELECT outcome, duration_ms, step_count FROM bi.fact_run WHERE run_id = %s"
    assert one(conn, query, (going,)) == ("running", 5000, 1)
    assert one(conn, query, (done,)) == ("completed", 7000, 0)


def test_run_money_and_flags(conn):
    project_id = f.project(conn)
    run_id = f.run(conn, project_id, agent="procurement")
    f.model_call(conn, project_id, run_id, agent="procurement")
    step_id = f.tool_call(conn, project_id, run_id, tool="fetch_quote", status="blocked", agent="procurement")
    f.payment(conn, project_id, run_id, step_id, usd=0.25)
    calm = f.run(conn, project_id)
    query = """SELECT cost_micro_usd, cost_known, spend_micro_usd, spend_known, has_block, has_incident
        FROM bi.fact_run WHERE run_id = %s"""
    assert one(conn, query, (run_id,)) == (1234, True, 250000, True, True, False)
    assert one(conn, query, (calm,)) == (0, True, 0, True, False, False)

    f.decision(conn, project_id, run_id, step_id, decision="block", agent="procurement")
    assert one(conn, query, (run_id,))[-1] is True


def test_decision_block_flags(conn):
    project_id = f.project(conn)
    run_id = f.run(conn, project_id)
    step_id = f.tool_call(conn, project_id, run_id)
    ids = [
        f.decision(conn, project_id, run_id, step_id, decision="block"),
        f.decision(conn, project_id, run_id, step_id, decision="block", mode="observe"),
        f.decision(conn, project_id, run_id, step_id),
    ]
    query = "SELECT is_block, is_would_block FROM bi.fact_decision WHERE event_id = %s"
    assert [one(conn, query, (event_id,)) for event_id in ids] == [(True, False), (False, True), (False, False)]


def test_incident_category_and_origin(conn):
    project_id = f.project(conn)
    found, open_ = f.run(conn, project_id), f.run(conn, project_id)
    f.incident(conn, project_id, found, category="bad input", entry_origin="web:evil.example", spent_usd=0.0021)
    f.incident(conn, project_id, open_)
    query = """SELECT category, entry_origin_kind, spent_micro_usd
        FROM bi.fact_incident WHERE run_id = %s"""
    assert one(conn, query, (found,)) == ("bad input", "web", 2100)
    assert one(conn, query, (open_,)) == ("unknown", None, 0)


def test_payment_amount_and_value(conn):
    project_id = f.project(conn)
    run_id = f.run(conn, project_id, agent="procurement")
    step_id = f.tool_call(conn, project_id, run_id, tool="fetch_quote", agent="procurement")
    huge = 10**78 - 1
    unknown = f.payment(conn, project_id, run_id, step_id, usd=None, amount=huge)
    known = f.payment(conn, project_id, run_id, step_id, usd=0.01, amount=10000)
    query = "SELECT amount_atomic, value_micro_usd FROM bi.fact_payment WHERE event_id = %s"
    assert one(conn, query, (unknown,)) == (str(huge), None)
    assert one(conn, query, (known,)) == ("10000", 10000)
