#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <iterator>

namespace {

int readPatchByte() {
  HMODULE executable = GetModuleHandleW(nullptr);
  if (!executable) return -1;
  using PatchCheck = int(__cdecl*)();
  auto check = reinterpret_cast<PatchCheck>(GetProcAddress(executable, "PatchHarnessCheck"));
  return check ? check() : -1;
}

void appendRecord(const char* name, int value) {
  wchar_t path[32768]{};
  const DWORD pathLength = GetEnvironmentVariableW(L"WH3_NATIVE_PATCH_HARNESS_LOG", path, static_cast<DWORD>(std::size(path)));
  if (pathLength == 0 || pathLength >= std::size(path)) return;
  HANDLE file = CreateFileW(path, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return;
  char line[96]{};
  size_t length = 0;
  while (name[length] && length < sizeof(line) - 1) { line[length] = name[length]; length++; }
  if (length < sizeof(line) - 2) line[length++] = ':';
  if (value < 0) line[length++] = '-';
  unsigned magnitude = value < 0 ? static_cast<unsigned>(-value) : static_cast<unsigned>(value);
  char digits[16]{};
  size_t digitCount = 0;
  do { digits[digitCount++] = static_cast<char>('0' + magnitude % 10); magnitude /= 10; } while (magnitude && digitCount < sizeof(digits));
  while (digitCount && length < sizeof(line) - 2) line[length++] = digits[--digitCount];
  line[length++] = '\n';
  DWORD written = 0;
  WriteFile(file, line, static_cast<DWORD>(length), &written, nullptr);
  CloseHandle(file);
}

void NTAPI companionTls(PVOID, DWORD reason, PVOID) {
  if (reason == DLL_PROCESS_ATTACH) appendRecord("companion_tls", readPatchByte());
}

#pragma section(".CRT$XLB", long, read)
extern "C" __declspec(allocate(".CRT$XLB")) PIMAGE_TLS_CALLBACK NativePatchCompanionTlsSlot = companionTls;
#pragma comment(linker, "/INCLUDE:NativePatchCompanionTlsSlot")
#pragma comment(linker, "/INCLUDE:_tls_used")

}  // namespace

extern "C" __declspec(dllexport) int __cdecl NativePatchCompanionCheck() {
  return readPatchByte();
}

BOOL WINAPI DllMain(HINSTANCE, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) appendRecord("companion_dllmain", readPatchByte());
  return TRUE;
}
