from datetime import UTC, datetime, timedelta

import factories as f
import pytest
from psycopg import sql

DIMS = [("dim_agent", "agent"), ("dim_model", "model"), ("dim_tool", "tool"), ("dim_guard", "guard_rule")]

# Fact column, then the dimension it points to
FACT_KEYS = [
    ("fact_run", "agent", "dim_agent"),
    ("fact_model_call", "agent", "dim_agent"),
    ("fact_tool_call", "agent", "dim_agent"),
    ("fact_decision", "agent", "dim_agent"),
    ("fact_payment", "agent", "dim_agent"),
    ("fact_model_call", "model", "dim_model"),
    ("fact_tool_call", "tool", "dim_tool"),
    ("fact_decision", "tool", "dim_tool"),
    ("fact_decision", "guard_rule", "dim_guard"),
    ("fact_incident", "damage_agent", "dim_agent"),
    ("fact_incident", "entry_agent", "dim_agent"),
    ("fact_incident", "turning_agent", "dim_agent"),
    ("fact_incident", "damage_tool", "dim_tool"),
]


@pytest.mark.parametrize(("view", "key"), DIMS)
def test_dimension_keys_are_unique_and_set(conn, sample, view, key):
    query = sql.SQL(
        """SELECT count(*), count(DISTINCT (project_id, {key})), count(*) FILTER (WHERE {key} IS NULL)
        FROM bi.{view}"""
    ).format(key=sql.Identifier(key), view=sql.Identifier(view))
    rows, distinct, missing = conn.execute(query).fetchone()
    assert rows > 0
    assert (distinct, missing) == (rows, 0)


@pytest.mark.parametrize(("fact", "key", "dim"), FACT_KEYS)
def test_every_fact_key_is_in_its_dimension(conn, sample, fact, key, dim):
    query = sql.SQL(
        """SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM bi.{dim} d WHERE d.project_id = x.project_id AND d.{dim_key} = x.{key}
        ))
        FROM bi.{fact} x WHERE x.{key} IS NOT NULL"""
    ).format(
        fact=sql.Identifier(fact),
        dim=sql.Identifier(dim),
        key=sql.Identifier(key),
        dim_key=sql.Identifier(dict(DIMS)[dim]),
    )
    keys, missing = conn.execute(query).fetchone()
    assert keys > 0
    assert missing == 0


def test_agent_first_day_and_latest_version(conn):
    project_id = f.project(conn)
    first = datetime(2026, 3, 1, 23, 30, tzinfo=UTC)
    f.run(conn, project_id, at=first)
    f.run(conn, project_id, at=first + timedelta(days=3))
    for model, seen in [("gpt-5.1", first), ("gpt-5.4-mini", first + timedelta(days=2))]:
        conn.execute(
            """INSERT INTO agent_versions (project_id, agent, version, model, last_seen_at)
            VALUES (%s, 'billing', %s, %s, %s)""",
            (project_id, f.hex_id(16), model, seen),
        )
    f.run(conn, project_id, agent="support", at=first)

    rows = conn.execute(
        "SELECT agent, first_seen_date::text, current_model, versions FROM bi.dim_agent WHERE project_id = %s",
        (project_id,),
    ).fetchall()
    assert sorted(rows) == [("billing", "2026-03-01", "gpt-5.4-mini", 2), ("support", "2026-03-01", None, 0)]


def test_a_model_is_priced_when_a_call_has_a_cost(conn, sample):
    rows = conn.execute("SELECT model, is_priced FROM bi.dim_model WHERE project_id = %s", (sample,)).fetchall()
    assert sorted(rows) == [("acme-ft-1", False), ("gpt-5.4-mini", True)]


def test_guard_key_joins_guard_and_rule(conn, sample):
    rows = conn.execute("SELECT guard_rule, guard, rule FROM bi.dim_guard WHERE project_id = %s", (sample,)).fetchall()
    assert sorted(rows) == [("action / iban", "action", "iban"), ("x402 / max-per-run", "x402", "max-per-run")]
