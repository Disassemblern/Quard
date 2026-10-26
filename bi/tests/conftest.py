import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager

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
