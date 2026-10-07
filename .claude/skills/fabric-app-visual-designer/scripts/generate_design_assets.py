#!/usr/bin/env python3
"""Generate base Power BI theme, design tokens and desktop/mobile layout specs.

Python 3.9+ standard library only. Layout files are NOT PBIR or Power BI mobile
definitions. Theme import and visual rendering still require the target host.
"""
import argparse
import json
import re
from pathlib import Path

PALETTES = {
    "light": {"canvas": "#F4F6FA", "surface": "#FFFFFF", "text": "#172033", "muted": "#526077", "border": "#DCE2EC", "brand": "#2563EB", "positive": "#15803D", "warning": "#92400E", "negative": "#B91C1C"},
    "dark": {"canvas": "#0B1220", "surface": "#111C2E", "text": "#F1F5F9", "muted": "#A8B8CE", "border": "#314158", "brand": "#60A5FA", "positive": "#4ADE80", "warning": "#FBBF24", "negative": "#F87171"},
}
PRESETS = ("executive", "operations", "analysis")
FILENAMES = ("powerbi-theme.json", "design-tokens.json", "desktop-layout.json", "mobile-layout.json")


def hex_color(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise argparse.ArgumentTypeError("Color must use #RRGGBB format")
    return value.upper()


def luminance(color):
    values = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values]
    return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))


def contrast(a, b):
    bright, dark = sorted((luminance(a), luminance(b)), reverse=True)
    return (bright + .05) / (dark + .05)


def accessible_variant(color, surface, threshold):
    """Keep the supplied brand; return a separate same-hue usable variant."""
    if contrast(color, surface) >= threshold:
        return color
    target = max(("#FFFFFF", "#000000"), key=lambda v: contrast(v, surface))
    rgb = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    dest = [int(target[i:i + 2], 16) for i in (1, 3, 5)]
    for step in range(1, 101):
        t = step / 100
        candidate = "#" + "".join(f"{round(a + (b - a) * t):02X}" for a, b in zip(rgb, dest))
        if contrast(candidate, surface) >= threshold:
            return candidate
    return target


def rect(name, x, y, width, height):
    return {"name": name, "x": x, "y": y, "width": width, "height": height}


def layout_spec(width, height, regions, preset, surface):
    return {
        "artifactType": "layout-specification-not-pbir", "specVersion": "1.0",
        "surface": surface, "preset": preset, "units": "design-units",
        "canvas": {"width": width, "height": height}, "regions": regions,
        "allowedOverlaps": [],
        "notes": ["Map to supported host properties; not an importable report definition.",
                  "Region sizes include titles and labels; inspect actual text in the host."]
    }


