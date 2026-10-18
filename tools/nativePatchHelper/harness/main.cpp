#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winnt.h>
#include <cstdint>
#include <cstring>
#include <iterator>

#pragma section(".patch", read, write)
extern "C" __declspec(allocate(".patch")) volatile unsigned char PatchHarnessSlots[34] = {
  0x11,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
  0xA1, 0xB2, 0xC3, 0xD4, 0xE9, 0xDE, 0xFF, 0xFF, 0xFF
};
#pragma comment(linker, "/SECTION:.patch,RW")
#pragma comment(linker, "/INCLUDE:_tls_used")

namespace {

void appendRecord(const char* name, unsigned value) {
  wchar_t path[32768]{};
  const DWORD pathLength = GetEnvironmentVariableW(L"WH3_NATIVE_PATCH_HARNESS_LOG", path, static_cast<DWORD>(std::size(path)));
  if (pathLength == 0 || pathLength >= std::size(path)) return;
  HANDLE file = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  char line[96]{};
  size_t length = 0;
  while (name[length] && length < sizeof(line) - 1) { line[length] = name[length]; length++; }
  if (length < sizeof(line) - 2) line[length++] = ':';
  char digits[16]{};
  size_t digitCount = 0;
  do { digits[digitCount++] = static_cast<char>('0' + value % 10); value /= 10; } while (value && digitCount < sizeof(digits));
  while (digitCount && length < sizeof(line) - 2) line[length++] = digits[--digitCount];
  line[length++] = '\n';
  DWORD written = 0;
  WriteFile(file, line, static_cast<DWORD>(length), &written, nullptr);
  CloseHandle(file);
}

void NTAPI executableTls(PVOID, DWORD reason, PVOID) {
  if (reason == DLL_PROCESS_ATTACH) appendRecord("exe_tls", PatchHarnessSlots[0]);
}

#pragma section(".CRT$XLB", long, read)
extern "C" __declspec(allocate(".CRT$XLB")) PIMAGE_TLS_CALLBACK PatchHarnessTlsCallbackSlot = executableTls;
#pragma comment(linker, "/INCLUDE:PatchHarnessTlsCallbackSlot")

using LookupFunctionEntry = PRUNTIME_FUNCTION(NTAPI*)(DWORD64, PDWORD64, PUNWIND_HISTORY_TABLE);
using VirtualUnwind = PEXCEPTION_ROUTINE(NTAPI*)(ULONG, DWORD64, DWORD64, PRUNTIME_FUNCTION, PCONTEXT, PVOID*, PDWORD64, PKNONVOLATILE_CONTEXT_POINTERS);
extern "C" __declspec(dllimport) int __cdecl NativePatchCompanionCheck();

bool validateDynamicUnwind(DWORD64 parentAddress, DWORD64 stubAddress, DWORD64 readOnlyAddress, DWORD64 writableAddress) {
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;
  auto lookup = reinterpret_cast<LookupFunctionEntry>(GetProcAddress(ntdll, "RtlLookupFunctionEntry"));
  auto virtualUnwind = reinterpret_cast<VirtualUnwind>(GetProcAddress(ntdll, "RtlVirtualUnwind"));
  if (!lookup || !virtualUnwind) return false;
  DWORD64 imageBase = 0;
  PRUNTIME_FUNCTION entry = lookup(stubAddress + 1, &imageBase, nullptr);
  if (!entry) return false;
  constexpr DWORD64 savedRbx = 0x0badf00d76543210ull;
  constexpr DWORD64 returnAddress = 0x123456789abcdef0ull;
  alignas(16) DWORD64 fakeStack[6] = {0x1111, 0x2222, 0x3333, 0x4444, savedRbx, returnAddress};
  CONTEXT context{};
  context.Rsp = reinterpret_cast<DWORD64>(&fakeStack[0]);
  context.Rip = stubAddress + 1;
  context.Rbx = 0xffffffffffffffffull;
  PVOID handlerData = nullptr;
  DWORD64 establisherFrame = 0;
  virtualUnwind(UNW_FLAG_NHANDLER, imageBase, context.Rip, entry, &context, &handlerData, &establisherFrame, nullptr);
  MEMORY_BASIC_INFORMATION parentMemory{}, stubMemory{}, tableMemory{}, readOnlyMemory{}, writableMemory{};
  if (!VirtualQuery(reinterpret_cast<LPCVOID>(parentAddress), &parentMemory, sizeof(parentMemory)) ||
      !VirtualQuery(reinterpret_cast<LPCVOID>(stubAddress), &stubMemory, sizeof(stubMemory)) ||
      !VirtualQuery(reinterpret_cast<LPCVOID>(entry), &tableMemory, sizeof(tableMemory)) ||
      !VirtualQuery(reinterpret_cast<LPCVOID>(readOnlyAddress), &readOnlyMemory, sizeof(readOnlyMemory)) ||
      !VirtualQuery(reinterpret_cast<LPCVOID>(writableAddress), &writableMemory, sizeof(writableMemory))) return false;
  return context.Rbx == savedRbx && context.Rip == returnAddress &&
      context.Rsp == reinterpret_cast<DWORD64>(&fakeStack[6]) &&
      (parentMemory.Protect & 0xff) == PAGE_EXECUTE_READ &&
      (stubMemory.Protect & 0xff) == PAGE_EXECUTE_READ &&
      (tableMemory.Protect & 0xff) == PAGE_READONLY &&
      (readOnlyMemory.Protect & 0xff) == PAGE_READONLY &&
      (writableMemory.Protect & 0xff) == PAGE_READWRITE;
}

}  // namespace

extern "C" __declspec(dllexport) int __cdecl PatchHarnessCheck() {
  return PatchHarnessSlots[0];
}

int wmain(int argc, wchar_t**) {
  appendRecord("exe_main", PatchHarnessSlots[0]);
  if (argc != 2 || PatchHarnessSlots[0] != 0x42) return 10;
  const int companionValue = NativePatchCompanionCheck();
  if (companionValue != 0x42) return 12;
  appendRecord("companion_loaded", static_cast<unsigned>(companionValue));

  auto readPointer = [](size_t offset) {
    uintptr_t value = 0;
    for (size_t index = 0; index < sizeof(value); index++) {
      value |= static_cast<uintptr_t>(PatchHarnessSlots[offset + index]) << (index * 8);
    }
    return value;
  };
  const uintptr_t parentAddress = readPointer(1);
  const uintptr_t readOnlyAddress = readPointer(9);
  const uintptr_t writableAddress = readPointer(17);
  if (!parentAddress || !readOnlyAddress || !writableAddress) return 13;
  int32_t branchDisplacement = 0;
  std::memcpy(&branchDisplacement, reinterpret_cast<const void*>(parentAddress + 6), sizeof(branchDisplacement));
  const uintptr_t stubAddress = static_cast<uintptr_t>(static_cast<int64_t>(parentAddress + 10) + branchDisplacement);
  using InjectedFunction = int(__cdecl*)();
  const int codeResult = reinterpret_cast<InjectedFunction>(parentAddress)();
  appendRecord("injected_code", static_cast<unsigned>(codeResult));
  const bool unwindOk = validateDynamicUnwind(parentAddress, stubAddress, readOnlyAddress, writableAddress);
  appendRecord("dynamic_unwind", unwindOk ? 1 : 0);
  Sleep(3000);
  return codeResult == 42 && unwindOk ? 0 : 14;
}
