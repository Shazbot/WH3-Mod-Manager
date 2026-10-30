#include <Windows.h>

#include <cstdio>
#include <filesystem>
#include <string>
#include <vector>

namespace {

BOOL WINAPI keepLauncherAliveForCtrlC(DWORD controlType) {
  return controlType == CTRL_C_EVENT || controlType == CTRL_BREAK_EVENT;
}

struct InheritedStandardHandles {
  HANDLE input = nullptr;
  HANDLE output = nullptr;
  HANDLE error = nullptr;

  ~InheritedStandardHandles() {
    if (input) CloseHandle(input);
    if (output) CloseHandle(output);
    if (error) CloseHandle(error);
  }

  bool initialize(DWORD& errorCode) {
    return duplicate(STD_INPUT_HANDLE, input, errorCode) && duplicate(STD_OUTPUT_HANDLE, output, errorCode) &&
           duplicate(STD_ERROR_HANDLE, error, errorCode);
  }

 private:
  bool duplicate(DWORD standardHandle, HANDLE& destination, DWORD& errorCode) {
    const HANDLE original = GetStdHandle(standardHandle);
    if (!original || original == INVALID_HANDLE_VALUE) {
      SECURITY_ATTRIBUTES securityAttributes{};
      securityAttributes.nLength = sizeof(securityAttributes);
      securityAttributes.bInheritHandle = TRUE;
      destination = CreateFileW(
          L"NUL",
          GENERIC_READ | GENERIC_WRITE,
          FILE_SHARE_READ | FILE_SHARE_WRITE,
          &securityAttributes,
          OPEN_EXISTING,
          FILE_ATTRIBUTE_NORMAL,
          nullptr);
      if (destination == INVALID_HANDLE_VALUE) {
        destination = nullptr;
        errorCode = GetLastError();
        return false;
      }
      return true;
    }

    if (!DuplicateHandle(GetCurrentProcess(), original, GetCurrentProcess(), &destination, 0, TRUE, DUPLICATE_SAME_ACCESS)) {
      errorCode = GetLastError();
      return false;
    }
    return true;
  }
};

std::wstring quoteArgument(const std::wstring& argument) {
  std::wstring quoted;
  quoted.reserve(argument.size() + 2);
  quoted.push_back(L'"');

  std::size_t backslashes = 0;
  for (const wchar_t character : argument) {
    if (character == L'\\') {
      ++backslashes;
      continue;
    }

    if (character == L'"') {
      quoted.append(backslashes * 2 + 1, L'\\');
      quoted.push_back(L'"');
    } else {
      quoted.append(backslashes, L'\\');
      quoted.push_back(character);
    }
    backslashes = 0;
  }

  quoted.append(backslashes * 2, L'\\');
  quoted.push_back(L'"');
  return quoted;
}

bool fileExists(const std::filesystem::path& filePath) {
  std::error_code error;
  return std::filesystem::is_regular_file(filePath, error) && !error;
}

std::filesystem::path executableDirectory() {
  std::vector<wchar_t> buffer(512);
  while (buffer.size() <= 32768) {
    const DWORD length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (length == 0) {
      return {};
    }
    if (length < buffer.size()) {
      return std::filesystem::path(std::wstring(buffer.data(), length)).parent_path();
    }
    buffer.resize(buffer.size() * 2);
  }
  return {};
}

int fail(const char* message, DWORD error = ERROR_SUCCESS) {
  if (error == ERROR_SUCCESS) {
    std::fprintf(stderr, "whmm-cli: %s\n", message);
  } else {
    std::fprintf(stderr, "whmm-cli: %s (Windows error %lu)\n", message, error);
  }
  return 1;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  const std::filesystem::path appDirectory = executableDirectory();
  if (appDirectory.empty()) {
    return fail("could not resolve the launcher directory", GetLastError());
  }

  const std::filesystem::path electronExecutable = appDirectory / L"wh3mm.exe";
  const std::filesystem::path cliEntry = appDirectory / L"resources" / L"headless" / L"cli" / L"main.js";
  const std::filesystem::path schemaFile =
      appDirectory / L"resources" / L"headless" / L"schema" / L"schema_wh3.json.zst";

  if (!fileExists(electronExecutable)) {
    return fail("packaged Electron runtime wh3mm.exe is missing beside the launcher");
  }
  if (!fileExists(cliEntry) || !fileExists(schemaFile)) {
    return fail("packaged CLI assets are missing under resources\\headless; run the Windows packaging build again");
  }

  std::wstring commandLine = quoteArgument(electronExecutable.native());
  commandLine.push_back(L' ');
  commandLine += quoteArgument(cliEntry.native());
  for (int index = 1; index < argc; ++index) {
    commandLine.push_back(L' ');
    commandLine += quoteArgument(argv[index]);
  }

  if (!SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1")) {
    return fail("could not enable Electron's Node.js mode", GetLastError());
  }

  if (!SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, TRUE)) {
    return fail("could not install the Ctrl+C handler", GetLastError());
  }

  InheritedStandardHandles standardHandles;
  DWORD standardHandleError = ERROR_SUCCESS;
  if (!standardHandles.initialize(standardHandleError)) {
    SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, FALSE);
    return fail("could not inherit standard input/output/error", standardHandleError);
  }

  STARTUPINFOW startupInfo{};
  startupInfo.cb = sizeof(startupInfo);
  startupInfo.dwFlags = STARTF_USESTDHANDLES;
  startupInfo.hStdInput = standardHandles.input;
  startupInfo.hStdOutput = standardHandles.output;
  startupInfo.hStdError = standardHandles.error;

  PROCESS_INFORMATION processInfo{};
  const BOOL started = CreateProcessW(
      electronExecutable.c_str(),
      commandLine.data(),
      nullptr,
      nullptr,
      TRUE,
      0,
      nullptr,
      nullptr,
      &startupInfo,
      &processInfo);
  if (!started) {
    const DWORD error = GetLastError();
    SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, FALSE);
    return fail("could not start the packaged Electron runtime", error);
  }

  CloseHandle(processInfo.hThread);
  const DWORD waitResult = WaitForSingleObject(processInfo.hProcess, INFINITE);
  if (waitResult != WAIT_OBJECT_0) {
    const DWORD error = waitResult == WAIT_FAILED ? GetLastError() : ERROR_GEN_FAILURE;
    TerminateProcess(processInfo.hProcess, 1);
    WaitForSingleObject(processInfo.hProcess, INFINITE);
    CloseHandle(processInfo.hProcess);
    SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, FALSE);
    return fail("could not wait for the packaged CLI process", error);
  }

  DWORD exitCode = 1;
  if (!GetExitCodeProcess(processInfo.hProcess, &exitCode)) {
    const DWORD error = GetLastError();
    CloseHandle(processInfo.hProcess);
    SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, FALSE);
    return fail("could not read the packaged CLI exit code", error);
  }

  CloseHandle(processInfo.hProcess);
  SetConsoleCtrlHandler(keepLauncherAliveForCtrlC, FALSE);
  ExitProcess(exitCode);
  return static_cast<int>(exitCode);
}