def build(mode, brand=None, preset="executive", width=1440, height=900, kpis=0):
    if mode not in PALETTES or preset not in PRESETS:
        raise ValueError("Unknown mode or preset")
    if any(isinstance(v, bool) or not isinstance(v, int) for v in (width, height, kpis)):
        raise ValueError("Canvas dimensions and KPI count must be integers")
    if not 960 <= width <= 3840 or not 640 <= height <= 2160 or not 0 <= kpis <= 5:
        raise ValueError("Use width 960..3840, height 640..2160 and 0..5 KPIs")
    c = dict(PALETTES[mode])
    if brand:
        c["brand"] = hex_color(brand)
    c["onBrand"] = max(("#FFFFFF", "#000000"), key=lambda v: contrast(v, c["brand"]))
    c["brandText"] = accessible_variant(c["brand"], c["surface"], 4.5)
    c["brandChart"] = accessible_variant(c["brand"], c["surface"], 3.0)
    seeds = [c["brandChart"], "#0D9488", "#7C3AED", "#B45309", "#DB2777", "#64748B"]
    series = [accessible_variant(v, c["surface"], 3.0) for v in seeds]
    theme = {
        "name": "Fabric Base " + mode.title(), "dataColors": series,
        "background": c["surface"], "firstLevelElements": c["text"],
        "secondLevelElements": c["muted"], "thirdLevelElements": c["border"],
        "fourthLevelElements": c["muted"], "secondaryBackground": c["canvas"],
        "tableAccent": c["brandChart"], "good": c["positive"],
        "neutral": c["warning"], "bad": c["negative"],
        "textClasses": {key: {"fontSize": size, "fontFace": "Segoe UI", "color": c["text"]}
                        for key, size in (("label", 12), ("title", 14), ("header", 14), ("callout", 32))}
    }
    pairs = [
        ("body", "text", "surface", 4.5), ("secondary", "muted", "surface", 4.5),
        ("canvasText", "text", "canvas", 4.5), ("canvasSecondary", "muted", "canvas", 4.5),
        ("brandLabel", "brandText", "surface", 4.5), ("brandButton", "onBrand", "brand", 4.5),
        ("primarySeries", "brandChart", "surface", 3.0),
        ("favorableLabel", "positive", "surface", 4.5),
        ("warningLabel", "warning", "surface", 4.5),
        ("unfavorableLabel", "negative", "surface", 4.5),
    ]
    checks = [{"name": n, "foreground": f, "background": b, "minimum": minimum,
               "ratio": round(contrast(c[f], c[b]), 4), "pass": contrast(c[f], c[b]) >= minimum}
              for n, f, b, minimum in pairs]
    notes = ["Base theme only: position and format individual visuals separately.",
             "Brand text/chart variants preserve the original brand token.",
             "Series contrast is against the surface, not against every other series.",
             "Add labels/markers; palette checks do not establish color-vision accessibility.",
             "Border is decorative; use a contrast-qualified outline for an essential control.",
             "Authoring text sizes need target-host verification at actual viewing scale.",
             "cornerRadius, fontFamily and text classes are placeholders to be overridden from the design contract; they are not direction decisions."]
    if contrast(c["brand"], c["surface"]) < 3:
        notes.append("Brand fill needs an additional visible boundary when used as an essential control on the surface.")
    tokens = {
        "artifactType": "fabric-design-tokens", "specVersion": "1.0", "mode": mode,
        "colors": c, "seriesColors": series, "fontFamily": "Segoe UI",
        "spacing": [4, 8, 12, 16, 24, 32], "cornerRadius": 10,
        "contrastChecks": checks, "notes": notes
    }
    margin = 32 if width >= 1280 else 24
    gap = 24 if height >= 800 else 16
    content = width - margin * 2
    header_h, filter_h, kpi_h = 64, 48, (128 if height >= 800 else 104)
    filter_y = margin + header_h + gap
    kpi_y = filter_y + filter_h + gap
    chart_y = kpi_y + kpi_h + gap if kpis else kpi_y
    avail_h = height - margin - chart_y
    regions = [rect("header", margin, margin, content, header_h),
               rect("filters", margin, filter_y, content, filter_h)]
    unit = (content - (kpis - 1) * gap) / kpis if kpis else 0
    for i in range(kpis):
        left = round(margin + i * (unit + gap))
        right = round(margin + (i + 1) * unit + i * gap)
        regions.append(rect(f"kpi_{i + 1}", left, kpi_y, right - left, kpi_h))
    if preset == "operations":
        left_w = round((content - gap) * .64)
        right_x, right_w = margin + left_w + gap, content - left_w - gap
        top_h = (avail_h - gap) // 2
        regions += [rect("exceptions", margin, chart_y, left_w, avail_h),
                    rect("trend", right_x, chart_y, right_w, top_h),
                    rect("drivers", right_x, chart_y + top_h + gap, right_w, avail_h - top_h - gap)]
    elif preset == "analysis":
        top_h = round((avail_h - gap) * .56)
        left_w = round((content - gap) * .38)
        regions += [rect("trend", margin, chart_y, content, top_h),
                    rect("drivers", margin, chart_y + top_h + gap, left_w, avail_h - top_h - gap),
                    rect("exceptions", margin + left_w + gap, chart_y + top_h + gap,
                         content - left_w - gap, avail_h - top_h - gap)]
    else:
        top_h = round((avail_h - gap) * .60)
        left_w = round((content - gap) * .64)
        regions += [rect("trend", margin, chart_y, left_w, top_h),
                    rect("drivers", margin + left_w + gap, chart_y, content - left_w - gap, top_h),
                    rect("exceptions", margin, chart_y + top_h + gap, content, avail_h - top_h - gap)]
    desktop = layout_spec(width, height, regions, preset, "desktop")
    mobile_regions, mobile_y = [], 16
    mobile_order = ["header", "filters"] + [f"kpi_{i + 1}" for i in range(kpis)]
    mobile_order += ["exceptions", "trend", "drivers"] if preset == "operations" else ["trend", "drivers", "exceptions"]
    for name in mobile_order:
        h = 64 if name == "header" else 96 if name == "filters" else 112 if name.startswith("kpi_") else 280 if name == "exceptions" else 240
        mobile_regions.append(rect(name, 16, mobile_y, 358, h))
        mobile_y += h + 16
    mobile = layout_spec(390, mobile_y, mobile_regions, preset, "mobile")
    mobile["notes"] += ["390 design units are a conceptual width, not the Power BI mobile grid.",
                        "Use a short exception list and supported detail navigation, not a squeezed desktop table.",
                        "Prioritize or remove secondary metrics when the scroll becomes excessive."]
    desktop["mobileOrder"] = mobile_order
    return theme, tokens, desktop, mobile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=PALETTES, default="light")
    parser.add_argument("--brand", type=hex_color)
    parser.add_argument("--preset", choices=PRESETS, default="executive")
    parser.add_argument("--width", type=int, default=1440)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--kpis", type=int, choices=range(0, 6), default=0,
                        help="Separate KPI containers; zero omits the row (default)")
    parser.add_argument("--force", action="store_true", help="Replace generated files already in the output directory")
    args = parser.parse_args()
    try:
        payloads = build(args.mode, args.brand, args.preset, args.width, args.height, args.kpis)
    except ValueError as exc:
        parser.error(str(exc))
    paths = [args.output_dir / name for name in FILENAMES]
    existing = [p.name for p in paths if p.exists()]
    if existing and not args.force:
        parser.error("Output files already exist; choose a new directory or use --force: " + ", ".join(existing))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for path, payload in zip(paths, payloads):
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print("Created base theme, tokens and layout scaffolds. Visual design and host rendering remain untested.")


if __name__ == "__main__":
    main()
