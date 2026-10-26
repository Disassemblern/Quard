import runpy
from pathlib import Path

import psycopg
import pytest

import apply


def write(folder: Path, name: str, text: str) -> Path:
    path = folder / name
    path.write_text(text, encoding="utf-8")
    return path


def has_bi_schema(conn: psycopg.Connection) -> bool:
    return conn.execute("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bi')").fetchone()[0]


@pytest.fixture
def sql_dir(tmp_path: Path) -> Path:
    # 20 reads what 10 made, so it only works in name order
    write(tmp_path, "20_view.sql", "CREATE VIEW bi.v AS SELECT count(*) AS n FROM bi.t;")
    write(tmp_path, "10_table.sql", "CREATE SCHEMA bi; CREATE TABLE bi.t (id int);")
    write(tmp_path, "notes.txt", "not SQL")
    return tmp_path


def test_rebuild_runs_files_in_name_order(conn, sql_dir):
    assert apply.rebuild(conn, sql_dir) == ["10_table.sql", "20_view.sql"]
    assert conn.execute("SELECT n FROM bi.v").fetchone()[0] == 0


def test_rebuild_twice_starts_over(conn, sql_dir):
    apply.rebuild(conn, sql_dir)
    conn.execute("INSERT INTO bi.t VALUES (1)")
    apply.rebuild(conn, sql_dir)
    assert conn.execute("SELECT n FROM bi.v").fetchone()[0] == 0


def test_broken_file_keeps_the_old_schema(conn, sql_dir):
    apply.rebuild(conn, sql_dir)
    write(sql_dir, "30_broken.sql", "SELECT * FROM missing;")
    with pytest.raises(psycopg.errors.UndefinedTable):
        apply.rebuild(conn, sql_dir)
    assert conn.execute("SELECT n FROM bi.v").fetchone()[0] == 0


def test_drop(conn, sql_dir):
    apply.rebuild(conn, sql_dir)
    apply.drop(conn)
    assert not has_bi_schema(conn)


def test_run_file(conn, tmp_path):
    apply.run_file(conn, write(tmp_path, "one.sql", "CREATE TABLE one (id int); INSERT INTO one VALUES (7);"))
    assert conn.execute("SELECT id FROM one").fetchone()[0] == 7


def test_load_env_keeps_values_already_set(tmp_path, monkeypatch):
    monkeypatch.setenv("QUARD_BI_A", "from env")
    monkeypatch.delenv("QUARD_BI_B", raising=False)
    monkeypatch.delenv("QUARD_BI_C", raising=False)
    apply.load_env(write(tmp_path, ".env", "# QUARD_BI_C=comment\nQUARD_BI_A=file\nQUARD_BI_B = b=1 \n\n"))
    assert apply.os.environ["QUARD_BI_A"] == "from env"
    assert apply.os.environ["QUARD_BI_B"] == "b=1"
    assert "QUARD_BI_C" not in apply.os.environ


def test_load_env_without_a_file(tmp_path):
    apply.load_env(tmp_path / "missing.env")


def test_main_rebuilds_runs_a_file_and_drops(own_database, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", own_database)
    script = write(tmp_path, "one.sql", "CREATE SCHEMA bi; CREATE TABLE bi.t (id int);")

    assert apply.main([str(script)]) == 0
    with psycopg.connect(own_database) as conn:
        assert has_bi_schema(conn)

    assert apply.main([]) == 0
    assert "Rebuilt the bi schema from" in capsys.readouterr().out

    assert apply.main(["--drop"]) == 0
    with psycopg.connect(own_database) as conn:
        assert not has_bi_schema(conn)
    assert capsys.readouterr().out.splitlines()[-1] == "Dropped the bi schema."


def test_main_needs_database_url(monkeypatch, capsys):
    # Set but empty, so bi/.env can't fill it in
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setattr("sys.argv", ["apply.py"])
    with pytest.raises(SystemExit) as stop:
        runpy.run_path(str(apply.HERE / "apply.py"), run_name="__main__")
    assert stop.value.code == 1
    assert "DATABASE_URL" in capsys.readouterr().err
