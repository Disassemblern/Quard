import os

import psycopg
import pytest
from psycopg.conninfo import make_conninfo

# Free text the bi views must never carry
FREE_TEXT = {
    "arguments",
    "body",
    "content",
    "detail",
    "error",
    "field",
    "find_error",
    "instructions",
    "reason",
    "replay",
    "resource",
    "reviewer",
    "url",
    "verdict",
}


def test_reader_reads_bi_and_nothing_in_public(conn, sample):
    conn.execute("SET LOCAL ROLE bi_reader")
    assert conn.execute("SELECT count(*) FROM bi.fact_run").fetchone()[0] > 0
    with pytest.raises(psycopg.errors.InsufficientPrivilege), conn.transaction():
        conn.execute("SELECT * FROM public.approval_requests")


@pytest.mark.skipif(not os.environ.get("BI_READER_PASSWORD"), reason="BI_READER_PASSWORD is not set")
def test_reader_signs_in_with_its_password(database):
    url = make_conninfo(database, user="bi_reader", password=os.environ["BI_READER_PASSWORD"])
    with psycopg.connect(url) as conn:
        assert conn.execute("SELECT current_user").fetchone()[0] == "bi_reader"
        assert conn.execute("SELECT count(*) FROM bi.dim_agent").fetchone()[0] >= 0


def test_views_carry_no_free_text(conn):
    columns = conn.execute(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'bi'"
    ).fetchall()
    assert len(columns) > 0
    assert [c for c in columns if c[1] in FREE_TEXT] == []
