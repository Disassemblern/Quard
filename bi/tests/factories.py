"""Test data, written the way ingest writes it.

Each item gets its events row, an enforced or observed block opens the
run's incident, and the run's totals are worked out again from the rows.
"""

import secrets
from datetime import datetime
from typing import Any

from psycopg import Connection, sql
from psycopg.types.json import Jsonb

USAGE = {"inputTokens": 1200, "cachedTokens": 200, "outputTokens": 150}

# refreshRuns in db/queries/ingest/store.ts
REFRESH = """
UPDATE runs SET
    model_calls = (SELECT count(*) FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id AND s.kind = 'model_call'),
    tool_calls = (SELECT count(*) FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id AND s.kind = 'tool_call'),
    blocked = (SELECT count(*) FROM (
        SELECT s.step_id FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id
            AND s.kind = 'tool_call' AND s.status = 'blocked'
        UNION
        SELECT d.step_id FROM decisions d
        WHERE d.project_id = runs.project_id AND d.run_id = runs.run_id AND d.guard = 'limit'
            AND d.rule IN ('max-steps', 'max-cost') AND d.enforced AND d.decision = 'block'
    ) b),
    cost_usd = coalesce((SELECT sum((s.detail ->> 'costUsd')::double precision) FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id AND s.kind = 'model_call'), 0),
    cost_known = NOT EXISTS (SELECT 1 FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id AND s.kind = 'model_call'
            AND s.status = 'ok' AND s.detail ->> 'costUsd' IS NULL),
    influenced = EXISTS (SELECT 1 FROM steps s
        WHERE s.project_id = runs.project_id AND s.run_id = runs.run_id AND s.influenced),
    flagged = EXISTS (SELECT 1 FROM labels l
        WHERE l.project_id = runs.project_id AND l.run_id = runs.run_id AND cardinality(l.flags) > 0),
    spend_usd = coalesce((SELECT sum(p.usd) FROM payments p
        WHERE p.project_id = runs.project_id AND p.run_id = runs.run_id AND p.stage = 'settled'), 0),
    spend_known = NOT EXISTS (SELECT 1 FROM payments p
        WHERE p.project_id = runs.project_id AND p.run_id = runs.run_id
            AND p.stage = 'settled' AND p.usd IS NULL)
WHERE project_id = %s AND run_id = %s
"""


