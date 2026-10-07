#!/usr/bin/env python3
"""Check the companion design asset format without network calls or dependencies.

This is a static preflight, not Microsoft schema validation, a Power BI renderer,
a DAX/model test, an access test or an accessibility certification.
"""
import argparse
import itertools
import json
import math
import re
import sys
from pathlib import Path


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def color(value):
    return isinstance(value, str) and re.fullmatch(r"#[0-9A-Fa-f]{6}", value) is not None


def luminance(value):
    channels = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in channels]
    return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))


def contrast(a, b):
    lighter, darker = sorted((luminance(a), luminance(b)), reverse=True)
    return (lighter + .05) / (darker + .05)


def reject_constant(value):
    raise ValueError("Non-finite JSON number: " + value)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key: " + key)
        result[key] = value
    return result


class Review:
    def __init__(self):
        self.checks = []

    def add(self, key, passed, detail):
        self.checks.append({"check": key, "status": "Pass" if passed else "Fail", "evidence": detail})

    def untested(self, key, detail):
        self.checks.append({"check": key, "status": "Untested", "evidence": detail})

    def read(self, path):
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"),
                              parse_constant=reject_constant, object_pairs_hook=unique_object)
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object")
        except (OSError, ValueError, UnicodeError) as exc:
            self.add(str(path.name) + ":parse", False, str(exc))
            return None
        self.add(str(path.name) + ":parse", True, "JSON object parsed; no duplicate keys or non-finite literals")
        return data

    def layout(self, data, label):
        if data is None:
            return set()
        self.add(label + ":type", data.get("artifactType") == "layout-specification-not-pbir"
                 and data.get("specVersion") == "1.0", "Expected companion layout specification v1.0")
        canvas, regions = data.get("canvas"), data.get("regions")
        valid_canvas = isinstance(canvas, dict) and all(number(canvas.get(k)) and canvas[k] > 0 for k in ("width", "height"))
        self.add(label + ":canvas", valid_canvas, "Canvas width and height must be finite positive numbers")
        valid_regions = isinstance(regions, list) and len(regions) > 0
        self.add(label + ":regions", valid_regions, "At least one region is required")
        if not valid_canvas or not valid_regions:
            return set()
        names, rectangles = set(), []
        for index, region in enumerate(regions):
            key = f"{label}:region[{index}]"
            if not isinstance(region, dict):
                self.add(key, False, "Region must be an object")
                continue
            name = region.get("name")
            valid_name = isinstance(name, str) and bool(name.strip()) and name not in names
            self.add(key + ":name", valid_name, "Region name must be nonempty and unique")
            if not valid_name:
                continue
            names.add(name)
            valid_rect = all(number(region.get(k)) for k in ("x", "y", "width", "height"))
            valid_rect = valid_rect and region["x"] >= 0 and region["y"] >= 0 and region["width"] > 0 and region["height"] > 0
            self.add(key + ":geometry", valid_rect, "Finite nonnegative position and positive size required")
            if not valid_rect:
                continue
            inside = region["x"] + region["width"] <= canvas["width"] + 1e-7 and region["y"] + region["height"] <= canvas["height"] + 1e-7
            self.add(key + ":bounds", inside, name + " within canvas")
            rectangles.append(region)
        allowed, declarations = set(), data.get("allowedOverlaps", [])
        self.add(label + ":overlapDeclarations", isinstance(declarations, list), "Allowed overlaps must be a list of named pairs with reasons")
        if isinstance(declarations, list):
            for entry in declarations:
                pair = entry.get("regions") if isinstance(entry, dict) else None
                valid = isinstance(pair, list) and len(pair) == 2 and all(isinstance(n, str) and n in names for n in pair)
                valid = valid and pair[0] != pair[1] and isinstance(entry.get("reason"), str) and bool(entry["reason"].strip())
                self.add(label + ":overlapDeclaration", valid, "Intentional layering needs two existing names and a reason")
                if valid:
                    allowed.add(frozenset(pair))
        collisions = []
        for a, b in itertools.combinations(rectangles, 2):
            intersection = (min(a["x"] + a["width"], b["x"] + b["width"]) - max(a["x"], b["x"]) > 1e-7
                            and min(a["y"] + a["height"], b["y"] + b["height"]) - max(a["y"], b["y"]) > 1e-7)
            if intersection and frozenset((a["name"], b["name"])) not in allowed:
                collisions.append([a["name"], b["name"]])
        self.add(label + ":overlap", not collisions, {"unexplainedOverlaps": collisions})
        return names

    def tokens(self, data):
        if data is None:
            return
        self.add("tokens:type", data.get("artifactType") == "fabric-design-tokens"
                 and data.get("specVersion") == "1.0", "Expected companion design tokens v1.0")
        colors = data.get("colors")
        if not isinstance(colors, dict):
            self.add("tokens:colors", False, "Colors object is required")
            return
        pairs = [("text", "surface", 4.5), ("muted", "surface", 4.5),
                 ("text", "canvas", 4.5), ("muted", "canvas", 4.5),
                 ("brandText", "surface", 4.5), ("onBrand", "brand", 4.5),
                 ("brandChart", "surface", 3), ("positive", "surface", 4.5),
                 ("warning", "surface", 4.5), ("negative", "surface", 4.5)]
        for foreground, background, minimum in pairs:
            a, b = colors.get(foreground), colors.get(background)
            valid = color(a) and color(b)
            ratio = contrast(a, b) if valid else None
            self.add(f"contrast:{foreground}/{background}", valid and ratio >= minimum,
                     {"ratio": round(ratio, 4) if valid else None, "minimum": minimum,
                      "recomputed": True})
        series = data.get("seriesColors")
        valid = isinstance(series, list) and bool(series) and all(color(c) for c in series) and color(colors.get("surface"))
        self.add("tokens:series", valid, "Nonempty #RRGGBB series palette and surface required")
        if valid:
            ratios = [contrast(c, colors["surface"]) for c in series]
            self.add("contrast:series/surface", all(r >= 3 for r in ratios), {"ratios": [round(r, 4) for r in ratios], "minimum": 3})

    def theme(self, data, tokens):
        if data is None:
            return
        valid_name = isinstance(data.get("name"), str) and bool(data["name"].strip())
        palette = data.get("dataColors")
        self.add("theme:name", valid_name, "A nonempty theme name is required")
        self.add("theme:palette", isinstance(palette, list) and bool(palette) and all(color(c) for c in palette), "Base theme palette uses #RRGGBB colors")
        if isinstance(tokens, dict) and isinstance(tokens.get("colors"), dict):
            self.add("theme:tokenAlignment", palette == tokens.get("seriesColors")
                     and data.get("background") == tokens["colors"].get("surface")
                     and data.get("firstLevelElements") == tokens["colors"].get("text"),
                     "Theme palette, background and main text agree with design tokens")


