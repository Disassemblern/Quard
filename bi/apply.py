"""Runs the BI SQL.

python apply.py                    rebuilds the bi schema from sql/*.sql
python apply.py seed/backdate.sql  runs one file
python apply.py --drop             drops the bi schema
"""

import os
import sys
from pathlib import Path

import psycopg

HERE = Path(__file__).resolve().parent
SQL_DIR = HERE / "sql"


def load_env(path: Path) -> None:
    # Values already in the environment win, as in sandbox/lib/env.ts
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and not line.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


def drop(conn: psycopg.Connection) -> None:
    with conn.transaction():
        conn.execute("DROP SCHEMA IF EXISTS bi CASCADE")


def rebuild(conn: psycopg.Connection, folder: Path = SQL_DIR) -> list[str]:
    # One transaction: a broken file leaves the old schema in place
    files = sorted(folder.glob("*.sql"))
    with conn.transaction():
        conn.execute("DROP SCHEMA IF EXISTS bi CASCADE")
        for path in files:
            conn.execute(path.read_text(encoding="utf-8"))
    return [path.name for path in files]


def run_file(conn: psycopg.Connection, path: Path) -> None:
    with conn.transaction():
        conn.execute(path.read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    load_env(HERE / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Set DATABASE_URL in bi/.env or the environment.", file=sys.stderr)
        return 1
    with psycopg.connect(url, autocommit=True) as conn:
        if argv == ["--drop"]:
            drop(conn)
            print("Dropped the bi schema.")
        elif argv:
            # Relative to this folder, so it works from any directory
            path = HERE / argv[0]
            run_file(conn, path)
            print(f"Ran {path.name}.")
        else:
            names = rebuild(conn)
            print(f"Rebuilt the bi schema from {len(names)} files.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
