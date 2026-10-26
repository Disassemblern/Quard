import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager

import factories as f
import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import make_conninfo

import apply

# The same files db/migrate/runner.ts runs, in name order
MIGRATIONS = apply.HERE.parent / "db" / "migrations"

apply.load_env(apply.HERE / ".env")


@contextmanager
def new_database() -> Iterator[str]:
    """A database with the app migrations and the bi schema, dropped at the end."""
    server = os.environ.get("TEST_DATABASE_URL")
    if not server:
        pytest.exit("Set TEST_DATABASE_URL in bi/.env or the environment.", returncode=1)
    name = f"quard_bi_test_{secrets.token_hex(4)}"
    with psycopg.connect(server, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        try:
            url = make_conninfo(server, dbname=name)
            with psycopg.connect(url, autocommit=True) as conn:
                for path in sorted(MIGRATIONS.glob("*.sql")):
                    apply.run_file(conn, path)
                apply.rebuild(conn)
            yield url
        finally:
            admin.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))


@pytest.fixture(scope="session")
def database() -> Iterator[str]:
    with new_database() as url:
        yield url


@pytest.fixture
def own_database() -> Iterator[str]:
    """For tests that commit, such as main()."""
    with new_database() as url:
        yield url


@pytest.fixture
def conn(database: str) -> Iterator[psycopg.Connection]:
    """Rolls back at the end, so tests never see each other's rows."""
    with psycopg.connect(database, autocommit=True) as conn, conn.transaction(force_rollback=True):
        yield conn


@pytest.fixture
def sample(conn: psycopg.Connection) -> str:
    """A small project with rows in every fact. Returns its id."""
    project_id = f.project(conn)

    blocked = f.run(conn, project_id)
    f.model_call(conn, project_id, blocked)
    f.model_call(conn, project_id, blocked, model="acme-ft-1", cost_usd=None)
    step_id = f.tool_call(conn, project_id, blocked, status="blocked")
    f.decision(conn, project_id, blocked, step_id, decision="block")
    f.finish(conn, project_id, blocked, outcome="blocked")
    # Agents and a tool seen only here, so the dimensions must read incidents
    roles = {"damage_agent": "payer", "entry_agent": "research", "turning_agent": "planner"}
    f.incident(conn, project_id, blocked, entry_origin="web:evil.example", damage_tool="send_email", **roles)

    paid = f.run(conn, project_id, agent="procurement")
    step_id = f.tool_call(conn, project_id, paid, tool="fetch_quote", agent="procurement")
    x402 = {"guard": "x402", "rule": "max-per-run", "tool": "fetch_quote", "agent": "procurement"}
    f.decision(conn, project_id, paid, step_id, **x402)
    f.payment(conn, project_id, paid, step_id)
    f.finish(conn, project_id, paid)

    conn.execute(
        "INSERT INTO agent_versions (project_id, agent, version, model) VALUES (%s, 'billing', %s, 'gpt-5.4-mini')",
        (project_id, f.hex_id(16)),
    )
    # The same agent in another project is another dimension row
    f.run(conn, f.project(conn, "Other project"))
    return project_id