def hex_id(chars: int) -> str:
    return secrets.token_hex(chars // 2)


def now(conn: Connection) -> datetime:
    return conn.execute("SELECT now()").fetchone()[0]


def event(conn: Connection, project_id: str, run_id: str, kind: str, agent: str, at: datetime, **body: Any) -> str:
    """The raw events row. The run's time span grows to include it."""
    event_id = hex_id(16)
    full = {"type": kind, "runId": run_id, "agent": agent, "at": at.isoformat(), **body}
    conn.execute(
        """INSERT INTO events (project_id, event_id, run_id, step_id, type, agent, at, body)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (project_id, event_id, run_id, body.get("stepId"), kind, agent, at, Jsonb(full)),
    )
    conn.execute(
        """UPDATE runs SET started_at = least(started_at, %s), last_event_at = greatest(last_event_at, %s)
        WHERE project_id = %s AND run_id = %s""",
        (at, at, project_id, run_id),
    )
    return event_id


def refresh(conn: Connection, project_id: str, run_id: str) -> None:
    conn.execute(REFRESH, (project_id, run_id))


def project(conn: Connection, name: str = "Test project", created_at: datetime | None = None) -> str:
    row = conn.execute(
        "INSERT INTO projects (name, created_at) VALUES (%s, coalesce(%s::timestamptz, now())) RETURNING id::text",
        (name, created_at),
    ).fetchone()
    return row[0]


def run(conn: Connection, project_id: str, agent: str = "billing", at: datetime | None = None) -> str:
    """A run that has started. finish() ends it."""
    run_id = hex_id(32)
    at = at or now(conn)
    conn.execute(
        "INSERT INTO runs (project_id, run_id, agent, started_at, last_event_at) VALUES (%s, %s, %s, %s, %s)",
        (project_id, run_id, agent, at, at),
    )
    event(conn, project_id, run_id, "run_started", agent, at, origins={})
    return run_id


def finish(
    conn: Connection, project_id: str, run_id: str, outcome: str = "completed", at: datetime | None = None
) -> None:
    at = at or now(conn)
    agent = conn.execute(
        "SELECT agent FROM runs WHERE project_id = %s AND run_id = %s", (project_id, run_id)
    ).fetchone()[0]
    event(conn, project_id, run_id, "run_finished", agent, at, status=outcome)
    conn.execute(
        "UPDATE runs SET ended_at = %s, outcome = %s WHERE project_id = %s AND run_id = %s",
        (at, outcome, project_id, run_id),
    )


def step(conn: Connection, project_id: str, run_id: str, kind: str, name: str, at: datetime | None, **row: Any) -> str:
    step_id = hex_id(16)
    at = at or now(conn)
    agent = row.pop("agent")
    event(conn, project_id, run_id, kind, agent, at, stepId=step_id)
    values = {"project_id": project_id, "run_id": run_id, "step_id": step_id, "kind": kind, "agent": agent}
    values = {**values, "name": name, "at": at, **row}
    query = sql.SQL("INSERT INTO steps ({}) VALUES ({})").format(
        sql.SQL(", ").join(map(sql.Identifier, values)),
        sql.SQL(", ").join(sql.Placeholder() * len(values)),
    )
    conn.execute(query, list(values.values()))
    refresh(conn, project_id, run_id)
    return step_id


def model_call(
    conn: Connection,
    project_id: str,
    run_id: str,
    model: str = "gpt-5.4-mini",
    cost_usd: float | None = 0.001234,
    usage: dict | None = USAGE,
    status: str = "ok",
    agent: str = "billing",
    at: datetime | None = None,
) -> str:
    """cost_usd None is a model with no price."""
    detail = {"responseId": f"resp_{hex_id(16)}", "toolCalls": [], "usage": usage, "costUsd": cost_usd}
    return step(
        conn,
        project_id,
        run_id,
        "model_call",
        model,
        at,
        agent=agent,
        status=status,
        duration_ms=800,
        detail=Jsonb(detail),
    )


def tool_call(
    conn: Connection,
    project_id: str,
    run_id: str,
    tool: str = "pay_invoice",
    status: str = "ok",
    influenced: bool = False,
    flagged: bool = False,
    agent: str = "billing",
    at: datetime | None = None,
) -> str:
    detail = {"arguments": {}, "keys": []}
    return step(
        conn,
        project_id,
        run_id,
        "tool_call",
        tool,
        at,
        agent=agent,
        status=status,
        influenced=influenced,
        flagged=flagged,
        duration_ms=50,
        call_id=f"call_{hex_id(16)}",
        detail=Jsonb(detail),
    )


def decision(
    conn: Connection,
    project_id: str,
    run_id: str,
    step_id: str,
    decision: str = "allow",
    mode: str = "block",
    guard: str = "action",
    rule: str = "iban",
    tool: str = "pay_invoice",
    agent: str = "billing",
    at: datetime | None = None,
) -> str:
    at = at or now(conn)
    enforced = mode == "block"
    event_id = event(conn, project_id, run_id, "decision", agent, at, stepId=step_id, decision=decision)
    conn.execute(
        """INSERT INTO decisions
            (project_id, event_id, run_id, step_id, agent, tool, guard, rule, decision, mode, enforced, at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (project_id, event_id, run_id, step_id, agent, tool, guard, rule, decision, mode, enforced, at),
    )
    if decision == "block":
        # openIncidents in db/queries/incidents/open.ts: the first one stays
        conn.execute(
            """INSERT INTO incidents (project_id, id, run_id, opened_at)
            VALUES (%s, 'inc_' || left(md5(%s || ':' || %s), 16), %s, %s)
            ON CONFLICT DO NOTHING""",
            (project_id, project_id, run_id, run_id, at),
        )
    refresh(conn, project_id, run_id)
    return event_id


def incident(conn: Connection, project_id: str, run_id: str, at: datetime | None = None, **fields: Any) -> str:
    """Opens the run's incident, or sets fields on it, such as category."""
    row = {"opened_at": at or now(conn), "find_state": "done", "review_state": "done", **fields}
    query = sql.SQL(
        """INSERT INTO incidents (project_id, id, run_id, {columns})
        VALUES (%s, 'inc_' || left(md5(%s || ':' || %s), 16), %s, {values})
        ON CONFLICT (project_id, run_id) DO UPDATE SET ({columns}) = ROW({excluded})
        RETURNING id"""
    ).format(
        columns=sql.SQL(", ").join(map(sql.Identifier, row)),
        values=sql.SQL(", ").join(sql.Placeholder() * len(row)),
        excluded=sql.SQL(", ").join(sql.SQL("excluded.{}").format(sql.Identifier(c)) for c in row),
    )
    params = [project_id, project_id, run_id, run_id, *row.values()]
    return conn.execute(query, params).fetchone()[0]


def payment(
    conn: Connection,
    project_id: str,
    run_id: str,
    step_id: str,
    stage: str = "settled",
    usd: float | None = 0.01,
    amount: int = 10000,
    delivered: bool | None = True,
    agent: str = "procurement",
    at: datetime | None = None,
) -> str:
    at = at or now(conn)
    event_id = event(conn, project_id, run_id, "payment", agent, at, stepId=step_id, stage=stage)
    conn.execute(
        """INSERT INTO payments (project_id, event_id, run_id, step_id, agent, stage, host, resource,
            x402_version, scheme, network, asset, amount, usd, pay_to, tx_hash, delivered, at)
        VALUES (%s, %s, %s, %s, %s, %s, 'quotes.example', '/quote', 1, 'exact', 'base-sepolia',
            '0x036cbd53842c5426634e7929541ec2318f3dcf7e', %s, %s, %s, %s, %s, %s)""",
        (
            project_id,
            event_id,
            run_id,
            step_id,
            agent,
            stage,
            amount,
            usd,
            "0x" + hex_id(40),
            "0x" + hex_id(64),
            delivered,
            at,
        ),
    )
    refresh(conn, project_id, run_id)
    return event_id
