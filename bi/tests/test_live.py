import os

import psycopg
import pytest

import apply

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not os.environ.get("LIVE_DATABASE_URL"), reason="LIVE_DATABASE_URL is not set"),
]


def test_demo_data_passes_every_reconcile_and_rule_check():
    url = os.environ["LIVE_DATABASE_URL"]
    with psycopg.connect(url, autocommit=True) as conn, conn.transaction(force_rollback=True):
        # This working copy's views, rolled back at the end
        apply.rebuild(conn)
        rows = conn.execute(
            """SELECT check_name, kind, failing, total, rate, threshold, passed
            FROM bi.dq_checks ORDER BY kind, check_name"""
        ).fetchall()
    for name, kind, failing, total, rate, threshold, passed in rows:
        print(f"{kind:9} {name:26} {failing:>7} / {total:<7} rate {rate:<8} max {threshold:<6} passed {passed}")
    assert len(rows) > 0
    assert [row[0] for row in rows if row[1] != "monitor" and not row[-1]] == []
