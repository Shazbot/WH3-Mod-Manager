#!/usr/bin/env python3
"""Export independent v2 runtime packages; never write an executable or a pack."""

import argparse
import ast
import base64
import hashlib
import json
import mmap
from pathlib import Path
import re
import struct
import sys


ORIGINAL_SHA256 = "9bd58c63bd7fc5c9909b3d3d9b6b7a6ae4eac784369bf91a9e53c3e9f42be496"
UNWIND = bytes.fromhex("010b06000b3207d005c0037002600130")
GAME = Path("/mnt/k/SteamLibrary/steamapps/common/Total War WARHAMMER III")
PROJECT = Path("/mnt/k/projects/wh3-target-unit-extension")
ROOT = Path(__file__).resolve().parents[2]


class OriginalImage:
    def __init__(self, path):
        self.file = path.open("rb")
        self.data = mmap.mmap(self.file.fileno(), 0, access=mmap.ACCESS_READ)
        if hashlib.sha256(self.data).hexdigest() != ORIGINAL_SHA256:
            raise ValueError("Export requires the preserved, supported Warhammer3_orig.exe")
        pe = struct.unpack_from("<I", self.data, 0x3C)[0]
        if self.data[:2] != b"MZ" or self.data[pe:pe + 4] != b"PE\0\0":
            raise ValueError("Not a PE executable")
        if struct.unpack_from("<H", self.data, pe + 4)[0] != 0x8664:
            raise ValueError("Expected an AMD64 executable")
        self.base = struct.unpack_from("<Q", self.data, pe + 48)[0]
        table = pe + 24 + struct.unpack_from("<H", self.data, pe + 20)[0]
        self.sections = []
        for index in range(struct.unpack_from("<H", self.data, pe + 6)[0]):
            at = table + 40 * index
            virtual_size, rva, raw_size, raw = struct.unpack_from("<IIII", self.data, at + 8)
            flags = struct.unpack_from("<I", self.data, at + 36)[0]
            self.sections.append((rva, max(virtual_size, raw_size), raw_size, raw, flags))

    def read(self, rva, size):
        for start, _, raw_size, raw, _ in self.sections:
            offset = rva - start
            if 0 <= offset and offset + size <= raw_size:
                return self.data[raw + offset:raw + offset + size]
        raise ValueError(f"RVA {rva:#x} is not wholly backed by file data")

    def unique_signature(self, pattern):
        tokens = pattern.split()
        expression = re.compile(b"".join(
            b"." if token == "??" else re.escape(bytes.fromhex(token)) for token in tokens
        ), re.DOTALL)
        matches = []
        for rva, size, raw_size, raw, flags in self.sections:
            if not flags & 0x20000000:
                continue
            mapped = self.data[raw:raw + raw_size] + bytes(size - raw_size)
            # Lookahead counts overlapping matches, as the runtime scanner does.
            matches.extend(rva + match.start() for match in re.finditer(
                b"(?=" + expression.pattern + b")", mapped, re.DOTALL
            ))
        if len(matches) != 1:
            raise ValueError(f"Signature matches {len(matches)} executable locations, expected one")
        return matches[0]

    def close(self):
        self.data.close()
        self.file.close()


def emitted_source(path, function_name, **constants):
    """Load only the upstream assembly emitter, excluding its offline composition chain."""
    tree = ast.parse(path.read_text(encoding="utf8"), filename=str(path))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == function_name)
    namespace = dict(constants)
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[function_name]


def symbol(name):
    return {"symbol": name}


def relative(source, operand, end):
    return {"relative": {"from": source, "kind": "rel32", "operand_offset": operand, "instruction_end_offset": end}}


def fixup(destination, offset, target, anchor):
    return {"kind": "rel32", "at": {**destination, "offset": offset}, "target": target,
            "addend": 0, "relative_to": {**destination, "offset": anchor}}


