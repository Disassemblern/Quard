"""The report pages follow the standards in bi/README.md."""

import json
import re
from pathlib import Path

import pytest

PAGES = Path(__file__).parent.parent / "powerbi" / "Quard.Report" / "definition" / "pages"
NAMES = json.loads((PAGES / "pages.json").read_text(encoding="utf-8"))["pageOrder"]

# Page grid: 12 columns of 88 px, 16 px gutters, 24 px margins
COLUMN_X = {24 + n * 104 for n in range(12)}
WIDTHS = {n * 104 - 16 for n in range(1, 13)}
ROW_Y = {24, 104, 216, 464}

# No title bar: the text itself, the slicer header or the card labels say what they show
UNTITLED = {"textbox", "slicer", "cardVisual"}


def visuals(page: str) -> list[dict]:
    files = (PAGES / page / "visuals").glob("*/visual.json")
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]


def props(visual: dict, name: str) -> dict:
    return visual["visual"].get("visualContainerObjects", {}).get(name, [{}])[0].get("properties", {})


def literal(prop: dict) -> str:
    return prop.get("expr", {}).get("Literal", {}).get("Value", "")


def test_five_pages_in_order():
    pages = [json.loads((PAGES / n / "page.json").read_text(encoding="utf-8")) for n in NAMES]
    assert [p["displayName"] for p in pages] == ["Overview", "Security", "Engineering", "Finance", "Data quality"]
    assert all((p["width"], p["height"]) == (1280, 720) for p in pages)


@pytest.mark.parametrize("page", NAMES)
def test_at_most_eight_visuals_query_data(page):
    assert len([v for v in visuals(page) if v["visual"]["visualType"] != "textbox"]) <= 8


@pytest.mark.parametrize("page", NAMES)
def test_visuals_sit_on_the_grid(page):
    for v in visuals(page):
        pos = v["position"]
        assert pos["x"] in COLUMN_X and pos["y"] in ROW_Y, v["name"]
        assert pos["width"] in WIDTHS and pos["x"] + pos["width"] <= 1256, v["name"]
        assert pos["y"] + pos["height"] <= 696, v["name"]


@pytest.mark.parametrize("page", NAMES)
def test_alt_text_and_titles(page):
    for v in visuals(page):
        assert len(literal(props(v, "general").get("altText", {}))) > 10, v["name"]
        if v["visual"]["visualType"] not in UNTITLED:
            assert len(literal(props(v, "title").get("text", {}))) > 2, v["name"]


@pytest.mark.parametrize("page", NAMES)
def test_tab_order_follows_the_layout(page):
    placed = sorted(visuals(page), key=lambda v: v["position"]["tabOrder"])
    spots = [(v["position"]["y"], v["position"]["x"]) for v in placed]
    assert spots == sorted(spots)


@pytest.mark.parametrize("page", NAMES)
def test_slicers_are_synced(page):
    groups = {v["name"]: v["visual"].get("syncGroup", {}).get("groupName") for v in visuals(page)}
    assert groups["date-slicer"] == "Date" and groups["agent-slicer"] == "Agent"


def model_fields() -> set[tuple[str, str]]:
    name = r"'([^']+)'|([^\s=']+)"
    fields = set()
    for f in (PAGES.parents[2] / "Quard.SemanticModel" / "definition" / "tables").glob("*.tmdl"):
        text = f.read_text(encoding="utf-8")
        table = re.search(rf"^table (?:{name})", text, re.M)
        for m in re.finditer(rf"^\t(?:column|measure) (?:{name})", text, re.M):
            fields.add((table[1] or table[2], m[1] or m[2]))
    return fields


def field_refs(node):
    if isinstance(node, dict):
        entity = node.get("Expression", {}).get("SourceRef", {}).get("Entity")
        if entity and "Property" in node:
            yield entity, node["Property"]
        for value in node.values():
            yield from field_refs(value)
    elif isinstance(node, list):
        for value in node:
            yield from field_refs(value)


@pytest.mark.parametrize("page", NAMES)
def test_visuals_use_fields_that_exist(page):
    known = model_fields()
    for v in visuals(page):
        for ref in field_refs(v):
            assert ref in known, (v["name"], ref)


def test_report_uses_the_design_theme():
    design = json.loads((PAGES.parents[3] / "design" / "quard-theme.json").read_text(encoding="utf-8"))
    themes = PAGES.parents[1] / "StaticResources" / "RegisteredResources"
    (copy_path,) = themes.glob("Quard*.json")
    copy = json.loads(copy_path.read_text(encoding="utf-8"))
    # Power BI appends extra data colors to its copy
    assert copy["dataColors"][:6] == design["dataColors"]
    assert {**copy, "dataColors": None} == {**design, "dataColors": None}


def test_slicers_dont_filter_data_quality():
    page = json.loads((PAGES / "data-quality" / "page.json").read_text(encoding="utf-8"))
    off = {(i["source"], i["target"]) for i in page["visualInteractions"] if i["type"] == "NoFilter"}
    for slicer in ("date-slicer", "agent-slicer"):
        assert {(slicer, "kpi-card"), (slicer, "data-checks")} <= off
