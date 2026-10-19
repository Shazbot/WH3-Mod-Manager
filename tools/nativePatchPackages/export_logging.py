#!/usr/bin/env python3
"""Export the v7d native logger for WHMM, using the existing companion pack."""

import argparse
import base64
import bisect
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import sys
import tempfile

import export as shared


CODE_BASE = 0x10000000  # Export/link layout only; never a runtime address.
BACKEND_BASE = CODE_BASE + 32
BOOTSTRAP = "script/_lib/mod/wh3_ext_native_logging.lua"


class Image(shared.OriginalImage):
    def __init__(self, path, decoder):
        super().__init__(path)
        self.md = decoder
        self.executable = [(rva, self.data[raw:raw + raw_size] + bytes(size - raw_size))
                           for rva, size, raw_size, raw, flags in self.sections if flags & 0x20000000]
        pe = struct.unpack_from("<I", self.data, 0x3C)[0]
        pdata, length = struct.unpack_from("<II", self.data, pe + 24 + 136)
        self.runtime = list(struct.iter_unpack("<III", self.read(pdata, length)))
        self.starts = [entry[0] for entry in self.runtime]
        self.matches = {}

    def unique_signature(self, pattern):
        if pattern in self.matches:
            return self.matches[pattern]
        expression = re.compile(b"".join(b"." if token == "??" else re.escape(bytes.fromhex(token))
                                         for token in pattern.split()), re.DOTALL)
        found = []
        for rva, data in self.executable:
            offset = 0
            while (match := expression.search(data, offset)) is not None:
                found.append(rva + match.start())
                if len(found) > 1:
                    raise ValueError("Signature is ambiguous")
                offset = match.start() + 1  # Include overlapping matches.
        if len(found) != 1:
            raise ValueError("Signature is missing")
        self.matches[pattern] = found[0]
        return found[0]

    def function(self, rva):
        index = bisect.bisect_right(self.starts, rva) - 1
        if index >= 0:
            start, end, _ = self.runtime[index]
            if start <= rva < end and end - start <= 65536:
                return list(self.md.disasm(self.read(start, end - start), start))
        return list(self.md.disasm(self.read(rva, 256), rva))


def pattern_for(instructions, mask_branches=True):
    import capstone
    from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP

    result = []
    for instruction in instructions:
        tokens = [f"{byte:02X}" for byte in instruction.bytes]
        if any(op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP for op in instruction.operands):
            at, size = instruction.disp_offset, instruction.disp_size
            tokens[at:at + size] = ["??"] * size
        if mask_branches and (instruction.group(capstone.CS_GRP_CALL) or instruction.group(capstone.CS_GRP_JUMP)):
            if any(op.type == X86_OP_IMM for op in instruction.operands):
                at, size = instruction.imm_offset, instruction.imm_size
                tokens[at:at + size] = ["??"] * size
        # Avoid matching preferred-image absolute pointers, if present.
        if instruction.imm_size == 8 and any(op.type == X86_OP_IMM and op.imm >= 0x140000000 for op in instruction.operands):
            tokens[instruction.imm_offset:instruction.imm_offset + 8] = ["??"] * 8
        result.extend(tokens)
    return " ".join(result)