def package(package_id, version, name, description, code, code_id, upstream):
    return {
        "format": "wh3-native-patch", "format_version": 2, "on_failure": "warn",
        "package": {"id": package_id, "version": version, "name": name, "description": description},
        "requires_loader": {"min_version": "2.1.0", "capabilities": [
            "blocks.v1", "fixups.v1", "win64-unwind.v1", "startup-activation.v1", "signatures.v2"
        ]},
        "target": {"id": "game", "filename": "Warhammer3.exe", "machine": "amd64"},
        "lifecycle": {"apply": "startup", "before": "game_initialization", "change": "restart", "lifetime": "process"},
        "allocation_policy": {"type": "module_window", "module": "game", "min_rva": "after_image", "max_rva_exclusive": "0x80000000"},
        "requires": [], "conflicts": [], "claims": [],
        "blocks": [
            {"id": code_id, "size": len(code), "alignment": 16, "protection": "rx", "source": {
                "base64": base64.b64encode(code).decode("ascii"), "sha256": hashlib.sha256(code).hexdigest()
            }},
            {"id": "unwind", "size": len(UNWIND), "alignment": 4, "protection": "r", "source": {
                "hex": UNWIND.hex(), "sha256": hashlib.sha256(UNWIND).hexdigest()
            }},
        ],
        "signatures": [], "symbols": {}, "guards": [], "writes": [], "fixups": [],
        "runtime_functions": [{"begin": {"block": code_id, "offset": 0},
                               "end": {"block": code_id, "offset": len(code)},
                               "unwind": {"block": "unwind", "offset": 0}}],
        "parameters": [], "assets": [],
        "validation": {
            "offline_behavior": f"Port of {upstream}; source code and unique signatures checked at export.",
            "in_game_behavior": "Upstream offline EXE behavior was user-confirmed for the documented Wizard Regiment scenario; this runtime package has not been tried in-game.",
            "runtime_delivery": "Requires WHMM native patch loader 2.1.0; no executable file edits.",
            "limitations": "Signature and exact hook-byte checks do not establish object-layout or gameplay compatibility with future builds.",
        },
    }


def add_signature(manifest, image, signature_id, pattern, expected_rva):
    found = image.unique_signature(pattern)
    if found != expected_rva:
        raise ValueError(f"{signature_id}: unexpected match at {found:#x}")
    manifest["signatures"].append({"id": signature_id, "module": "game", "pattern": pattern, "scope": "executable"})
    return {"signature": signature_id}


def export_projectile(image, project, assembler):
    # Assemble at zero; the only external branch is explicitly replaced by a fixup.
    emitter = emitted_source(project / "patch_spell_casters.py", "guard_source", ORIGINAL=0x100000)
    original = bytes(assembler.asm(emitter(), addr=0)[0])
    if len(original) != 337 or original[-5] != 0xE9 or 337 + struct.unpack_from("<i", original, 333)[0] != 0x100000:
        raise ValueError("Upstream caster code no longer matches the v5a relocation audit")
    code = original[:-4] + bytes(4)
    result = package("wh3.officer-projectile-casting", "5.1.1", "Officer-first projectile spell casting",
                     "v5a behavior: choose a living officer, otherwise the first living entity, for is_spell projectile actions; retain bursts and ordinary volleys.",
                     code, "caster_code", "PROJECTILE_CASTING.md / v5a")
    call = add_signature(result, image, "casting_init", (
        "48 8D 54 24 30 48 8B 43 10 48 8B 48 08 48 8B 01 FF 90 C8 05 00 00 "
        "48 83 C4 20 5B C3 48 8B CB E8 ?? ?? ?? ?? 48 83 C4 20 5B C3"
    ), 0x2F78AC4)
    tail = add_signature(result, image, "casting_update", (
        "48 8B CB 48 83 C4 20 5B E9 ?? ?? ?? ?? F6 C1 02 75 ?? "
        "48 8B CB E8 ?? ?? ?? ?? 8B 48 30 8A 83 D8 00 00 00"
    ), 0x2F88E36)
    result["symbols"] = {
        "init_transfer": {**call, "offset": 31}, "update_transfer": {**tail, "offset": 8},
        "stock_firing": relative(symbol("init_transfer"), 1, 5),
        "stock_update_firing": relative(symbol("update_transfer"), 1, 5),
    }
    prolog = image.read(0x2F7F448, 22).hex()
    result["guards"] = [
        {"id": "stock_firing_prolog", "at": symbol("stock_firing"), "expected": prolog},
        {"id": "stock_update_firing_prolog", "at": symbol("stock_update_firing"), "expected": prolog},
    ]
    for name, rva, opcode in [("init", 0x2F78AE3, 0xE8), ("update", 0x2F88E3E, 0xE9)]:
        expected = image.read(rva, 5)
        if expected[0] != opcode or rva + 5 + struct.unpack_from("<i", expected, 1)[0] != 0x2F7F448:
            raise ValueError(f"{name}: original CALL/tail JMP does not target the expected function")
        result["writes"].append({"id": name, "at": symbol(f"{name}_transfer"), "expected": expected.hex(),
                                 "bytes": (bytes([opcode]) + bytes(4)).hex()})
        result["fixups"].append(fixup({"write": name}, 1, {"block": "caster_code", "offset": 0}, 5))
    result["fixups"].append(fixup({"block": "caster_code"}, len(code) - 4, symbol("stock_firing"), len(code)))
    result["claims"] = [{"domain": "battle-firing-action", "key": "is_spell-single-source"}]
    return result, original


