"""Turns the B11 exports in bi/perf into the before and after table for bi/README.md.

Run: uv run --directory bi python perf/summary.py
"""

import json
import statistics
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

PERF = Path(__file__).parent
PAGES = {
    "overview": "Overview",
    "security": "Security",
    "engineering": "Engineering",
    "finance": "Finance",
    "data-quality": "Data quality",
}
LIFECYCLE = "Visual Container Lifecycle"


def ms(event: dict) -> float:
    start, end = datetime.fromisoformat(event["start"]), datetime.fromisoformat(event["end"])
    return (end - start).total_seconds() * 1000


def page_visuals(path: Path) -> dict[str, tuple[str, float, float]]:
    """Per visual id: title, median DAX query ms and median total ms over the refreshes."""
    events = json.loads(path.read_text(encoding="utf-8-sig"))["events"]
    by_id = {e["id"]: e for e in events}

    def lifecycle(event: dict) -> dict:
        while event["name"] != LIFECYCLE:
            event = by_id[event["parentId"]]
        return event

    dax = defaultdict(float)
    for e in events:
        if e["name"] == "Execute DAX Query":
            dax[lifecycle(e)["id"]] += ms(e)
    runs = defaultdict(list)
    for e in events:
        if e["name"] == LIFECYCLE:
            runs[e["metrics"]["visualId"]].append(e)
    return {
        vid: (
            ls[0]["metrics"]["visualTitle"],
            statistics.median(dax[e["id"]] for e in ls),
            statistics.median(ms(e) for e in ls),
        )
        for vid, ls in runs.items()
    }


def model_metrics(vpax: Path) -> dict[str, tuple[float, str]]:
    with zipfile.ZipFile(vpax) as z:
        view = json.loads(z.read("DaxVpaView.json").decode("utf-8-sig"))
    tables, columns = view["Tables"], view["Columns"]
    auto = [t for t in tables if t.get("IsLocalDateTable") or t.get("IsTemplateDateTable")]
    big = max(columns, key=lambda c: c["TotalSize"])
    return {
        "Model size (MB)": (sum(t["TableSize"] for t in tables) / 1e6, ""),
        "Hidden auto date tables": (len(auto), ""),
        "Largest column (MB)": (big["TotalSize"] / 1e6, f"{big['TableName']}[{big['ColumnName']}]"),
    }


def folder_metrics(folder: Path) -> dict[str, tuple[float, str]]:
    if not (folder / "model.vpax").exists():
        return {}
    out = model_metrics(folder / "model.vpax")
    lines = (folder / "refresh.csv").read_text(encoding="utf-8-sig").splitlines()[1:]
    out["Full refresh (s)"] = (statistics.median(float(x.split(",")[1]) for x in lines), "")
    for stem, name in PAGES.items():
        visuals = page_visuals(folder / f"{stem}.json").values()
        out[f"{name}: DAX query total (ms)"] = (sum(v[1] for v in visuals), "")
        title, _, total = max(visuals, key=lambda v: v[2])
        out[f"{name}: slowest visual (ms)"] = (total, title)
    return out


def cell(label: str, value: tuple[float, str] | None) -> str:
    if value is None:
        return ""
    number, note = value
    fmt = ".1f" if "(MB)" in label else ".2f" if "(s)" in label else ",.0f"
    return f"{number:{fmt}}" + (f" ({note})" if note else "")


def table(before: dict, after: dict) -> str:
    rows = ["| Metric | Before | After | Change |", "| --- | --- | --- | --- |"]
    for label, b in before.items():
        a = after.get(label)
        change = f"{(a[0] - b[0]) / b[0]:+.0%}" if a else ""
        rows.append(f"| {label} | {cell(label, b)} | {cell(label, a)} | {change} |")
    return "\n".join(rows)


if __name__ == "__main__":
    print(table(folder_metrics(PERF / "before"), folder_metrics(PERF / "after")))