def signature(manifest, image, name, rva, callsite=False):
    if callsite:
        instructions = image.function(rva)
        index = next((i for i, insn in enumerate(instructions) if insn.address == rva), None)
        if index is None:
            raise ValueError(f"{name}: hook is not on an original instruction boundary")
        # Decode after the call as well, including noreturn padding/next entry.
        after = list(image.md.disasm(image.read(rva, 256), rva))
        candidates = []
        for before_count in (0, 4, 8, 16, 32):
            before = instructions[max(0, index - before_count):index]
            for after_count in (4, 8, 16, 32):
                candidates.append(before + after[:after_count])
        candidates.sort(key=lambda items: sum(insn.size for insn in items))
    else:
        instructions = list(image.md.disasm(image.read(rva, 160), rva))
        candidates = []
        for minimum in (12, 20, 28, 40, 56, 80, 112, 152):
            selected = []
            for instruction in instructions:
                selected.append(instruction)
                if instruction.address + instruction.size - rva >= minimum:
                    break
            candidates.append(selected)
    for masked in (True, False):
        for selected in candidates:
            pattern = pattern_for(selected, masked)
            try:
                if image.unique_signature(pattern) != selected[0].address:
                    continue
            except ValueError:
                continue
            manifest["signatures"].append({"id": name, "module": "game", "scope": "executable", "pattern": pattern})
            return {"signature": name, "offset": rva - selected[0].address}, {
                "signature_rva": hex(selected[0].address), "resolved_rva": hex(rva),
                "pattern_bytes": len(pattern.split()), "branch_displacements_masked": masked,
            }
    raise ValueError(f"{name}: could not form a unique signature")


def import_calls(image, imports):
    """Find genuine RIP-relative indirect CALLs to the original import slots."""
    wanted = {rva: name for name, rva in imports.items()}
    found = {name: [] for name in imports}
    for section_rva, data in image.executable:
        for match in re.finditer(b"\xff\x15", data):
            at = match.start()
            if at + 6 > len(data):
                continue
            rva = section_rva + at
            target = rva + 6 + struct.unpack_from("<i", data, at + 2)[0]
            name = wanted.get(target)
            if name and len(found[name]) < 4:
                instructions = image.function(rva)
                if any(insn.address == rva and insn.bytes[:2] == b"\xff\x15" for insn in instructions):
                    found[name].append(rva)
        if all(found.values()):
            break
    if any(not sites for sites in found.values()):
        raise ValueError(f"Missing original import CALLs: {[name for name, sites in found.items() if not sites]}")
    return found


def companion_asset(path, source):
    data = path.read_bytes()
    if data[:4] != b"PFH5":
        raise ValueError("Expected the v7d PFH5 companion pack")
    kind, references, references_size, count, index_size, _ = struct.unpack_from("<6I", data, 4)
    if (kind, references, references_size, count) != (3, 0, 0, 1):
        raise ValueError("Expected the v7d one-entry normal mod pack")
    length, compressed = struct.unpack_from("<IB", data, 28)
    end = data.index(b"\0", 33)
    name = data[33:end].decode("utf8").replace("\\", "/")
    payload = data[28 + index_size:]
    if name != BOOTSTRAP or compressed or len(payload) != length or payload != source.read_bytes():
        raise ValueError("Companion pack does not contain the exact v7d bootstrap source")
    return {"id": "logging_bootstrap", "virtual_path": BOOTSTRAP, "sha256": hashlib.sha256(payload).hexdigest(),
            "type": "pack_entry", "required": True}, hashlib.sha256(data).hexdigest()


def relocations(upstream, elf):
    selected = False
    result = []
    for line in upstream.run("readelf", "-rW", elf).splitlines():
        if line.startswith("Relocation section"):
            selected = "'.rela.payload'" in line
        if not selected or not re.match(r"^[0-9a-f]{16}\s", line):
            continue
        match = re.fullmatch(r"([0-9a-f]+)\s+[0-9a-f]+\s+(R_X86_64_\w+)\s+([0-9a-f]+)\s+(\S+)\s+([+-])\s+([0-9a-f]+)", line)
        if not match:
            raise ValueError(f"Unrecognized ELF relocation: {line}")
        offset, kind, value, name, sign, addend = match.groups()
        if kind not in ("R_X86_64_PC32", "R_X86_64_PLT32"):
            raise ValueError(f"Non-relative code relocation: {line}")
        result.append((int(offset, 16), int(value, 16), name, int(addend, 16) * (-1 if sign == "-" else 1)))
    if not result:
        raise ValueError("No retained backend relocations")
    return result


def blob_block(name, data, protection, alignment=16):
    return {"id": name, "size": len(data), "alignment": alignment, "protection": protection,
            "source": {"base64": base64.b64encode(data).decode("ascii"), "sha256": hashlib.sha256(data).hexdigest()}}