def export_officer(image, officer_source, example, assembler):
    emitter = emitted_source(officer_source, "source")
    code = bytes(assembler.asm(emitter(), addr=0)[0])
    if len(code) != 243 or code != (example / "officer_code.bin").read_bytes():
        raise ValueError("Upstream officer helper differs from the v7b verification example")
    result = package("wh3.officer-dead", "7.2.1", "Officer death ability restriction",
                     "v7b behavior: inspect active and removed officers; recognize kinds 1/2, ownership and alive state; preserve legacy fallback.",
                     code, "officer_code", "OFFICER_DEAD.md / v7b")
    case = add_signature(result, image, "officer_case", (
        "48 8B 46 48 44 39 A0 1C 05 00 00 0F 84 ?? ?? ?? ?? "
        "48 8B CE E8 ?? ?? ?? ?? 84 C0 0F 85 ?? ?? ?? ?? E9 ?? ?? ?? ??"
    ), 0x30DC9F4)
    result["symbols"] = {
        "case_start": case,
        "legacy_valid": relative(case, 34, 38),
        "boolean_epilogue": relative(symbol("legacy_valid"), 4, 8),
    }
    result["guards"] = [
        {"id": "legacy_valid_branch", "at": symbol("legacy_valid"), "expected": "418adee9"},
        {"id": "boolean_result", "at": symbol("boolean_epilogue"), "expected": "448af3"},
    ]
    # Replace complete instructions through the first JE (17 bytes). The old
    # stock-helper CALL remains untouched and unreachable from this case entry.
    # Its version-sensitive displacement therefore is not an exact write guard.
    expected = image.read(0x30DC9F4, 17)
    if expected.hex() != "488b46484439a01c0500000f84d1150000":
        raise ValueError("Unexpected officer case instruction boundaries")
    replacement = bytes.fromhex("4889f1e80000000088c3e9000000009090")
    result["writes"] = [{"id": "officer_case", "at": symbol("case_start"),
                          "expected": expected.hex(), "bytes": replacement.hex()}]
    result["fixups"] = [
        fixup({"write": "officer_case"}, 4, {"block": "officer_code", "offset": 0}, 8),
        fixup({"write": "officer_case"}, 11, symbol("boolean_epilogue"), 15),
    ]
    result["claims"] = [{"domain": "ability-invalid-usage-handler", "key": "0x3C", "name": "officer_dead"}]
    return result


