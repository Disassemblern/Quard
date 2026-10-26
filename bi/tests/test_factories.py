import re

from factories import decision, finish, incident, model_call, payment, project, run, tool_call


def test_a_run_looks_like_ingest_stored_it(conn):
    project_id = project(conn)
    run_id = run(conn, project_id)
    model_call(conn, project_id, run_id)
    model_call(conn, project_id, run_id, model="acme-ft-1", cost_usd=None)
    step_id = tool_call(conn, project_id, run_id, status="blocked")
    decision(conn, project_id, run_id, step_id, decision="block")
    pay_id = tool_call(conn, project_id, run_id, tool="fetch_quote")
    payment(conn, project_id, run_id, pay_id, usd=0.25)
    payment(conn, project_id, run_id, pay_id, stage="signed")
    finish(conn, project_id, run_id, outcome="blocked")

    row = conn.execute(
        """SELECT model_calls, tool_calls, blocked, cost_usd, cost_known, spend_usd, outcome,
            ended_at >= started_at
        FROM runs WHERE run_id = %s""",
        (run_id,),
    ).fetchone()
    assert row == (2, 2, 1, 0.001234, False, 0.25, "blocked", True)

    # Every step, decision and payment has its raw event
    types = dict(conn.execute("SELECT type, count(*) FROM events WHERE run_id = %s GROUP BY 1", (run_id,)).fetchall())
    assert types == {"run_started": 1, "run_finished": 1, "model_call": 2, "tool_call": 2, "decision": 1, "payment": 2}
    assert re.fullmatch("[0-9a-f]{32}", run_id)
    assert re.fullmatch("[0-9a-f]{16}", step_id)


def test_a_block_opens_one_incident_and_incident_sets_fields(conn):
    project_id = project(conn)
    run_id = run(conn, project_id)
    step_id = tool_call(conn, project_id, run_id)
    decision(conn, project_id, run_id, step_id, decision="block", mode="observe")
    opened = conn.execute("SELECT opened_at FROM incidents WHERE run_id = %s", (run_id,)).fetchone()[0]
    decision(conn, project_id, run_id, step_id, decision="block")

    incident_id = incident(conn, project_id, run_id, opened, category="bad input")
    row = conn.execute("SELECT id, opened_at, category FROM incidents WHERE run_id = %s", (run_id,)).fetchall()
    assert row == [(incident_id, opened, "bad input")]
    assert re.fullmatch("inc_[0-9a-f]{16}", incident_id)