def check_package(manifest, image, upstream, source_code, records, state_rva, metadata, source_directory):
    """Compare manifest fixups against independent ELF relocation calculations."""
    code_size = len(source_code)
    state_size = next(block["size"] for block in manifest["blocks"] if block["id"] == "logging_state")

    def expected_code(code_at, state_at, module_base=0):
        expected = bytearray(source_code)
        for position, value, _, addend in records:
            if CODE_BASE <= value < CODE_BASE + code_size:
                target = code_at + value - CODE_BASE
            elif state_rva <= value <= state_rva + state_size:
                target = state_at + value - state_rva
            else:
                target = module_base + value
            struct.pack_into("<i", expected, position - CODE_BASE, target + addend - (code_at + position - CODE_BASE))
        for offset, target in ((0, upstream.IO), (16, upstream.CLOSE)):
            struct.pack_into("<i", expected, offset + 6, module_base + target + 5 - (code_at + offset + 10))
        return expected

    layouts = [(0x140000000, 0x10000000, 0x11000000),
               (0x7FF400000000, 0x20000000, 0x21000000),
               (0x180000000, 0x40000000, 0x42000000)]
    for module_base, code_rva, state_offset in layouts:
        locations = {"logging_code": module_base + code_rva, "logging_state": module_base + state_offset,
                     "logging_unwind": module_base + state_offset + 0x100000}

        def resolve(reference):
            if "signature" in reference:
                pattern = next(item["pattern"] for item in manifest["signatures"] if item["id"] == reference["signature"])
                return module_base + image.unique_signature(pattern) + reference.get("offset", 0)
            if "symbol" in reference:
                return resolve(manifest["symbols"][reference["symbol"]])
            if "block" in reference:
                return locations[reference["block"]] + reference["offset"]
            if "write" in reference:
                item = next(item for item in manifest["writes"] if item["id"] == reference["write"])
                return resolve(item["at"]) + reference["offset"]
            derived = reference["relative"]
            start = resolve(derived["from"])
            displacement = struct.unpack("<i", image.read(start - module_base + derived["operand_offset"], 4))[0]
            return start + derived["instruction_end_offset"] + displacement

        blocks = {}
        for block in manifest["blocks"]:
            source = block["source"]
            blocks[block["id"]] = bytearray(base64.b64decode(source["base64"])) if "base64" in source else bytearray(block["size"])
        writes = {item["id"]: bytearray.fromhex(item["bytes"]) for item in manifest["writes"]}
        for item in manifest["writes"]:
            expected = bytes.fromhex(item["expected"])
            if image.read(resolve(item["at"]) - module_base, len(expected)) != expected:
                raise ValueError("Manifest write expectations do not match the original image")
        for item in manifest["fixups"]:
            field = item["at"]
            destination = blocks[field["block"]] if "block" in field else writes[field["write"]]
            struct.pack_into("<i", destination, field["offset"], resolve(item["target"]) + item["addend"] - resolve(item["relative_to"]))
        if blocks["logging_code"] != expected_code(locations["logging_code"], locations["logging_state"], module_base):
            raise ValueError("Manifest code disagrees with independent ELF relocations")
        for item in manifest["writes"]:
            data = writes[item["id"]]
            target = resolve(item["at"]) + 5 + struct.unpack_from("<i", data, 1)[0]
            function = "logging_exit" if item["id"].startswith("exit_") else "logging_io" if item["id"] == "original_io" else "logging_close"
            function_offset = metadata["functions"][function][0] - metadata["code_rva"]
            if target != locations["logging_code"] + function_offset:
                raise ValueError("Relocated hook points at the wrong backend function")
            expected_opcode = 0xE8 if item["id"].startswith("exit_") else 0xE9
            if data[0] != expected_opcode or (len(data) == 6 and data[5] != 0x90):
                raise ValueError("Hook opcode/length changed")

    # Reproduce the code bytes of the existing validated v7d EXE, without
    # composing any other features or executing its entry point.
    candidate = source_directory / "Warhammer3.native-logging-v7d.exe"
    with candidate.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != metadata["sha256"]:
            raise ValueError("The reference v7d executable does not match its recorded hash")
        source.seek(0)
        headers = source.read(4096)
        pe = struct.unpack_from("<I", headers, 0x3C)[0]
        table = pe + 24 + struct.unpack_from("<H", headers, pe + 20)[0]
        for index in range(struct.unpack_from("<H", headers, pe + 6)[0]):
            rva, size, raw = struct.unpack_from("<III", headers, table + 40 * index + 12)
            offset = metadata["code_rva"] - rva
            if 0 <= offset and offset + code_size <= size:
                source.seek(raw + offset)
                reference = source.read(code_size)
                if reference != expected_code(metadata["code_rva"], metadata["state_rva"]):
                    raise ValueError("Reconstructed backend differs from the validated v7d executable")
                break
        else:
            raise ValueError("Reference logging code section is missing")
    return {"relocation_layouts_checked": len(layouts), "offline_v7d_code_equal": True}