def check_export(manifest, image, decoder, upstream_caster=None):
    """Resolve the actual v2 definitions and check every emitted relative transfer."""
    from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP

    signatures = {item["id"]: image.unique_signature(item["pattern"]) for item in manifest["signatures"]}
    code_block = manifest["blocks"][0]
    code = bytearray(base64.b64decode(code_block["source"]["base64"]))
    blocks = {code_block["id"]: 0x10000000, "unwind": 0x10010000}

    def resolve(reference):
        if "signature" in reference:
            return signatures[reference["signature"]] + reference.get("offset", 0)
        if "symbol" in reference:
            return resolve(manifest["symbols"][reference["symbol"]])
        if "block" in reference:
            return blocks[reference["block"]] + reference["offset"]
        if "write" in reference:
            return resolve(next(item["at"] for item in manifest["writes"] if item["id"] == reference["write"])) + reference["offset"]
        derived = reference["relative"]
        start = resolve(derived["from"])
        return start + derived["instruction_end_offset"] + struct.unpack("<i", image.read(start + derived["operand_offset"], 4))[0]

    for item in manifest["guards"] + manifest["writes"]:
        expected = bytes.fromhex(item["expected"])
        if image.read(resolve(item["at"]), len(expected)) != expected:
            raise ValueError(f"{item['id']}: original bytes do not match")
    writes = {item["id"]: bytearray.fromhex(item["bytes"]) for item in manifest["writes"]}
    for item in manifest["fixups"]:
        destination = code if "block" in item["at"] else writes[item["at"]["write"]]
        displacement = resolve(item["target"]) + item["addend"] - resolve(item["relative_to"])
        struct.pack_into("<i", destination, item["at"]["offset"], displacement)
    decoded = list(decoder.disasm(bytes(code), blocks[code_block["id"]]))
    if sum(instruction.size for instruction in decoded) != len(code):
        raise ValueError("Payload does not decode to complete instructions")
    external = []
    for instruction in decoded:
        for operand in instruction.operands:
            if operand.type == X86_OP_MEM and operand.mem.base == X86_REG_RIP:
                raise ValueError("Unexpected unaudited RIP-relative payload operand")
            if instruction.mnemonic in ("call", "jmp") or instruction.mnemonic.startswith("j"):
                if operand.type == X86_OP_IMM and not blocks[code_block["id"]] <= operand.imm < blocks[code_block["id"]] + len(code):
                    external.append(operand.imm)
    if upstream_caster is not None:
        if bytes(code[:-4]) != upstream_caster[:-4] or external != [0x2F7F448]:
            raise ValueError("Caster payload changed beyond its audited external JMP")
        if resolve(manifest["symbols"]["stock_update_firing"]) != 0x2F7F448:
            raise ValueError("Caster update target differs from the initialization target")
    elif external or resolve(manifest["symbols"]["boolean_epilogue"]) != 0x30DE25F:
        raise ValueError("Officer helper or derived epilogue changed")
    # Both helpers retain the upstream five-push + 32-byte-home-area prolog.
    if code[:11] != bytes.fromhex("535657415441554883ec20"):
        raise ValueError("Helper prolog differs from the declared unwind record")
    return {"package": manifest["package"], "signature_rvas": {name: hex(rva) for name, rva in signatures.items()},
            "write_rvas": {item["id"]: hex(resolve(item["at"])) for item in manifest["writes"]},
            "payload_bytes": len(code), "payload_sha256": code_block["source"]["sha256"],
            "source_exe_sha256": ORIGINAL_SHA256}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, default=GAME / "Warhammer3_orig.exe")
    parser.add_argument("--project", type=Path, default=PROJECT)
    parser.add_argument("--officer-source", type=Path, default=GAME / ".native-officer-fix/patch_officer_dead.py")
    parser.add_argument("--example", type=Path, default=GAME / "native-patch-format-v1/example-officer-dead")
    parser.add_argument("--output", type=Path, default=ROOT / "native-patches")
    parser.add_argument("--analysis-deps", type=Path, default=Path("/tmp/wh3-native-analysis-deps"))
    args = parser.parse_args()
    sys.path.insert(0, str(args.analysis_deps))
    import capstone
    from keystone import Ks, KS_ARCH_X86, KS_MODE_64

    assembler = Ks(KS_ARCH_X86, KS_MODE_64)
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    image = OriginalImage(args.original)
    try:
        projectile, original_caster = export_projectile(image, args.project, assembler)
        officer = export_officer(image, args.officer_source, args.example, assembler)
        report = [check_export(projectile, image, decoder, original_caster), check_export(officer, image, decoder)]
        destination = args.output / "whmm_patches"
        destination.mkdir(parents=True, exist_ok=True)
        for name, manifest in [("projectile_casting", projectile), ("officer_dead", officer)]:
            path = destination / f"{name}.wh3patch.json"
            path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
            print(path)
        (args.output / "build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    finally:
        image.close()


if __name__ == "__main__":
    main()