def inspect(directory):
    review = Review()
    data = {name: review.read(directory / (name + ".json")) for name in
            ("powerbi-theme", "design-tokens", "desktop-layout", "mobile-layout")}
    desktop_names = review.layout(data["desktop-layout"], "desktop")
    mobile_names = review.layout(data["mobile-layout"], "mobile")
    if desktop_names and mobile_names:
        declared = data["desktop-layout"].get("mobileOrder")
        actual = [r.get("name") for r in data["mobile-layout"].get("regions", []) if isinstance(r, dict)]
        review.add("mobile:order", isinstance(declared, list) and declared == actual,
                   "Mobile regions follow the explicit desktop mobileOrder")
        review.add("mobile:coverage", mobile_names.issubset(desktop_names),
                   "Mobile component names resolve to desktop counterparts")
    review.tokens(data["design-tokens"])
    review.theme(data["powerbi-theme"], data["design-tokens"])
    for key, reason in (
        ("Visual fitness for the brief", "Requires rendered composition, typography, chart craft and mobile review against the design contract"),
        ("Microsoft schema", "Validate theme and any PBIR with the target version's official schemas separately"),
        ("Host rendering and interactions", "Open in Desktop/service/mobile; inspect labels, scaling, navigation and filter states"),
        ("Model, metrics and permissions", "Requires actual bindings, representative data and an authorized consumer session"),
        ("Complete accessibility and performance", "Requires keyboard/reader, selected-state and measured runtime checks")):
        review.untested(key, reason)
    failed = sum(c["status"] == "Fail" for c in review.checks)
    return {"scope": "static-design-assets-only", "result": "Fail" if failed else "Pass for static scope",
            "failedChecks": failed, "checks": review.checks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--report", type=Path, help="Optional new JSON evidence file")
    args = parser.parse_args()
    if args.report and args.report.exists():
        parser.error("Report already exists; choose a new output path")
    result = inspect(args.assets_dir)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["failedChecks"] else 0


if __name__ == "__main__":
    sys.exit(main())
