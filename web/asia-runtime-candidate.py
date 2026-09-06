import argparse
import hashlib
import json
import runpy
import struct
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = "395732f4e1d07fec0f9d1b7c12322950a072e633"
SOURCE_SHA = "070f7347ce145f4d7e6e3fa645dbabeaa25214dbcf43e40c72148a929d6365ea"
BUILD_ID = "9C3116F0333EA157526612D17354B3755737C4F2"
TEXT_END = 0x84DAD0
RO_START = 0x84E000
UI_CAVE = TEXT_END
ENGAGE_CAVE = 0x84DE60
XP_CAVE = 0x84DEB0
MULTIPLIERS = (0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 10)
sys.dont_write_bytecode = True


def word(binary, offset):
    return struct.unpack_from("<I", binary, offset)[0]


def upstream(filename):
    folder = ROOT / ".tools/uosquad-upstream"
    path = folder / "Scripts" / filename
    expected = subprocess.check_output(["git", "-C", str(folder), "show", f"{PIN}:Scripts/{filename}"])
    if path.read_bytes() != expected:
        raise ValueError(f"上游生成器不是固定版本：{filename}")
    return runpy.run_path(str(path))


def validate_source(binary):
    if hashlib.sha256(binary).hexdigest() != SOURCE_SHA:
        raise ValueError("仅接受已核验的亚洲版 v1.0.5 未修改 main.dec；不接受压缩 NSO 或其他版本")
    assert binary[:4] == b"NSO0" and word(binary, 0xC) == 0x38
    assert binary[0x40:0x54].hex().upper() == BUILD_ID
    assert struct.unpack_from("<III", binary, 0x10) == (0x100, 0, TEXT_END)
    assert struct.unpack_from("<III", binary, 0x20)[:2] == (RO_START + 0x100, RO_START)
    assert not any(binary[TEXT_END + 0x100:RO_START + 0x100])
    for offset, digest in ((0x10, 0xA0), (0x20, 0xC0), (0x30, 0xE0)):
        start, _, size = struct.unpack_from("<III", binary, offset)
        assert hashlib.sha256(binary[start:start + size]).digest() == binary[digest:digest + 32]


def build(binary, multiplier, levels):
    validate_source(binary)
    if multiplier is not None and multiplier not in MULTIPLIERS:
        raise ValueError("不支持的经验倍率")
    if multiplier is None and not levels:
        raise ValueError("至少选择一种运行时修改")
    patches = {}
    hooks = {}

    def add(address, instruction):
        if address in patches and patches[address] != instruction:
            raise ValueError(f"补丁冲突：{address:X}")
        patches[address] = instruction

    def hook(address, original, instruction):
        assert word(binary, address + 0x100) == original, f"钩子不匹配：{address:X}"
        hooks[address] = original
        add(address, instruction)

    level = upstream("gen_enemy_level_scale.py")
    context = level["build_ui_cave"].__globals__
    context.update(BIN=binary[0x100:], CAVE=UI_CAVE, ENGAGE_CAVE=ENGAGE_CAVE,
                   AVG=0x2FD630, NUMDRAW_MOV=0x5C9984,
                   AVG_LRS=[address if address < 0x300000 else address - 0x10 for address in level["AVG_LRS"]])
    assert level["collect_count"]() == 103
    for address in context["AVG_LRS"]:
        instruction = word(binary, address - 4 + 0x100)
        immediate = instruction & 0x3FFFFFF
        if immediate & 0x2000000:
            immediate -= 0x4000000
        assert instruction >> 26 == 0x25 and address - 4 + immediate * 4 == 0x5C9970
    for index, expected in level["FLOOR_STAGES"] + level["SKIP_STAGES"]:
        assert word(binary, 0x28C19F8 + index * 0x50 + 0xC + 0x100) == expected
    if levels:
        ui = level["build_ui_cave"]()
        engage = level["build_engage_cave"]()
        assert UI_CAVE + len(ui) * 4 <= ENGAGE_CAVE
        assert ENGAGE_CAVE + len(engage) * 4 <= XP_CAVE
        for base, instructions in ((UI_CAVE, ui), (ENGAGE_CAVE, engage)):
            for index, instruction in enumerate(instructions):
                add(base + index * 4, instruction)
        hook(0x5C9984, 0x2A0103F4, level["bl"](0x5C9984, UI_CAVE))
        hook(0x199AF0, 0xB95BC688, level["bl"](0x199AF0, ENGAGE_CAVE))
    xp = upstream("gen_xp_scale.py")
    if multiplier is not None:
        cursor = XP_CAVE
        for address, original, kind, source, destination, continuation in xp["HOOKS"]:
            instructions = xp["build_cave"](cursor, kind, source, destination, multiplier, continuation, original)
            hook(address, original, xp["b_inst"](address, cursor))
            for index, instruction in enumerate(instructions):
                add(cursor + index * 4, instruction)
            cursor = (cursor + len(instructions) * 4 + 15) & ~15
    text_end = max(address + 4 for address in patches)
    assert TEXT_END < text_end <= RO_START
    assert all(address in hooks or TEXT_END <= address < RO_START for address in patches)
    result = bytearray(binary)
    for address, instruction in patches.items():
        struct.pack_into("<I", result, address + 0x100, instruction)
    struct.pack_into("<I", result, 0x18, text_end)
    struct.pack_into("<I", result, 0x60, text_end)
    result[0xA0:0xC0] = hashlib.sha256(result[0x100:0x100 + text_end]).digest()
    assert result[RO_START + 0x100:] == binary[RO_START + 0x100:]
    return bytes(result), patches, xp, context


