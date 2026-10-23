#!/usr/bin/env python3
"""Export the upstream target-unit template and an editable WHMM flow; never install."""

import argparse
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
GAME = Path("/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III")
TEMPLATE_NAME = "target_unit_sets.experimental.wh3patchtemplate.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=GAME / "target_unit_sets/expanded",
                        help="Directory containing the upstream export_template.py and native sources")
    previous_deps = Path("/tmp/wh3-native-analysis-deps")
    parser.add_argument("--analysis-deps", type=Path,
                        default=previous_deps if (previous_deps / "capstone").is_dir()
                        else ROOT / ".cache/native-analysis-deps")
    parser.add_argument("--capacity", type=int, default=100000)
    parser.add_argument("--output", type=Path, default=ROOT / "native-patches/target-unit-sets")
    args = parser.parse_args()
    source = args.source.resolve()
    sys.path[:0] = [str(args.analysis_deps.resolve()), str(source)]
    spec = importlib.util.spec_from_file_location("target_unit_sets_export", source / "export_template.py")
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    template, report, cfi = upstream.export(args.capacity)
    package = template["native_patch"]["package"]
    if any(template["template"][key] != package[key] for key in ("id", "version")):
        raise ValueError("Upstream template identity must match native_patch.package; update export_template.py")
    if report["template_id"] != package["id"]:
        raise ValueError("Upstream report template_id must match native_patch.package.id")
    raw = (json.dumps(template, indent=2) + "\n").encode()
    report["template_sha256"] = upstream.sha(raw)
    template_path = args.output / "whmm_patch_templates" / TEMPLATE_NAME
    flow_path = args.output / "whmmflows/target_unit_sets.json"
    report_path = args.output / "target_unit_sets.report.json"
    cfi_path = args.output / "target_unit_sets.cfi.txt"
    for path in (template_path, flow_path, report_path, cfi_path):
        if path.exists():
            raise FileExistsError(path)
    flow = (ROOT / "docs/examples/target-unit-sets/flow.json").read_bytes()
    template_path.parent.mkdir(parents=True, exist_ok=True)
    flow_path.parent.mkdir(parents=True, exist_ok=True)
    template_path.write_bytes(raw)
    flow_path.write_bytes(flow)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    cfi_path.write_text(cfi, encoding="utf8")
    print(json.dumps({"template": str(template_path), "flow": str(flow_path),
                      "template_id": package["id"], "sha256": report["template_sha256"]}, indent=2))


if __name__ == "__main__":
    main()
