"""perf/summary.py turns the B11 exports into the README table."""

import json
import runpy
import zipfile
from pathlib import Path

from perf import summary


def at(ms: int) -> str:
    return f"2026-11-16T18:00:00.{ms:03d}Z"


def event(name: str, eid: str, start: int, end: int, parent: str | None = None, **metrics) -> dict:
    e = {"name": name, "id": eid, "start": at(start), "end": at(end), "metrics": metrics}
    return e | ({"parentId": parent} if parent else {})


def refresh(run: int, total: int, dax: int) -> list[dict]:
    """One refresh of a chart (DAX query nested two levels down) and a text box (no query)."""
    c, t = f"chart{run}", f"text{run}"
    return [
        {"name": "User Action", "id": f"ua{run}", "start": at(0), "metrics": {"sourceLabel": "UserAction_Refresh"}},
        event(summary.LIFECYCLE, c, 0, total, visualId="chart", visualTitle="Chart"),
        event("Query", f"q{run}", 0, 5, c),
        event("Execute Semantic Query", f"s{run}", 0, 5, f"q{run}"),
        event("Execute DAX Query", f"d{run}", 0, dax, f"s{run}"),
        event(summary.LIFECYCLE, t, 0, 10, visualId="text", visualTitle="Text box"),
    ]


def write_folder(folder: Path, chart_runs: list[tuple[int, int]], local_dates: int) -> None:
    folder.mkdir()
    events = [e for i, (total, dax) in enumerate(chart_runs) for e in refresh(i, total, dax)]
    for stem in summary.PAGES:
        (folder / f"{stem}.json").write_text(json.dumps({"version": "1.1.0", "events": events}), encoding="utf-8")
    (folder / "refresh.csv").write_text("run,seconds\n1,3.0\n2,9.0\n3,4.0\n", encoding="utf-8-sig")
    tables = [{"TableName": "Runs", "TableSize": 2_000_000}]
    tables += [{"TableName": f"L{n}", "TableSize": 500_000, "IsLocalDateTable": True} for n in range(local_dates)]
    columns = [
        {"TableName": "Runs", "ColumnName": "Run ID", "TotalSize": 1_500_000},
        {"TableName": "Runs", "ColumnName": "Outcome", "TotalSize": 100_000},
    ]
    with zipfile.ZipFile(folder / "model.vpax", "w") as z:
        z.writestr("DaxVpaView.json", json.dumps({"Tables": tables, "Columns": columns}))


def test_page_visuals_takes_medians_per_visual(tmp_path):
    write_folder(tmp_path / "f", [(100, 20), (300, 40), (200, 90)], 0)
    visuals = summary.page_visuals(tmp_path / "f" / "overview.json")
    assert visuals == {"chart": ("Chart", 40, 200), "text": ("Text box", 0, 10)}


def test_folder_metrics(tmp_path):
    write_folder(tmp_path / "f", [(100, 20), (300, 40), (200, 90)], 2)
    m = summary.folder_metrics(tmp_path / "f")
    assert m["Model size (MB)"] == (3.0, "")
    assert m["Hidden auto date tables"] == (2, "")
    assert m["Largest column (MB)"] == (1.5, "Runs[Run ID]")
    assert m["Full refresh (s)"] == (4.0, "")
    assert m["Overview: DAX query total (ms)"] == (40, "")
    assert m["Data quality: slowest visual (ms)"] == (200, "Chart")
    assert len(m) == 4 + 2 * len(summary.PAGES)


def test_empty_folder_has_no_metrics(tmp_path):
    assert summary.folder_metrics(tmp_path) == {}


def test_table_before_only_and_with_after(tmp_path):
    write_folder(tmp_path / "b", [(200, 40)], 2)
    write_folder(tmp_path / "a", [(150, 30)], 0)
    before, after = summary.folder_metrics(tmp_path / "b"), summary.folder_metrics(tmp_path / "a")
    lines = summary.table(before, {}).splitlines()
    assert lines[2] == "| Model size (MB) | 3.0 |  |  |"
    lines = summary.table(before, after).splitlines()
    assert lines[2] == "| Model size (MB) | 3.0 | 2.0 | -33% |"
    assert lines[3] == "| Hidden auto date tables | 2 | 0 | -100% |"
    assert lines[4] == "| Largest column (MB) | 1.5 (Runs[Run ID]) | 1.5 (Runs[Run ID]) | +0% |"
    assert lines[5] == "| Full refresh (s) | 4.00 | 4.00 | +0% |"
    assert lines[7] == "| Overview: slowest visual (ms) | 200 (Chart) | 150 (Chart) | -25% |"


def test_main_prints_the_table_from_the_real_exports(capsys):
    runpy.run_path(summary.__file__, run_name="__main__")
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "| Metric | Before | After | Change |"
    assert len(out) == 2 + 4 + 2 * len(summary.PAGES)
