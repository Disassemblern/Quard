from decimal import Decimal

import factories as f
import pytest

# One planted defect per check. %(p)s is the project id.
DEFECTS = {
    "run_cost_vs_model_calls": "UPDATE runs SET cost_usd = cost_usd + 0.01 WHERE project_id = %(p)s",
    "run_model_calls_vs_steps": "UPDATE runs SET model_calls = model_calls + 1 WHERE project_id = %(p)s",
    "run_tool_calls_vs_steps": "UPDATE runs SET tool_calls = tool_calls + 1 WHERE project_id = %(p)s",
    "run_spend_vs_payments": "UPDATE runs SET spend_usd = spend_usd + 1 WHERE project_id = %(p)s",
    "events_vs_steps": """DELETE FROM steps WHERE project_id = %(p)s AND step_id =
        (SELECT step_id FROM steps WHERE project_id = %(p)s AND kind = 'model_call' LIMIT 1)""",
    "events_vs_decisions": """DELETE FROM decisions WHERE project_id = %(p)s AND event_id =
        (SELECT event_id FROM decisions WHERE project_id = %(p)s LIMIT 1)""",
    "events_vs_payments": """DELETE FROM payments WHERE project_id = %(p)s AND event_id =
        (SELECT event_id FROM payments WHERE project_id = %(p)s LIMIT 1)""",
    "block_has_incident": "DELETE FROM incidents WHERE project_id = %(p)s",
    "incident_not_stuck": """UPDATE incidents SET find_state = 'pending', opened_at = now() - interval '1 hour'
        WHERE project_id = %(p)s""",
    "cost_unknown_share": "UPDATE runs SET cost_known = false WHERE project_id = %(p)s",
    "spend_unknown_share": "UPDATE runs SET spend_known = false WHERE project_id = %(p)s AND spend_usd > 0",
    "paid_not_delivered_share": """UPDATE payments SET delivered = false
        WHERE project_id = %(p)s AND stage = 'settled'""",
    "late_events_share": "UPDATE events SET degraded = true WHERE project_id = %(p)s",
    "dropped_events_share": "INSERT INTO upload_drops (project_id, batch_id, count, at) VALUES (%(p)s, 'b1', 1000, now())",
}


@pytest.fixture
def clean(conn) -> str:
    """A project every check passes on: a blocked run and a paid run."""
    project_id = f.project(conn)

    blocked = f.run(conn, project_id)
    f.model_call(conn, project_id, blocked)
    step_id = f.tool_call(conn, project_id, blocked, status="blocked")
    f.decision(conn, project_id, blocked, step_id, decision="block")
    f.finish(conn, project_id, blocked, outcome="blocked")

    paid = f.run(conn, project_id, agent="procurement")
    f.model_call(conn, project_id, paid, model="gpt-6-luna", cost_usd=0.5, agent="procurement")
    step_id = f.tool_call(conn, project_id, paid, tool="fetch_quote", agent="procurement")
    f.decision(conn, project_id, paid, step_id, tool="fetch_quote", agent="procurement")
    f.payment(conn, project_id, paid, step_id, stage="challenged", delivered=None)
    f.payment(conn, project_id, paid, step_id, usd=0.25)
    f.finish(conn, project_id, paid)
    return project_id


def checks(conn, project_id: str) -> dict[str, tuple]:
    rows = conn.execute(
        "SELECT check_name, failing, total, rate, passed FROM bi.dq_checks WHERE project_id = %s", (project_id,)
    ).fetchall()
    return {row[0]: row[1:] for row in rows}


def test_every_check_passes_on_clean_data(conn, clean):
    found = checks(conn, clean)
    assert set(found) == set(DEFECTS)
    assert [name for name, row in found.items() if not row[-1]] == []
    # Every check had something to count
    assert [name for name, row in found.items() if row[1] == 0] == []


def test_a_project_with_no_rows_passes(conn):
    found = checks(conn, f.project(conn))
    assert set(found.values()) == {(0, 0, 0, True)}


@pytest.mark.parametrize("check", DEFECTS)
def test_a_planted_defect_fails_its_check(conn, clean, check):
    conn.execute(DEFECTS[check], {"p": clean})
    failing, total, rate, passed = checks(conn, clean)[check]
    assert failing > 0
    assert not passed
    assert rate == round(Decimal(failing) / total, 6)


def test_control_totals(conn, clean):
    row = conn.execute(
        """SELECT source_runs, source_model_calls, source_tool_calls, source_decisions, source_blocks,
            source_incidents, source_cost_micro_usd, source_spend_micro_usd
        FROM bi.control_totals WHERE project_id = %s""",
        (clean,),
    ).fetchone()
    # 0.001234 + 0.5 USD of model calls, one settled payment of 0.25 USD
    assert row == (2, 2, 2, 2, 1, 1, 501234, 250000)