def verify(binary):
    sys.path.insert(0, str(ROOT / ".tools/asia-runtime-validation/vendor"))
    import unicorn
    from unicorn import arm64_const as registers
    checks = 0
    stack, heap = 0x10000000, 0x11000000
    xregs = [getattr(registers, f"UC_ARM64_REG_X{index}") for index in range(31)]

    level_only, level_patches, _, _ = build(binary, None, True)
    assert len(level_only) == len(binary)
    for invalid in (binary[:-1], bytes(1) + binary[1:]):
        try:
            validate_source(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError("必须拒绝损坏的输入")

    for multiplier in MULTIPLIERS:
        patched, patches, xp, level = build(binary, multiplier, True)
        xp_only, xp_patches, _, _ = build(binary, multiplier, False)
        assert not level_patches.keys() & xp_patches.keys()
        assert patches == level_patches | xp_patches
        for candidate in (patched, xp_only, level_only):
            assert len(candidate) == len(binary)
            assert candidate[0x40:0x60] == binary[0x40:0x60]
            assert word(candidate, 0x18) == word(candidate, 0x60)
            for offset, digest in ((0x10, 0xA0), (0x20, 0xC0), (0x30, 0xE0)):
                start, _, size = struct.unpack_from("<III", candidate, offset)
                assert hashlib.sha256(candidate[start:start + size]).digest() == candidate[digest:digest + 32]
        for base in (0, 0x7100000000):
            cpu = unicorn.Uc(unicorn.UC_ARCH_ARM64, unicorn.UC_MODE_ARM)
            pages = {address & ~0xFFF for address in patches} | {0x19000, 0x2FD000}
            for page in pages:
                cpu.mem_map(base + page, 0x1000, unicorn.UC_PROT_READ | unicorn.UC_PROT_EXEC)
                loaded_end = min(page + 0x1000, word(patched, 0x18))
                cpu.mem_write(base + page, patched[page + 0x100:loaded_end + 0x100])
            cpu.mem_map(stack, 0x10000, unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE)
            cpu.mem_map(heap, 0x4000, unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE)
            cpu.mem_map(base + 0x28C1000, 0x4000, unicorn.UC_PROT_READ | unicorn.UC_PROT_WRITE)
            state = {"average": 30, "singleton": True, "average_calls": 0}

            def external(machine, address, size, user_data):
                if address == base + 0x19684:
                    machine.reg_write(xregs[0], heap if state["singleton"] else 0)
                    machine.reg_write(registers.UC_ARM64_REG_PC, machine.reg_read(xregs[30]))
                elif address == base + 0x2FD630:
                    assert machine.reg_read(xregs[1]) == 10
                    state["average_calls"] += 1
                    machine.reg_write(xregs[0], state["average"])
                    machine.reg_write(registers.UC_ARM64_REG_PC, machine.reg_read(xregs[30]))

            cpu.hook_add(unicorn.UC_HOOK_CODE, external)

            def reset():
                for index, register in enumerate(xregs):
                    cpu.reg_write(register, 0x12340000 + index)
                cpu.reg_write(registers.UC_ARM64_REG_SP, stack + 0x8000)
                cpu.reg_write(registers.UC_ARM64_REG_NZCV, 0)
                cpu.reg_write(xregs[26], heap)
                state.update(singleton=True, average_calls=0)

            for address, original, kind, source, destination, continuation in xp["HOOKS"]:
                for amount in (0, 1, 2, 9, 100, 65535, 0xFFFFFFFF):
                    reset()
                    cpu.reg_write(xregs[source], amount)
                    total = amount
                    if kind == "add_then_scale":
                        cpu.reg_write(xregs[23], 3)
                        cpu.reg_write(xregs[0], amount)
                        total = (amount + 3) & 0xFFFFFFFF
                    ratio = Fraction(str(multiplier))
                    expected = ((total * ratio.numerator) & 0xFFFFFFFF) // ratio.denominator
                    if total and not expected:
                        expected = 1
                    cpu.emu_start(base + address, base + continuation, count=100)
                    assert cpu.reg_read(registers.UC_ARM64_REG_PC) == base + continuation
                    assert cpu.reg_read(xregs[destination]) == expected
                    if kind == "str_1d84_x26":
                        assert word(cpu.mem_read(heap + 0x1D84, 4), 0) == expected
                    assert cpu.reg_read(registers.UC_ARM64_REG_SP) == stack + 0x8000
                    checks += 1
            if multiplier != 1:
                continue
            for average in (1, 30, 40, 50, 99):
                for caller in level["AVG_LRS"] + [0x123456]:
                    for digit in (13, 20, 38, 40, 45):
                        reset()
                        state["average"] = average
                        cpu.reg_write(xregs[1], digit)
                        cpu.reg_write(xregs[30], base + 0x5C9988)
                        cpu.mem_write(stack + 0x8008, struct.pack("<Q", base + caller))
                        original_levels = b"".join(struct.pack("<I", 22) + bytes(0x4C) for _ in range(103))
                        cpu.mem_write(base + 0x28C1A04, original_levels)
                        cpu.emu_start(base + 0x5C9984, base + 0x5C9988, count=3000)
                        assert cpu.reg_read(registers.UC_ARM64_REG_PC) == base + 0x5C9988
                        assert cpu.reg_read(registers.UC_ARM64_REG_SP) == stack + 0x8000
                        expected_digit = digit
                        if caller in level["STICKER_LRS"]:
                            expected_digit = average
                            if digit in dict(level["SKIP_STAGES"]).values():
                                expected_digit = digit
                            elif digit in (38, 40, 45):
                                expected_digit = max(average, digit)
                        assert cpu.reg_read(xregs[20]) == expected_digit
                        for index in range(103):
                            expected = average if caller in level["AVG_LRS"] else 22
                            if caller in level["AVG_LRS"]:
                                expected = max(expected, dict(level["FLOOR_STAGES"]).get(index, 0))
                                expected = dict(level["SKIP_STAGES"]).get(index, expected)
                            assert word(cpu.mem_read(base + 0x28C1A04 + index * 0x50, 4), 0) == expected
                        checks += 1
                for available in (True, False):
                    reset()
                    state.update(average=average, singleton=available)
                    cpu.reg_write(xregs[20], heap)
                    cpu.reg_write(xregs[30], base + 0x199AF4)
                    cpu.mem_write(heap + 0x1BC4, struct.pack("<I", 22))
                    cpu.emu_start(base + 0x199AF0, base + 0x199AF4, count=100)
                    assert cpu.reg_read(xregs[8]) == (average if available else 22)
                    assert cpu.reg_read(xregs[20]) == heap
                    assert cpu.reg_read(xregs[0]) == 0x12340000
                    assert cpu.reg_read(xregs[1]) == 0x12340001
                    assert cpu.reg_read(registers.UC_ARM64_REG_SP) == stack + 0x8000
                    checks += 1
    print(f"PASS: {checks} ARM64 cases; XP 9 variants / 5 hooks; 13 UI callers; 103 stage rows; ASLR; engage null path")
    print("边界：singleton/平均等级入口使用测试替身；未执行完整游戏，不等于游戏内验收通过。")


def main():
    parser = argparse.ArgumentParser(description="亚洲版运行时补丁实验候选：仅生成本地 main 副本，不安装、不上传")
    parser.add_argument("--input", type=Path, default=ROOT / ".extracted/exefs-asia-v1.0.5/main.dec")
    parser.add_argument("--xp", type=float, choices=MULTIPLIERS)
    parser.add_argument("--levels", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--web-data", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    binary = args.input.read_bytes()
    validate_source(binary)
    if args.verify:
        verify(binary)
    if args.web_data:
        variants = {}
        for name, multiplier, levels in [("levels", None, True)] + [(str(value), value, False) for value in MULTIPLIERS]:
            result, patches, _, _ = build(binary, multiplier, levels)
            variants[name] = sorted(patches.items())
        hashes = {}
        for multiplier in MULTIPLIERS:
            for levels in (False, True):
                result, _, _, _ = build(binary, multiplier, levels)
                hashes[f"{multiplier}:{int(levels)}"] = hashlib.sha256(result).hexdigest()
        result, _, _, _ = build(binary, None, True)
        hashes["none:1"] = hashlib.sha256(result).hexdigest()
        destination = ROOT / "web/asia-runtime-data.json"
        destination.write_text(json.dumps({"sourceSha": SOURCE_SHA, "buildId": BUILD_ID, "variants": variants, "hashes": hashes}, separators=(",", ":")) + "\n")
        print("已生成浏览器指令数据；不含游戏程序或存档")
    if args.output:
        destination = args.output.resolve()
        if not destination.is_relative_to(ROOT / ".tools"):
            raise ValueError("实验候选只能输出到仓库 .tools 内，不能覆盖游戏或模拟器目录")
        result, patches, _, _ = build(binary, args.xp, args.levels)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as stream:
            stream.write(result)
        print(f"实验候选：{destination.relative_to(ROOT)}；{len(patches)} 个指令字；text end=0x{word(result, 0x18):X}")
    if not args.output and not args.verify and not args.web_data:
        parser.error("请选择 --verify 或明确的 --output；不会自动安装候选")


if __name__ == "__main__":
    main()