def export(args, upstream, image, temporary):
    blob, values, state_rva, state_size, cfi = upstream.compile_backend(image, BACKEND_BASE, CODE_BASE, CODE_BASE + 16, temporary)
    elf = temporary / "logger-relocs.elf"
    upstream.run("ld", "--emit-relocs", "-T", temporary / "logger.ld", "-o", elf, temporary / "logger.o")
    records = relocations(upstream, elf)
    functions = {name: (start, size) for name, (start, size, kind) in values.items() if kind.lower() == "t" and size}
    metadata = json.loads((args.logging_source / "Warhammer3.native-logging-v7d.json").read_text())
    if state_size != metadata["state_size"] or set(functions) != set(metadata["functions"]):
        raise ValueError("Compiled logger differs from the documented v7d layout")
    for name, (start, size) in functions.items():
        old_start, old_size = metadata["functions"][name]
        if (start - CODE_BASE, size) != (old_start - metadata["code_rva"], old_size):
            raise ValueError(f"{name}: compiler layout changed from v7d")
    print(f"Compiled v7d backend: {len(blob)} bytes, {len(functions)} functions, {state_size} state bytes", flush=True)
    prefix = bytes.fromhex("48895c2408e900000000") + b"\x90" * 6
    source_code = prefix * 2 + blob
    code = bytearray(source_code)
    manifest = shared.package("wh3.native-logging", "1.0.1", "Buffered native Lua logging",
                              "Standalone v7d native logger; uses the existing wh3_native_logging.pack Lua companion.",
                              code, "logging_code", "native_logging/HANDOFF.md / v7d")
    manifest["on_failure"] = "silent"
    manifest["blocks"] = []
    manifest["runtime_functions"] = []
    manifest["validation"]["in_game_behavior"] = "The upstream v7d backend passed native Windows fixtures; neither upstream Lua activation nor this runtime package has been confirmed in-game."
    manifest["claims"] = [
        {"domain": "lua-io-library", "key": "wh3-native-logging-v2"},
        {"domain": "lua-file-wrapper", "key": BOOTSTRAP},
    ]
    report = {"source_exe_sha256": shared.ORIGINAL_SHA256, "source_revision": "v7d", "signatures": {},
              "functions": len(functions), "state_bytes": state_size, "elf_relocations": len(records)}
    resolved = {}

    def add(name, rva, callsite=False):
        reference, details = signature(manifest, image, name, rva, callsite)
        manifest["symbols"][name] = reference
        resolved[name] = rva
        report["signatures"][name] = details
        return shared.symbol(name)

    for name, rva in (("original_io", upstream.IO), ("original_close", upstream.CLOSE)):
        entry = add(name, rva)
        expected = image.read(rva, 5)
        if expected != prefix[:5]:
            raise ValueError("Unsupported Lua prolog trampoline")
        manifest["writes"].append({"id": name, "at": entry, "expected": expected.hex(), "bytes": "e900000000"})
        target_name = "logging_io" if name == "original_io" else "logging_close"
        manifest["fixups"].append(shared.fixup({"write": name}, 1,
            {"block": "logging_code", "offset": functions[target_name][0] - CODE_BASE}, 5))
        offset = 0 if name == "original_io" else 16
        # The trampoline saves RBX without changing it or RSP, then forwards into
        # the stock prolog. It has no live parent frame and needs no unwind entry.
        manifest["fixups"].append(shared.fixup({"block": "logging_code"}, offset + 6,
            {**manifest["symbols"][name], "offset": manifest["symbols"][name]["offset"] + 5}, offset + 10))

    for index, rva in enumerate(upstream.EXIT_CALLS):
        name = f"exit_{index + 1}"
        entry = add(name, rva, True)
        expected = image.read(rva, 6)
        if expected[:2] != b"\xff\x15" or rva + 6 + struct.unpack_from("<i", expected, 2)[0] != upstream.WIN["ExitProcess"]:
            raise ValueError("Unexpected original ExitProcess call")
        manifest["writes"].append({"id": name, "at": entry, "expected": expected.hex(), "bytes": "e80000000090"})
        manifest["fixups"].append(shared.fixup({"write": name}, 1,
            {"block": "logging_code", "offset": functions["logging_exit"][0] - CODE_BASE}, 5))
    manifest["symbols"]["win_ExitProcess"] = shared.relative(shared.symbol("exit_1"), 2, 6)
    resolved["win_ExitProcess"] = upstream.WIN["ExitProcess"]

    used_external = {name for _, _, name, _ in records if name.startswith(("lua_", "win_"))}
    imports = {name: upstream.WIN[name[4:]] for name in sorted(used_external) if name.startswith("win_") and name != "win_ExitProcess"}
    sites = import_calls(image, imports)
    for name, slot in imports.items():
        errors = []
        for rva in sites[name]:
            try:
                entry = add(name + "_call", rva, True)
                manifest["symbols"][name] = shared.relative(entry, 2, 6)
                resolved[name] = slot
                break
            except ValueError as error:
                errors.append(str(error))
        else:
            raise ValueError(f"{name}: no unique import-site signature: {errors}")
    for name in sorted(used_external):
        if name.startswith("lua_"):
            add(name, upstream.LUA[name])
    print(f"Resolved {len(manifest['signatures'])} unique game signatures", flush=True)

    instructions = []
    unwind = bytearray()
    for name, (start, size) in sorted(functions.items(), key=lambda item: item[1][0]):
        body = blob[start - BACKEND_BASE:start - BACKEND_BASE + size]
        decoded = list(image.md.disasm(body, start))
        if sum(insn.size for insn in decoded) != size:
            raise ValueError(f"{name}: incomplete instruction decoding")
        instructions.extend(decoded)
        unwind.extend(bytes(-len(unwind) % 4))
        at = len(unwind)
        unwind.extend(upstream.make_unwind(image, body, start))
        manifest["runtime_functions"].append({"begin": {"block": "logging_code", "offset": start - CODE_BASE},
            "end": {"block": "logging_code", "offset": start - CODE_BASE + size},
            "unwind": {"block": "logging_unwind", "offset": at}})

    consumed = set()
    state_end_references = 0
    for position, value, name, addend in records:
        instruction = next((insn for insn in instructions if insn.address <= position and position + 4 <= insn.address + insn.size), None)
        if instruction is None:
            raise ValueError(f"Relocation outside a decoded instruction: {position:#x}")
        if position in consumed:
            raise ValueError("Duplicate relocation field")
        consumed.add(position)
        field = position - CODE_BASE
        if struct.unpack_from("<i", code, field)[0] != value + addend - position:
            raise ValueError("Linked displacement does not agree with ELF relocation")
        end = instruction.address + instruction.size
        correction = addend + end - position
        target = value + correction
        if CODE_BASE <= value < CODE_BASE + len(code):
            if not CODE_BASE <= target < CODE_BASE + len(code):
                raise ValueError("Internal code reference escapes the payload")
            continue  # Same-block displacements are invariant under relocation.
        if state_rva <= value <= state_rva + state_size:
            offset = target - state_rva
            if not 0 <= offset <= state_size:
                raise ValueError("State reference escapes the zero block")
            state_end_references += offset == state_size
            target_ref = {"block": "logging_state", "offset": offset}
            correction = 0
        elif name in used_external:
            if value != resolved[name]:
                raise ValueError(f"Unexpected external symbol value: {name}")
            target_ref = shared.symbol(name)
        else:
            raise ValueError(f"Unaudited backend reference: {name}")
        item = shared.fixup({"block": "logging_code"}, field, target_ref, end - CODE_BASE)
        item["addend"] = correction
        manifest["fixups"].append(item)
        code[field:field + 4] = bytes(4)
    # Every inter-block or game-relative operand must have a retained ELF relocation.
    from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP
    for insn in instructions:
        for operand in insn.operands:
            if operand.type == X86_OP_MEM and operand.mem.base == X86_REG_RIP:
                target = insn.address + insn.size + operand.mem.disp
                if not CODE_BASE <= target < CODE_BASE + len(code) and insn.address + insn.disp_offset not in consumed:
                    raise ValueError("RIP-relative operand lacks an ELF relocation")
            if (insn.mnemonic == "call" or insn.mnemonic.startswith("j")) and operand.type == X86_OP_IMM:
                if not CODE_BASE <= operand.imm < CODE_BASE + len(code) and insn.address + insn.imm_offset not in consumed:
                    raise ValueError("External branch lacks an ELF relocation")
    if state_end_references == 0:
        raise ValueError("Expected the v7d one-past-stream-array sentinel relocation")
    asset, pack_hash = companion_asset(args.companion, args.logging_source / "bootstrap.lua")
    manifest["assets"] = [asset]
    manifest["blocks"] = [blob_block("logging_code", code, "rx"), blob_block("logging_unwind", unwind, "r", 4),
                          {"id": "logging_state", "size": state_size, "alignment": 32, "protection": "rw", "source": {"zero": True}}]
    report.update({"companion_pack_sha256": pack_hash, "bootstrap_sha256": asset["sha256"],
                   "code_bytes": len(code), "unwind_bytes": len(unwind), "fixups": len(manifest["fixups"]),
                   "one_past_state_references": state_end_references,
                   "source_c_sha256": hashlib.sha256((args.logging_source / "logger.c").read_bytes()).hexdigest()})
    report.update(check_package(manifest, image, upstream, source_code, records, state_rva, metadata, args.logging_source))
    return manifest, report, cfi


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, default=shared.GAME / "Warhammer3_orig.exe")
    parser.add_argument("--logging-source", type=Path, default=shared.GAME / "native_logging")
    parser.add_argument("--companion", type=Path, default=shared.GAME / "data/wh3_native_logging.pack")
    parser.add_argument("--output", type=Path, default=shared.ROOT / "native-patches")
    previous_deps = Path("/tmp/wh3-native-analysis-deps")
    parser.add_argument("--analysis-deps", type=Path,
                        default=previous_deps if (previous_deps / "capstone").is_dir()
                        else shared.ROOT / ".cache/native-analysis-deps")
    args = parser.parse_args()
    sys.path.insert(0, str(args.analysis_deps))
    import capstone

    spec = importlib.util.spec_from_file_location("native_logging_upstream", args.logging_source / "build.py")
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    decoder = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    decoder.detail = True
    image = Image(args.original, decoder)
    scratch = shared.ROOT / ".cache/native-logging-export"
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(dir=scratch) as temporary:
            manifest, report, _ = export(args, upstream, image, Path(temporary))
        destination = args.output / "whmm_patches/native_logging.wh3patch.json"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
        (args.output / "native-logging-build-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
        print(destination)
    finally:
        image.close()


if __name__ == "__main__":
    main()
