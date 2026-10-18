#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <bcrypt.h>
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <climits>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

#pragma comment(lib, "bcrypt.lib")

namespace {

constexpr size_t kMaxPlanBytes = 64u * 1024u * 1024u;
constexpr size_t kMaxBlockBytes = 64u * 1024u * 1024u;
constexpr size_t kMaxTotalPayloadBytes = 512u * 1024u * 1024u;
constexpr size_t kMaxPackages = 256;
constexpr size_t kMaxImageBytes = 1024u * 1024u * 1024u;
constexpr DWORD kDebugWaitMs = 10000;

[[noreturn]] void fail(const std::string& message) { throw std::runtime_error(message); }

struct Json {
  using Array = std::vector<Json>;
  using Object = std::map<std::string, Json>;
  std::variant<std::nullptr_t, bool, double, std::string, Array, Object> value;
  const Json* get(const std::string& key) const {
    const auto* object = std::get_if<Object>(&value);
    if (!object) return nullptr;
    const auto found = object->find(key);
    return found == object->end() ? nullptr : &found->second;
  }
};

void appendUtf8(std::string& out, uint32_t codepoint) {
  if (codepoint <= 0x7f) out.push_back(static_cast<char>(codepoint));
  else if (codepoint <= 0x7ff) {
    out.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else if (codepoint <= 0xffff) {
    out.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else {
    out.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    out.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  }
}

class JsonParser {
 public:
  explicit JsonParser(const std::string& input) : input_(input) {}
  Json parse() {
    skipWhitespace();
    Json result = parseValue(0);
    skipWhitespace();
    if (cursor_ != input_.size()) fail("plan JSON has trailing data");
    return result;
  }

 private:
  const std::string& input_;
  size_t cursor_ = 0;
  void skipWhitespace() {
    while (cursor_ < input_.size() && (input_[cursor_] == ' ' || input_[cursor_] == '\n' || input_[cursor_] == '\r' || input_[cursor_] == '\t')) cursor_++;
  }
  char take() {
    if (cursor_ >= input_.size()) fail("truncated plan JSON");
    return input_[cursor_++];
  }
  bool consume(char value) {
    if (cursor_ < input_.size() && input_[cursor_] == value) { cursor_++; return true; }
    return false;
  }
  uint32_t parseHex4() {
    uint32_t result = 0;
    for (int i = 0; i < 4; i++) {
      const char ch = take();
      result <<= 4;
      if (ch >= '0' && ch <= '9') result |= static_cast<uint32_t>(ch - '0');
      else if (ch >= 'a' && ch <= 'f') result |= static_cast<uint32_t>(ch - 'a' + 10);
      else if (ch >= 'A' && ch <= 'F') result |= static_cast<uint32_t>(ch - 'A' + 10);
      else fail("invalid Unicode escape in plan JSON");
    }
    return result;
  }
  std::string parseString() {
    if (take() != '"') fail("expected JSON string");
    std::string result;
    while (true) {
      const unsigned char ch = static_cast<unsigned char>(take());
      if (ch == '"') return result;
      if (ch < 0x20) fail("control byte in JSON string");
      if (ch != '\\') { result.push_back(static_cast<char>(ch)); continue; }
      const char escaped = take();
      switch (escaped) {
        case '"': result.push_back('"'); break;
        case '\\': result.push_back('\\'); break;
        case '/': result.push_back('/'); break;
        case 'b': result.push_back('\b'); break;
        case 'f': result.push_back('\f'); break;
        case 'n': result.push_back('\n'); break;
        case 'r': result.push_back('\r'); break;
        case 't': result.push_back('\t'); break;
        case 'u': {
          uint32_t codepoint = parseHex4();
          if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
            if (take() != '\\' || take() != 'u') fail("invalid Unicode surrogate pair");
            const uint32_t low = parseHex4();
            if (low < 0xdc00 || low > 0xdfff) fail("invalid Unicode surrogate pair");
            codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + low - 0xdc00;
          } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) fail("unpaired low Unicode surrogate");
          appendUtf8(result, codepoint);
          break;
        }
        default: fail("invalid escape in plan JSON");
      }
    }
  }
  Json parseValue(size_t depth) {
    if (depth > 64) fail("plan JSON nesting exceeds 64 levels");
    skipWhitespace();
    if (cursor_ >= input_.size()) fail("truncated plan JSON");
    const char ch = input_[cursor_];
    if (ch == '"') return Json{parseString()};
    if (ch == '{') {
      cursor_++;
      Json::Object object;
      skipWhitespace();
      if (consume('}')) return Json{std::move(object)};
      while (true) {
        skipWhitespace();
        if (cursor_ >= input_.size() || input_[cursor_] != '"') fail("expected object key in plan JSON");
        std::string key = parseString();
        skipWhitespace();
        if (!consume(':')) fail("expected ':' after plan JSON key");
        Json child = parseValue(depth + 1);
        if (!object.emplace(key, std::move(child)).second) fail("duplicate object key in plan JSON: " + key);
        skipWhitespace();
        if (consume('}')) break;
        if (!consume(',')) fail("expected ',' in plan JSON object");
      }
      return Json{std::move(object)};
    }
    if (ch == '[') {
      cursor_++;
      Json::Array array;
      skipWhitespace();
      if (consume(']')) return Json{std::move(array)};
      while (true) {
        array.push_back(parseValue(depth + 1));
        skipWhitespace();
        if (consume(']')) break;
        if (!consume(',')) fail("expected ',' in plan JSON array");
      }
      return Json{std::move(array)};
    }
    if (input_.compare(cursor_, 4, "true") == 0) { cursor_ += 4; return Json{true}; }
    if (input_.compare(cursor_, 5, "false") == 0) { cursor_ += 5; return Json{false}; }
    if (input_.compare(cursor_, 4, "null") == 0) { cursor_ += 4; return Json{nullptr}; }
    const size_t start = cursor_;
    if (consume('-') && cursor_ >= input_.size()) fail("truncated number in plan JSON");
    if (consume('0')) {
      if (cursor_ < input_.size() && std::isdigit(static_cast<unsigned char>(input_[cursor_]))) fail("invalid leading zero in plan JSON number");
    } else {
      if (cursor_ >= input_.size() || input_[cursor_] < '1' || input_[cursor_] > '9') fail("invalid value in plan JSON");
      while (cursor_ < input_.size() && std::isdigit(static_cast<unsigned char>(input_[cursor_]))) cursor_++;
    }
    if (consume('.')) {
      if (cursor_ >= input_.size() || !std::isdigit(static_cast<unsigned char>(input_[cursor_]))) fail("invalid fraction in plan JSON number");
      while (cursor_ < input_.size() && std::isdigit(static_cast<unsigned char>(input_[cursor_]))) cursor_++;
    }
    if (cursor_ < input_.size() && (input_[cursor_] == 'e' || input_[cursor_] == 'E')) {
      cursor_++;
      if (cursor_ < input_.size() && (input_[cursor_] == '+' || input_[cursor_] == '-')) cursor_++;
      if (cursor_ >= input_.size() || !std::isdigit(static_cast<unsigned char>(input_[cursor_]))) fail("invalid exponent in plan JSON number");
      while (cursor_ < input_.size() && std::isdigit(static_cast<unsigned char>(input_[cursor_]))) cursor_++;
    }
    const double number = std::strtod(input_.c_str() + start, nullptr);
    if (!std::isfinite(number) || std::floor(number) != number || std::abs(number) > 9007199254740991.0) {
      fail("plan JSON requires safe integer values");
    }
    return Json{number};
  }
};

const Json::Object& objectOf(const Json& value, const std::string& where) {
  const auto* result = std::get_if<Json::Object>(&value.value);
  if (!result) fail(where + " must be an object");
  return *result;
}
const Json::Array& arrayOf(const Json& value, const std::string& where) {
  const auto* result = std::get_if<Json::Array>(&value.value);
  if (!result) fail(where + " must be an array");
  return *result;
}
const Json& required(const Json& object, const std::string& key, const std::string& where) {
  const Json* value = object.get(key);
  if (!value) fail(where + " is missing '" + key + "'");
  return *value;
}
std::string stringOf(const Json& value, const std::string& where) {
  const auto* result = std::get_if<std::string>(&value.value);
  if (!result) fail(where + " must be a string");
  return *result;
}
int64_t intOf(const Json& value, const std::string& where) {
  const auto* result = std::get_if<double>(&value.value);
  if (!result || *result < static_cast<double>(INT64_MIN) || *result > static_cast<double>(INT64_MAX)) fail(where + " must be an integer");
  return static_cast<int64_t>(*result);
}
uint64_t uintOf(const Json& value, const std::string& where) {
  const int64_t result = intOf(value, where);
  if (result < 0) fail(where + " must be nonnegative");
  return static_cast<uint64_t>(result);
}
std::wstring widen(const std::string& value) {
  if (value.empty()) return {};
  const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
  if (count <= 0) fail("invalid UTF-8 in path or plan");
  std::wstring result(static_cast<size_t>(count), L'\0');
  if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), count) != count) fail("could not decode UTF-8 path");
  return result;
}
std::string readTextFile(const std::wstring& path, size_t maxBytes) {
  std::ifstream file(path, std::ios::binary);
  if (!file) fail("could not open plan or signal file");
  file.seekg(0, std::ios::end);
  const auto length = file.tellg();
  if (length < 0 || static_cast<uint64_t>(length) > maxBytes) fail("plan or signal file exceeds its size limit");
  file.seekg(0, std::ios::beg);
  std::string result(static_cast<size_t>(length), '\0');
  if (!result.empty() && !file.read(result.data(), static_cast<std::streamsize>(result.size()))) fail("short read from plan or signal file");
  return result;
}
std::vector<uint8_t> readBinaryFile(const std::wstring& path, size_t maxBytes) {
  std::ifstream file(path, std::ios::binary);
  if (!file) fail("could not open block payload file");
  file.seekg(0, std::ios::end);
  const auto length = file.tellg();
  if (length < 0 || static_cast<uint64_t>(length) > maxBytes) fail("block payload file exceeds its size limit");
  file.seekg(0, std::ios::beg);
  std::vector<uint8_t> result(static_cast<size_t>(length));
  if (!result.empty() && !file.read(reinterpret_cast<char*>(result.data()), static_cast<std::streamsize>(result.size()))) fail("short read from block payload file");
  return result;
}
std::vector<uint8_t> readFilePrefix(const std::wstring& path, size_t maxBytes) {
  std::ifstream file(path, std::ios::binary);
  if (!file) fail("could not open target executable headers");
  std::vector<uint8_t> result(maxBytes);
  file.read(reinterpret_cast<char*>(result.data()), static_cast<std::streamsize>(result.size()));
  const std::streamsize count = file.gcount();
  if (count < 0x100) fail("target executable headers are truncated");
  result.resize(static_cast<size_t>(count));
  return result;
}
std::string escapeJson(const std::string& value) {
  std::ostringstream out;
  for (unsigned char ch : value) {
    switch (ch) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default: if (ch < 0x20) out << "?"; else out << static_cast<char>(ch); break;
    }
  }
  return out.str();
}
std::string lowerAscii(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
  return value;
}
std::string sha256(const uint8_t* bytes, size_t length) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD objectBytes = 0, hashBytes = 0, copied = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) fail("BCryptOpenAlgorithmProvider(SHA-256) failed");
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes), sizeof(objectBytes), &copied, 0) < 0 ||
      BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashBytes), sizeof(hashBytes), &copied, 0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0); fail("could not query SHA-256 properties");
  }
  std::vector<uint8_t> object(objectBytes), digest(hashBytes);
  if (BCryptCreateHash(algorithm, &hash, object.data(), objectBytes, nullptr, 0, 0) < 0 ||
      BCryptHashData(hash, const_cast<PUCHAR>(bytes), static_cast<ULONG>(length), 0) < 0 ||
      BCryptFinishHash(hash, digest.data(), hashBytes, 0) < 0) {
    if (hash) BCryptDestroyHash(hash);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    fail("SHA-256 calculation failed");
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  std::ostringstream out;
  out << std::hex << std::setfill('0');
  for (uint8_t value : digest) out << std::setw(2) << static_cast<unsigned>(value);
  return out.str();
}
std::string sha256(const std::vector<uint8_t>& bytes) { return sha256(bytes.data(), bytes.size()); }
std::vector<uint8_t> parseHexBytes(const std::string& text, const std::string& where) {
  if ((text.size() & 1) != 0) fail(where + " is not even-length hexadecimal");
  std::vector<uint8_t> result(text.size() / 2);
  auto digit = [](char ch) -> int {
    if (ch >= '0' && ch <= '9') return ch - '0';
    if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
    if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < result.size(); i++) {
    const int high = digit(text[2 * i]), low = digit(text[2 * i + 1]);
    if (high < 0 || low < 0) fail(where + " contains non-hex characters");
    result[i] = static_cast<uint8_t>((high << 4) | low);
  }
  return result;
}
uint64_t parseHexU64(const std::string& text, const std::string& where) {
  if (text.size() < 3 || text[0] != '0' || (text[1] != 'x' && text[1] != 'X')) fail(where + " must be a 0x-prefixed hexadecimal integer");
  uint64_t value = 0;
  for (size_t i = 2; i < text.size(); i++) {
    const char ch = text[i];
    unsigned digit;
    if (ch >= '0' && ch <= '9') digit = static_cast<unsigned>(ch - '0');
    else if (ch >= 'a' && ch <= 'f') digit = static_cast<unsigned>(ch - 'a' + 10);
    else if (ch >= 'A' && ch <= 'F') digit = static_cast<unsigned>(ch - 'A' + 10);
    else fail(where + " contains non-hex characters");
    if (value > (UINT64_MAX - digit) / 16) fail(where + " exceeds 64 bits");
    value = value * 16 + digit;
  }
  return value;
}

struct PeSection { uint32_t rva; uint32_t size; uint32_t characteristics; };
struct PeInfo { uint32_t imageSize; uint32_t sectionAlignment; std::vector<PeSection> sections; };
template <typename T> T readLe(const std::vector<uint8_t>& data, size_t offset, const std::string& where) {
  if (offset > data.size() || sizeof(T) > data.size() - offset) fail(where + " is truncated");
  T result{};
  std::memcpy(&result, data.data() + offset, sizeof(T));
  return result;
}
PeInfo parsePe(const std::vector<uint8_t>& bytes) {
  if (bytes.size() < 0x100 || readLe<uint16_t>(bytes, 0, "DOS header") != IMAGE_DOS_SIGNATURE) fail("target is not a PE executable");
  const uint32_t peOffset = readLe<uint32_t>(bytes, 0x3c, "DOS header");
  if (peOffset > bytes.size() || bytes.size() - peOffset < 24 || readLe<uint32_t>(bytes, peOffset, "PE signature") != IMAGE_NT_SIGNATURE) fail("target has an invalid PE signature");
  const uint16_t machine = readLe<uint16_t>(bytes, peOffset + 4, "COFF header");
  const uint16_t sectionCount = readLe<uint16_t>(bytes, peOffset + 6, "COFF header");
  const uint16_t optionalSize = readLe<uint16_t>(bytes, peOffset + 20, "COFF header");
  if (machine != IMAGE_FILE_MACHINE_AMD64 || sectionCount == 0 || sectionCount > 96) fail("target must be a Windows x86-64 executable");
  const size_t optional = peOffset + 24;
  if (optionalSize < 64 || readLe<uint16_t>(bytes, optional, "optional header") != IMAGE_NT_OPTIONAL_HDR64_MAGIC) fail("target has no PE32+ optional header");
  PeInfo result;
  result.sectionAlignment = readLe<uint32_t>(bytes, optional + 32, "optional header");
  result.imageSize = readLe<uint32_t>(bytes, optional + 56, "optional header");
  if (result.imageSize == 0 || result.imageSize > kMaxImageBytes || result.sectionAlignment == 0) fail("target image size is invalid or exceeds 1 GiB");
  const size_t sectionTable = optional + optionalSize;
  if (sectionTable > bytes.size() || static_cast<size_t>(sectionCount) * 40 > bytes.size() - sectionTable) fail("target section table is truncated");
  for (uint16_t index = 0; index < sectionCount; index++) {
    const size_t at = sectionTable + static_cast<size_t>(index) * 40;
    const uint32_t virtualSize = readLe<uint32_t>(bytes, at + 8, "section header");
    const uint32_t virtualAddress = readLe<uint32_t>(bytes, at + 12, "section header");
    const uint32_t rawSize = readLe<uint32_t>(bytes, at + 16, "section header");
    const uint32_t characteristics = readLe<uint32_t>(bytes, at + 36, "section header");
    const uint32_t span = std::max(virtualSize, rawSize);
    if (span == 0) continue;
    if (virtualAddress > result.imageSize || span > result.imageSize - virtualAddress) fail("target section extends beyond SizeOfImage");
    result.sections.push_back({virtualAddress, span, characteristics});
  }
  return result;
}

bool readRemote(HANDLE process, uint64_t address, void* target, size_t size) {
  SIZE_T bytesRead = 0;
  return ReadProcessMemory(process, reinterpret_cast<LPCVOID>(address), target, size, &bytesRead) != FALSE && bytesRead == size;
}
std::vector<uint8_t> readRemoteBytes(HANDLE process, uint64_t address, size_t size, const std::string& where) {
  std::vector<uint8_t> result(size);
  if (size && !readRemote(process, address, result.data(), size)) fail("could not read target memory for " + where);
  return result;
}
bool writeRemote(HANDLE process, uint64_t address, const void* source, size_t size) {
  SIZE_T bytesWritten = 0;
  return WriteProcessMemory(process, reinterpret_cast<LPVOID>(address), source, size, &bytesWritten) != FALSE && bytesWritten == size;
}
uint64_t checkedAdd(uint64_t address, int64_t offset, const std::string& where) {
  if (offset >= 0) {
    if (address > UINT64_MAX - static_cast<uint64_t>(offset)) fail(where + " address addition overflow");
    return address + static_cast<uint64_t>(offset);
  }
  const uint64_t magnitude = static_cast<uint64_t>(-(offset + 1)) + 1;
  if (address < magnitude) fail(where + " address subtraction underflow");
  return address - magnitude;
}
int64_t checkedDifference(uint64_t target, uint64_t base, const std::string& where) {
  if (target >= base) {
    const uint64_t difference = target - base;
    if (difference > static_cast<uint64_t>(INT64_MAX)) fail(where + " positive displacement exceeds signed 64-bit range");
    return static_cast<int64_t>(difference);
  }
  const uint64_t difference = base - target;
  if (difference > (static_cast<uint64_t>(INT64_MAX) + 1)) fail(where + " negative displacement exceeds signed 64-bit range");
  if (difference == (static_cast<uint64_t>(INT64_MAX) + 1)) return INT64_MIN;
  return -static_cast<int64_t>(difference);
}

}  // namespace

namespace {

struct Arguments {
  std::wstring plan;
  std::wstring status;
  std::wstring release;
  std::wstring cancel;
  std::wstring decision;
};

Arguments parseArguments(int argc, wchar_t** argv) {
  Arguments result;
  for (int index = 1; index < argc; index++) {
    const std::wstring key = argv[index];
    if (index + 1 >= argc) fail("missing value for helper argument");
    if (key == L"--plan") result.plan = argv[++index];
    else if (key == L"--status") result.status = argv[++index];
    else if (key == L"--release") result.release = argv[++index];
    else if (key == L"--cancel") result.cancel = argv[++index];
    else if (key == L"--decision") result.decision = argv[++index];
    else fail("unknown helper argument");
  }
  if (result.plan.empty() || result.status.empty() || result.release.empty() || result.cancel.empty() || result.decision.empty()) {
    fail("usage: WH3NativePatchHelper.exe --plan plan.json --status status.json --release release.signal --cancel cancel.signal --decision decision.json");
  }
  return result;
}

struct SessionStatus {
  std::string runId;
  DWORD pid = 0;
  std::string processCreationTime;
};
void writeStatus(const Arguments& args, const SessionStatus& session, const std::string& state, const std::string& message = "") {
  const std::string json = "{\"protocol\":1,\"runId\":\"" + escapeJson(session.runId) + "\",\"state\":\"" +
      escapeJson(state) + "\",\"message\":\"" + escapeJson(message) + "\",\"pid\":" + std::to_string(session.pid) +
      ",\"processCreationTime\":\"" + escapeJson(session.processCreationTime) + "\"}";
  const std::wstring tempPath = args.status + L".tmp." + std::to_wstring(GetCurrentProcessId());
  HANDLE file = CreateFileW(tempPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) fail("could not create atomic helper status file");
  DWORD written = 0;
  const BOOL writeOk = WriteFile(file, json.data(), static_cast<DWORD>(json.size()), &written, nullptr);
  const BOOL flushOk = FlushFileBuffers(file);
  CloseHandle(file);
  if (!writeOk || written != json.size() || !flushOk) {
    DeleteFileW(tempPath.c_str());
    fail("could not write helper status file");
  }
  if (!MoveFileExW(tempPath.c_str(), args.status.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
    DeleteFileW(tempPath.c_str());
    fail("could not publish helper status file");
  }
}

bool signalMatches(const std::wstring& path, const std::string& runId) {
  if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) return false;
  try {
    std::string value = readTextFile(path, 4096);
    while (!value.empty() && (value.back() == '\n' || value.back() == '\r' || value.back() == ' ' || value.back() == '\t')) value.pop_back();
    return value == runId;
  } catch (...) { return false; }
}

std::string fileTimeText(HANDLE process) {
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exited, &kernel, &user)) fail("could not read target process creation time");
  const uint64_t stamp = (static_cast<uint64_t>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
  std::ostringstream out;
  out << std::hex << std::setfill('0') << std::setw(16) << stamp;
  return out.str();
}

struct BlockWork {
  std::string id;
  size_t size = 0;
  size_t alignment = 1;
  std::string protection;
  std::vector<uint8_t> bytes;
  uint64_t address = 0;
};
struct PackageWork {
  const Json* node = nullptr;
  std::string id;
  std::map<std::string, BlockWork> blocks;
  std::map<std::string, uint64_t> signatures;
  std::map<std::string, const Json*> symbols;
};
struct WriteWork {
  PackageWork* package = nullptr;
  const Json* node = nullptr;
  std::string id;
  uint64_t address = 0;
  std::vector<uint8_t> expected;
  std::vector<uint8_t> replacement;
};
struct GuardWork {
  PackageWork* package = nullptr;
  const Json* node = nullptr;
  uint64_t address = 0;
  std::vector<uint8_t> expected;
};
struct RemoteSession {
  HANDLE process = nullptr;
  HANDLE thread = nullptr;
  PROCESS_INFORMATION processInfo{};
  DEBUG_EVENT pendingEvent{};
  bool hasPendingEvent = false;
  bool attached = false;
  bool released = false;
  uint64_t moduleBase = 0;
  PeInfo pe;
  std::vector<uint8_t> imageFile;
  std::vector<PackageWork> packages;
  std::map<std::string, std::vector<WriteWork*>> writesByPackage;
  std::vector<std::unique_ptr<WriteWork>> writes;
  std::vector<GuardWork> guards;
  std::vector<uint64_t> remoteAllocations;
  std::map<uint64_t, uint8_t> breakpoints;
  std::map<DWORD, unsigned> acquiredSuspends;
  uint64_t targetEntryPoint = 0;
  uint64_t gateAddress = 0;
  DWORD gateThreadId = 0;
  bool activationGateReached = false;
  std::wstring targetDirectory;
  std::wstring windowsDirectory;
  bool sawInitialBreakpoint = false;
};

bool isInsideModule(const RemoteSession& session, uint64_t address, size_t size = 1) {
  if (address < session.moduleBase || address > session.moduleBase + session.pe.imageSize) return false;
  const uint64_t rva = address - session.moduleBase;
  return size <= session.pe.imageSize && rva <= session.pe.imageSize - size;
}
bool isMappedModuleRange(const RemoteSession& session, uint64_t address, size_t size, uint32_t requiredCharacteristics = 0) {
  if (!isInsideModule(session, address, size)) return false;
  const uint64_t rva = address - session.moduleBase;
  for (const PeSection& section : session.pe.sections) {
    if ((section.characteristics & requiredCharacteristics) != requiredCharacteristics || rva < section.rva) continue;
    const uint64_t offset = rva - section.rva;
    if (offset <= section.size && size <= section.size - offset) return true;
  }
  return false;
}
bool isBlockRange(const RemoteSession& session, uint64_t address, size_t size, bool executableOnly = false, bool allowEnd = false) {
  for (const PackageWork& package : session.packages) {
    for (const auto& [id, block] : package.blocks) {
      if (executableOnly && block.protection != "rx") continue;
      if (address < block.address) continue;
      const uint64_t offset = address - block.address;
      const size_t permitted = allowEnd ? block.size : (block.size == 0 ? 0 : block.size - 1);
      if (offset <= permitted && size <= block.size - std::min<size_t>(static_cast<size_t>(offset), block.size)) return true;
    }
  }
  return false;
}

struct RemotePeInfo { PeInfo image; uint32_t entryPoint = 0; std::vector<uint64_t> tlsCallbacks; };
HANDLE openTargetThread(DWORD threadId);
RemotePeInfo readRemotePeInfo(HANDLE process, uint64_t base) {
  IMAGE_DOS_HEADER dos{};
  if (!readRemote(process, base, &dos, sizeof(dos)) || dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0 || dos.e_lfanew > 1024 * 1024) {
    fail("mapped module has an invalid DOS header");
  }
  IMAGE_NT_HEADERS64 nt{};
  if (!readRemote(process, base + static_cast<uint32_t>(dos.e_lfanew), &nt, sizeof(nt)) || nt.Signature != IMAGE_NT_SIGNATURE ||
      nt.FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 || nt.FileHeader.NumberOfSections == 0 || nt.FileHeader.NumberOfSections > 96 ||
      nt.OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC || nt.OptionalHeader.SizeOfImage == 0 || nt.OptionalHeader.SizeOfImage > kMaxImageBytes) {
    fail("mapped module is not a valid Windows x86-64 PE image");
  }
  RemotePeInfo result;
  result.image.imageSize = nt.OptionalHeader.SizeOfImage;
  result.image.sectionAlignment = nt.OptionalHeader.SectionAlignment;
  result.entryPoint = nt.OptionalHeader.AddressOfEntryPoint;
  const uint64_t sectionTable = base + static_cast<uint32_t>(dos.e_lfanew) + 24 + nt.FileHeader.SizeOfOptionalHeader;
  std::vector<IMAGE_SECTION_HEADER> sections(nt.FileHeader.NumberOfSections);
  if (!readRemote(process, sectionTable, sections.data(), sections.size() * sizeof(IMAGE_SECTION_HEADER))) fail("mapped module section table is unreadable");
  for (const IMAGE_SECTION_HEADER& section : sections) {
    const uint32_t span = std::max(section.Misc.VirtualSize, section.SizeOfRawData);
    if (span == 0) continue;
    if (section.VirtualAddress > result.image.imageSize || span > result.image.imageSize - section.VirtualAddress) fail("mapped module section exceeds SizeOfImage");
    result.image.sections.push_back({section.VirtualAddress, span, section.Characteristics});
  }
  const IMAGE_DATA_DIRECTORY tls = nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_TLS];
  if (tls.VirtualAddress != 0 && tls.Size >= sizeof(IMAGE_TLS_DIRECTORY64)) {
    if (tls.VirtualAddress > result.image.imageSize || sizeof(IMAGE_TLS_DIRECTORY64) > result.image.imageSize - tls.VirtualAddress) fail("mapped module TLS directory is out of range");
    IMAGE_TLS_DIRECTORY64 tlsDirectory{};
    if (!readRemote(process, base + tls.VirtualAddress, &tlsDirectory, sizeof(tlsDirectory))) fail("mapped module TLS directory is unreadable");
    if (tlsDirectory.AddressOfCallBacks != 0) {
      bool terminated = false;
      for (size_t index = 0; index < 128; index++) {
        uint64_t callback = 0;
        if (!readRemote(process, tlsDirectory.AddressOfCallBacks + index * sizeof(uint64_t), &callback, sizeof(callback))) fail("mapped module TLS callback array is unreadable");
        if (callback == 0) { terminated = true; break; }
        result.tlsCallbacks.push_back(callback);
      }
      if (!terminated) fail("mapped module TLS callback array exceeds 128 entries");
    }
  }
  return result;
}

std::wstring normalizedPath(std::wstring path) {
  wchar_t buffer[32768]{};
  const DWORD count = GetFullPathNameW(path.c_str(), static_cast<DWORD>(std::size(buffer)), buffer, nullptr);
  if (count == 0 || count >= std::size(buffer)) return std::filesystem::path(path).lexically_normal().wstring();
  return std::filesystem::path(std::wstring(buffer, count)).lexically_normal().wstring();
}
bool pathStartsWith(const std::wstring& value, const std::wstring& prefix) {
  if (value.size() < prefix.size() || _wcsnicmp(value.c_str(), prefix.c_str(), prefix.size()) != 0) return false;
  return value.size() == prefix.size() || value[prefix.size()] == L'\\' || value[prefix.size()] == L'/';
}
bool isSystemModulePath(RemoteSession& session, const std::wstring& path) {
  const std::wstring normalized = normalizedPath(path);
  if (pathStartsWith(normalized, session.windowsDirectory)) return true;
  std::wstring lowered = normalized;
  std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](wchar_t ch) { return static_cast<wchar_t>(towlower(ch)); });
  return lowered.find(L"\\winsxs\\") != std::wstring::npos || lowered.find(L"/winsxs/") != std::wstring::npos;
}
std::wstring modulePathForBase(DWORD processId, uint64_t base) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, processId);
  if (snapshot == INVALID_HANDLE_VALUE) fail("could not enumerate mapped target modules");
  MODULEENTRY32W module{};
  module.dwSize = sizeof(module);
  std::wstring result;
  if (Module32FirstW(snapshot, &module)) {
    do {
      if (reinterpret_cast<uint64_t>(module.modBaseAddr) == base) { result = module.szExePath; break; }
    } while (Module32NextW(snapshot, &module));
  }
  CloseHandle(snapshot);
  if (result.empty()) fail("could not determine path of a newly mapped target module");
  return result;
}
std::wstring modulePathFromDebugEvent(HANDLE file, DWORD processId, uint64_t base) {
  if (file && file != INVALID_HANDLE_VALUE) {
    wchar_t buffer[32768]{};
    const DWORD count = GetFinalPathNameByHandleW(file, buffer, static_cast<DWORD>(std::size(buffer)), FILE_NAME_NORMALIZED | VOLUME_NAME_DOS);
    if (count > 0 && count < std::size(buffer)) {
      std::wstring path(buffer, count);
      if (path.rfind(L"\\\\?\\UNC\\", 0) == 0) path = L"\\\\" + path.substr(8);
      else if (path.rfind(L"\\\\?\\", 0) == 0) path.erase(0, 4);
      return normalizedPath(std::move(path));
    }
  }
  return modulePathForBase(processId, base);
}

void writeCodeByte(RemoteSession& session, uint64_t address, uint8_t value, const std::string& where) {
  SYSTEM_INFO systemInfo{};
  GetSystemInfo(&systemInfo);
  const uint64_t page = address & ~(static_cast<uint64_t>(systemInfo.dwPageSize) - 1);
  DWORD oldProtection = 0;
  if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(page), systemInfo.dwPageSize, PAGE_EXECUTE_READWRITE, &oldProtection)) fail(where + ": could not make code page temporarily writable");
  const bool written = writeRemote(session.process, address, &value, 1);
  const bool flushed = written && FlushInstructionCache(session.process, reinterpret_cast<LPCVOID>(address), 1) != FALSE;
  DWORD discarded = 0;
  const bool restored = VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(page), systemInfo.dwPageSize, oldProtection, &discarded) != FALSE;
  if (!written || !flushed || !restored) fail(where + ": code byte update/flush/protection restore failed");
}
void armBreakpoint(RemoteSession& session, uint64_t address) {
  if (session.breakpoints.contains(address)) return;
  uint8_t original = 0;
  if (!readRemote(session.process, address, &original, 1)) fail("could not read a game initializer gate byte");
  if (original == 0xcc) fail("cannot safely gate an initializer whose first byte is already INT3");
  writeCodeByte(session, address, 0xcc, "initializer gate");
  session.breakpoints.emplace(address, original);
}
void armModuleGates(RemoteSession& session, uint64_t base, const std::wstring& path, bool mainImage) {
  if (!mainImage && isSystemModulePath(session, path)) return;
  const RemotePeInfo pe = readRemotePeInfo(session.process, base);
  auto requireExecutable = [&](uint64_t address, const std::string& where) {
    const uint64_t rva = address - base;
    for (const PeSection& section : pe.image.sections) {
      if ((section.characteristics & IMAGE_SCN_MEM_EXECUTE) && rva >= section.rva && rva - section.rva < section.size) return;
    }
    fail(where + " does not point into an executable mapped section");
  };
  for (uint64_t callback : pe.tlsCallbacks) {
    if (callback < base || callback - base >= pe.image.imageSize) fail("TLS callback escapes its mapped module");
    requireExecutable(callback, "TLS callback");
    armBreakpoint(session, callback);
  }
  if (pe.entryPoint != 0) {
    if (pe.entryPoint >= pe.image.imageSize) fail("module entrypoint exceeds SizeOfImage");
    const uint64_t entry = base + pe.entryPoint;
    requireExecutable(entry, "module entrypoint");
    armBreakpoint(session, entry);
    if (mainImage) session.targetEntryPoint = entry;
  }
}

void restoreAllBreakpoints(RemoteSession& session) {
  for (const auto& [address, original] : session.breakpoints) writeCodeByte(session, address, original, "initializer gate restore");
  session.breakpoints.clear();
}

bool handleStartupBreakpoint(RemoteSession& session, const DEBUG_EVENT& event) {
  const uint64_t address = reinterpret_cast<uint64_t>(event.u.Exception.ExceptionRecord.ExceptionAddress);
  const auto found = session.breakpoints.find(address);
  if (found == session.breakpoints.end()) {
    if (!session.sawInitialBreakpoint) { session.sawInitialBreakpoint = true; return false; }
    fail("unexpected breakpoint occurred before a safe native patch gate");
  }
  writeCodeByte(session, address, found->second, "initializer gate hit");
  HANDLE thread = openTargetThread(event.dwThreadId);
  CONTEXT context{};
  context.ContextFlags = CONTEXT_ALL;
  if (!GetThreadContext(thread, &context)) { CloseHandle(thread); fail("could not capture full initializer gate context"); }
  context.Rip = address;
  if (!SetThreadContext(thread, &context)) { CloseHandle(thread); fail("could not rewind initializer gate context"); }
  CloseHandle(thread);
  session.pendingEvent = event;
  session.hasPendingEvent = true;
  session.gateAddress = address;
  session.gateThreadId = event.dwThreadId;
  session.activationGateReached = true;
  return true;
}

std::vector<uint8_t> loadPayload(const Json& block, size_t declaredSize) {
  if (declaredSize == 0 || declaredSize > kMaxBlockBytes) fail("block size is outside the 64 MiB limit");
  const std::wstring payloadPath = widen(stringOf(required(block, "payload_path", "block"), "block.payload_path"));
  std::vector<uint8_t> bytes = readBinaryFile(payloadPath, declaredSize);
  if (bytes.size() != declaredSize) fail("block payload size does not match its plan");
  const std::string expectedHash = lowerAscii(stringOf(required(block, "sha256", "block"), "block.sha256"));
  if (sha256(bytes) != expectedHash) fail("block payload SHA-256 mismatch");
  return bytes;
}

std::vector<PackageWork> loadPackages(const Json& plan) {
  const Json& packagesValue = required(plan, "packages", "plan");
  const auto& packageNodes = arrayOf(packagesValue, "plan.packages");
  if (packageNodes.empty() || packageNodes.size() > kMaxPackages) fail("selected package count is outside the supported range");
  std::vector<PackageWork> packages;
  packages.reserve(packageNodes.size());
  std::set<std::string> packageIds;
  size_t totalPayload = 0;
  for (const Json& packageNode : packageNodes) {
    objectOf(packageNode, "package");
    PackageWork package;
    package.node = &packageNode;
    package.id = stringOf(required(packageNode, "id", "package"), "package.id");
    if (package.id.empty() || !packageIds.insert(package.id).second) fail("duplicate or empty native package ID");
    for (const Json& blockNode : arrayOf(required(packageNode, "blocks", package.id), package.id + ".blocks")) {
      const std::string blockId = stringOf(required(blockNode, "id", "block"), "block.id");
      const uint64_t blockSize = uintOf(required(blockNode, "size", "block"), "block.size");
      const uint64_t alignment = uintOf(required(blockNode, "alignment", "block"), "block.alignment");
      const std::string protection = stringOf(required(blockNode, "protection", "block"), "block.protection");
      if (blockSize == 0 || blockSize > kMaxBlockBytes || alignment == 0 || alignment > 1024 * 1024 || (alignment & (alignment - 1)) != 0) {
        fail(package.id + ": invalid block size or alignment");
      }
      if (protection != "rx" && protection != "r" && protection != "rw") fail(package.id + ": invalid block protection");
      if (totalPayload > kMaxTotalPayloadBytes - blockSize) fail("selected payloads exceed the 512 MiB limit");
      totalPayload += static_cast<size_t>(blockSize);
      BlockWork block;
      block.id = blockId;
      block.size = static_cast<size_t>(blockSize);
      block.alignment = static_cast<size_t>(alignment);
      block.protection = protection;
      block.bytes = loadPayload(blockNode, block.size);
      if (!package.blocks.emplace(block.id, std::move(block)).second) fail(package.id + ": duplicate block ID");
    }
    const auto& symbols = objectOf(required(packageNode, "symbols", package.id), package.id + ".symbols");
    for (const auto& [name, reference] : symbols) package.symbols.emplace(name, &reference);
    packages.push_back(std::move(package));
  }
  return packages;
}

std::vector<int> parsePattern(const std::string& pattern, const std::string& where) {
  std::istringstream input(pattern);
  std::vector<int> result;
  std::string token;
  while (input >> token) {
    if (token == "??") result.push_back(-1);
    else if (token.size() == 2) {
      std::vector<uint8_t> byte = parseHexBytes(token, where);
      result.push_back(byte[0]);
    } else fail(where + " has an invalid pattern token");
    if (result.size() > 4096) fail(where + " exceeds the 4096-byte signature limit");
  }
  if (result.empty() || std::all_of(result.begin(), result.end(), [](int byte) { return byte < 0; })) fail(where + " has no fixed signature bytes");
  return result;
}

uint64_t alignUp(uint64_t value, uint64_t alignment);

bool pageReadableForScan(DWORD protection) {
  if ((protection & PAGE_GUARD) != 0) return false;
  switch (protection & 0xff) {
    case PAGE_READONLY:
    case PAGE_READWRITE:
    case PAGE_WRITECOPY:
    case PAGE_EXECUTE_READ:
    case PAGE_EXECUTE_READWRITE:
    case PAGE_EXECUTE_WRITECOPY:
      return true;
    default:
      return false;
  }
}

void scanMappedSection(HANDLE process, uint64_t sectionStart, uint64_t sectionEnd,
    const std::vector<int>& pattern, size_t& matchCount, uint64_t& matchAddress) {
  SYSTEM_INFO systemInfo{};
  GetSystemInfo(&systemInfo);
  std::vector<uint8_t> carry;
  uint64_t lastReadableEnd = 0;
  uint64_t cursor = sectionStart;
  while (cursor < sectionEnd && matchCount < 2) {
    MEMORY_BASIC_INFORMATION region{};
    if (VirtualQueryEx(process, reinterpret_cast<LPCVOID>(cursor), &region, sizeof(region)) != sizeof(region) || region.RegionSize == 0) {
      carry.clear();
      lastReadableEnd = 0;
      cursor = std::min<uint64_t>(sectionEnd, alignUp(cursor + 1, systemInfo.dwPageSize));
      continue;
    }
    const uint64_t regionBase = reinterpret_cast<uint64_t>(region.BaseAddress);
    if (regionBase > UINT64_MAX - region.RegionSize) fail("target memory region address overflow during signature scan");
    const uint64_t regionEnd = std::min<uint64_t>(sectionEnd, regionBase + region.RegionSize);
    if (regionEnd <= cursor) fail("target memory query did not advance during signature scan");
    const bool readable = region.State == MEM_COMMIT && pageReadableForScan(region.Protect);
    if (!readable) {
      carry.clear();
      lastReadableEnd = 0;
      cursor = regionEnd;
      continue;
    }
    if (lastReadableEnd != cursor) carry.clear();
    uint64_t readCursor = cursor;
    while (readCursor < regionEnd && matchCount < 2) {
      const size_t amount = static_cast<size_t>(std::min<uint64_t>(1024 * 1024, regionEnd - readCursor));
      std::vector<uint8_t> bytes(amount);
      if (!readRemote(process, readCursor, bytes.data(), amount)) {
        carry.clear();
        lastReadableEnd = 0;
        readCursor += amount;
        continue;
      }
      std::vector<uint8_t> combined;
      combined.reserve(carry.size() + bytes.size());
      combined.insert(combined.end(), carry.begin(), carry.end());
      combined.insert(combined.end(), bytes.begin(), bytes.end());
      const uint64_t combinedAddress = readCursor - carry.size();
      for (size_t at = 0; at + pattern.size() <= combined.size(); at++) {
        bool matches = true;
        for (size_t index = 0; index < pattern.size(); index++) {
          if (pattern[index] >= 0 && combined[at + index] != static_cast<uint8_t>(pattern[index])) { matches = false; break; }
        }
        if (matches) {
          matchCount++;
          matchAddress = combinedAddress + at;
          if (matchCount > 1) break;
        }
      }
      const size_t keep = std::min(pattern.size() - 1, combined.size());
      carry.assign(combined.end() - keep, combined.end());
      readCursor += amount;
      lastReadableEnd = readCursor;
    }
    cursor = regionEnd;
  }
}

void scanSignatures(HANDLE process, RemoteSession& session) {
  for (PackageWork& package : session.packages) {
    const auto& signatures = arrayOf(required(*package.node, "signatures", package.id), package.id + ".signatures");
    for (const Json& signature : signatures) {
      const std::string id = stringOf(required(signature, "id", "signature"), "signature.id");
      const std::string scope = signature.get("scope") ? stringOf(*signature.get("scope"), "signature.scope") : "executable";
      if (scope != "executable" && scope != "readable") fail(package.id + ": signature scope must be executable or readable");
      const std::vector<int> pattern = parsePattern(stringOf(required(signature, "pattern", "signature"), "signature.pattern"), package.id + ".signatures." + id);
      size_t matchCount = 0;
      uint64_t matchAddress = 0;
      for (const PeSection& section : session.pe.sections) {
        const bool executable = (section.characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;
        const bool readable = (section.characteristics & IMAGE_SCN_MEM_READ) != 0;
        if (scope == "executable" ? !executable : !readable) continue;
        if (section.size < pattern.size()) continue;
        const uint64_t start = session.moduleBase + section.rva;
        scanMappedSection(process, start, start + section.size, pattern, matchCount, matchAddress);
        if (matchCount > 1) break;
      }
      if (matchCount != 1) fail(package.id + ": signature '" + id + "' matched " + std::to_string(matchCount) + " locations; expected exactly one");
      if (!package.signatures.emplace(id, matchAddress).second) fail(package.id + ": duplicate signature ID");
    }
  }
}

struct ResolvedAddress { uint64_t value; bool module; };
ResolvedAddress resolveReference(RemoteSession& session, PackageWork& package, const Json& reference, size_t depth = 0, std::set<std::string>* activeSymbols = nullptr) {
  if (depth > 64) fail(package.id + ": address reference nesting is too deep");
  objectOf(reference, "address reference");
  if (const Json* module = reference.get("module")) {
    if (stringOf(*module, "reference.module") != "game") fail(package.id + ": unsupported module reference");
    const uint64_t rva = parseHexU64(stringOf(required(reference, "rva", "module reference"), "reference.rva"), "reference.rva");
    if (rva > session.pe.imageSize) fail(package.id + ": module RVA exceeds SizeOfImage");
    return {session.moduleBase + rva, true};
  }
  if (const Json* blockId = reference.get("block")) {
    const std::string id = stringOf(*blockId, "reference.block");
    const auto found = package.blocks.find(id);
    if (found == package.blocks.end()) fail(package.id + ": unknown block reference '" + id + "'");
    const uint64_t offset = uintOf(required(reference, "offset", "block reference"), "reference.offset");
    if (offset > found->second.size) fail(package.id + ": block reference exceeds block size");
    return {found->second.address + offset, false};
  }
  if (const Json* symbol = reference.get("symbol")) {
    const std::string name = stringOf(*symbol, "reference.symbol");
    const auto found = package.symbols.find(name);
    if (found == package.symbols.end()) fail(package.id + ": unknown package symbol '" + name + "'");
    std::set<std::string> localActive;
    if (!activeSymbols) activeSymbols = &localActive;
    if (!activeSymbols->insert(name).second) fail(package.id + ": cycle in package symbols");
    ResolvedAddress result = resolveReference(session, package, *found->second, depth + 1, activeSymbols);
    activeSymbols->erase(name);
    return result;
  }
  if (const Json* signature = reference.get("signature")) {
    const std::string id = stringOf(*signature, "reference.signature");
    const auto found = package.signatures.find(id);
    if (found == package.signatures.end()) fail(package.id + ": unknown signature '" + id + "'");
    const int64_t offset = reference.get("offset") ? intOf(*reference.get("offset"), "reference.offset") : 0;
    const uint64_t value = checkedAdd(found->second, offset, package.id + ".signature");
    if (!isMappedModuleRange(session, value, 1)) fail(package.id + ": signature offset escapes mapped game image sections");
    return {value, true};
  }
  if (const Json* relative = reference.get("relative")) {
    const Json& from = required(*relative, "from", "relative reference");
    const ResolvedAddress start = resolveReference(session, package, from, depth + 1, activeSymbols);
    const std::string kind = stringOf(required(*relative, "kind", "relative reference"), "relative.kind");
    const uint64_t operandOffset = uintOf(required(*relative, "operand_offset", "relative reference"), "relative.operand_offset");
    const uint64_t instructionEndOffset = uintOf(required(*relative, "instruction_end_offset", "relative reference"), "relative.instruction_end_offset");
    const size_t width = kind == "rel8" ? 1 : kind == "rel32" ? 4 : 0;
    if (width == 0 || operandOffset > instructionEndOffset || width > instructionEndOffset - operandOffset || instructionEndOffset == 0 || instructionEndOffset > 1024 * 1024) fail(package.id + ": invalid derived relative reference");
    std::vector<uint8_t> operand;
    auto containingBlock = package.blocks.end();
    for (auto it = package.blocks.begin(); it != package.blocks.end(); ++it) {
      if (start.value >= it->second.address && start.value <= it->second.address + it->second.size && instructionEndOffset <= it->second.size - static_cast<size_t>(start.value - it->second.address)) { containingBlock = it; break; }
    }
    if (containingBlock != package.blocks.end()) {
      const size_t sourceOffset = static_cast<size_t>(start.value - containingBlock->second.address + operandOffset);
      operand.assign(containingBlock->second.bytes.begin() + sourceOffset, containingBlock->second.bytes.begin() + sourceOffset + width);
    } else {
      if (!start.module || !isMappedModuleRange(session, start.value, static_cast<size_t>(instructionEndOffset))) {
        fail(package.id + ": derived relative instruction escapes a mapped module section or block");
      }
      operand = readRemoteBytes(session.process, start.value + operandOffset, width, "relative address operand");
    }
    int64_t displacement;
    if (kind == "rel8") displacement = static_cast<int8_t>(operand[0]);
    else { int32_t value = 0; std::memcpy(&value, operand.data(), 4); displacement = value; }
    const uint64_t endAddress = checkedAdd(start.value, static_cast<int64_t>(instructionEndOffset), package.id + ".relative");
    const uint64_t result = checkedAdd(endAddress, displacement, package.id + ".relative");
    if (isMappedModuleRange(session, result, 1)) return {result, true};
    if (isBlockRange(session, result, 1)) return {result, false};
    fail(package.id + ": derived relative target escapes mapped game or package memory");
  }
  fail(package.id + ": unsupported address reference");
}

void prepareGuardAndWrites(RemoteSession& session) {
  for (PackageWork& package : session.packages) {
    for (const Json& guard : arrayOf(required(*package.node, "guards", package.id), package.id + ".guards")) {
      const ResolvedAddress address = resolveReference(session, package, required(guard, "at", "guard"));
      std::vector<uint8_t> expected = parseHexBytes(stringOf(required(guard, "expected", "guard"), "guard.expected"), "guard.expected");
      if (expected.empty() || !isInsideModule(session, address.value, expected.size())) fail(package.id + ": guard does not resolve wholly inside the game image");
      session.guards.push_back({&package, &guard, address.value, std::move(expected)});
    }
    std::set<std::string> ids;
    for (const Json& write : arrayOf(required(*package.node, "writes", package.id), package.id + ".writes")) {
      auto work = std::make_unique<WriteWork>();
      work->package = &package;
      work->node = &write;
      work->id = stringOf(required(write, "id", "write"), "write.id");
      if (!ids.insert(work->id).second) fail(package.id + ": duplicate write ID");
      const ResolvedAddress address = resolveReference(session, package, required(write, "at", "write"));
      work->expected = parseHexBytes(stringOf(required(write, "expected", "write"), "write.expected"), "write.expected");
      work->replacement = parseHexBytes(stringOf(required(write, "bytes", "write"), "write.bytes"), "write.bytes");
      if (work->expected.empty() || work->expected.size() != work->replacement.size() || !isInsideModule(session, address.value, work->expected.size())) {
        fail(package.id + ": write must resolve to an equal-length nonempty range inside the game image");
      }
      work->address = address.value;
      WriteWork* pointer = work.get();
      session.writesByPackage[package.id].push_back(pointer);
      session.writes.push_back(std::move(work));
    }
  }
  std::sort(session.writes.begin(), session.writes.end(), [](const auto& first, const auto& second) { return first->address < second->address; });
  for (size_t index = 1; index < session.writes.size(); index++) {
    const WriteWork& previous = *session.writes[index - 1];
    const WriteWork& current = *session.writes[index];
    if (current.address < previous.address + previous.expected.size()) {
      fail("resolved module writes overlap: " + previous.package->id + "." + previous.id + " and " + current.package->id + "." + current.id);
    }
  }
  for (const GuardWork& guard : session.guards) {
    const std::vector<uint8_t> actual = readRemoteBytes(session.process, guard.address, guard.expected.size(), "guard");
    if (actual != guard.expected) fail(guard.package->id + ": guard bytes do not match the unpatched game image");
  }
  for (const auto& write : session.writes) {
    const std::vector<uint8_t> actual = readRemoteBytes(session.process, write->address, write->expected.size(), "write expectation");
    if (actual != write->expected) fail(write->package->id + ": expected bytes do not match the unpatched game image at write " + write->id);
  }
}

WriteWork* findPackageWrite(RemoteSession& session, PackageWork& package, const std::string& id) {
  for (WriteWork* write : session.writesByPackage[package.id]) if (write->id == id) return write;
  return nullptr;
}

ResolvedAddress resolveWriteReference(RemoteSession& session, PackageWork& package, const Json& value, const std::string& where) {
  const std::string id = stringOf(required(value, "write", where), where + ".write");
  const uint64_t offset = uintOf(required(value, "offset", where), where + ".offset");
  WriteWork* write = findPackageWrite(session, package, id);
  if (!write) fail(package.id + ": " + where + " references unknown write '" + id + "'");
  if (offset > write->replacement.size()) fail(package.id + ": " + where + " offset exceeds write length");
  return {write->address + offset, true};
}

void putLittleEndian(std::vector<uint8_t>& bytes, size_t offset, uint64_t value, size_t width, const std::string& where) {
  if (offset > bytes.size() || width > bytes.size() - offset) fail(where + " fixup field exceeds its target buffer");
  for (size_t index = 0; index < width; index++) bytes[offset + index] = static_cast<uint8_t>(value >> (index * 8));
}

void applyFixups(RemoteSession& session) {
  for (PackageWork& package : session.packages) {
    for (const Json& fixup : arrayOf(required(*package.node, "fixups", package.id), package.id + ".fixups")) {
      const std::string kind = stringOf(required(fixup, "kind", "fixup"), "fixup.kind");
      const Json& at = required(fixup, "at", "fixup");
      std::vector<uint8_t>* targetBytes = nullptr;
      size_t fieldOffset = static_cast<size_t>(uintOf(required(at, "offset", "fixup.at"), "fixup.at.offset"));
      std::string where = package.id + ".fixup." + kind;
      if (const Json* blockName = at.get("block")) {
        const std::string blockId = stringOf(*blockName, "fixup.at.block");
        const auto block = package.blocks.find(blockId);
        if (block == package.blocks.end()) fail(where + " references an unknown block");
        targetBytes = &block->second.bytes;
      } else if (const Json* writeName = at.get("write")) {
        const std::string writeId = stringOf(*writeName, "fixup.at.write");
        WriteWork* write = findPackageWrite(session, package, writeId);
        if (!write) fail(where + " references an unknown write");
        targetBytes = &write->replacement;
      } else fail(where + " has an invalid fixup destination");
      const size_t width = kind == "rel8" ? 1 : kind == "abs64" ? 8 : kind == "rel32" || kind == "rva32" ? 4 : 0;
      if (width == 0 || fieldOffset > targetBytes->size() || width > targetBytes->size() - fieldOffset) fail(where + " has an invalid field range");
      ResolvedAddress target = resolveReference(session, package, required(fixup, "target", "fixup"));
      const int64_t addend = fixup.get("addend") ? intOf(*fixup.get("addend"), "fixup.addend") : 0;
      const uint64_t adjustedTarget = checkedAdd(target.value, addend, where);
      uint64_t encoded = 0;
      if (kind == "rel8" || kind == "rel32") {
        const Json& relativeTo = required(fixup, "relative_to", "relative fixup");
        const ResolvedAddress base = relativeTo.get("write") ? resolveWriteReference(session, package, relativeTo, "fixup.relative_to") : resolveReference(session, package, relativeTo);
        const int64_t displacement = checkedDifference(adjustedTarget, base.value, where);
        if (kind == "rel8") {
          if (displacement < INT8_MIN || displacement > INT8_MAX) fail(where + " displacement does not fit signed rel8");
          encoded = static_cast<uint8_t>(static_cast<int8_t>(displacement));
        } else {
          if (displacement < INT32_MIN || displacement > INT32_MAX) fail(where + " displacement does not fit signed rel32");
          encoded = static_cast<uint32_t>(static_cast<int32_t>(displacement));
        }
      } else if (kind == "abs64") encoded = adjustedTarget;
      else {
        const ResolvedAddress base = resolveReference(session, package, required(fixup, "base", "rva32 fixup"));
        const int64_t displacement = checkedDifference(adjustedTarget, base.value, where);
        if (displacement < 0 || static_cast<uint64_t>(displacement) > UINT32_MAX) fail(where + " RVA does not fit unsigned rva32");
        encoded = static_cast<uint32_t>(displacement);
      }
      putLittleEndian(*targetBytes, fieldOffset, encoded, width, where);
    }
  }
}

uint64_t alignUp(uint64_t value, uint64_t alignment) {
  if (alignment == 0 || (alignment & (alignment - 1)) != 0) fail("invalid allocation alignment");
  if (value > UINT64_MAX - (alignment - 1)) fail("allocation address overflow");
  return (value + alignment - 1) & ~(alignment - 1);
}

uint64_t allocateBlock(RemoteSession& session, size_t blockSize, size_t alignment) {
  SYSTEM_INFO systemInfo{};
  GetSystemInfo(&systemInfo);
  const uint64_t granularity = std::max<uint64_t>(systemInfo.dwAllocationGranularity, alignment);
  const uint64_t page = systemInfo.dwPageSize;
  const uint64_t allocationBytes = alignUp(blockSize, page);
  const uint64_t minAddress = alignUp(session.moduleBase + session.pe.imageSize, granularity);
  const uint64_t maxAddress = session.moduleBase + 0x80000000ull;
  for (uint64_t candidate = minAddress; candidate < maxAddress && allocationBytes <= maxAddress - candidate; candidate += granularity) {
    LPVOID address = VirtualAllocEx(session.process, reinterpret_cast<LPVOID>(candidate), static_cast<SIZE_T>(allocationBytes), MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
    if (!address) continue;
    const uint64_t allocated = reinterpret_cast<uint64_t>(address);
    if (allocated < minAddress || allocated % alignment != 0 || allocated > maxAddress || allocationBytes > maxAddress - allocated) {
      VirtualFreeEx(session.process, address, 0, MEM_RELEASE);
      continue;
    }
    session.remoteAllocations.push_back(allocated);
    return allocated;
  }
  fail("could not allocate a native block inside the permitted +2 GiB module window");
}

void allocateBlocks(RemoteSession& session) {
  for (PackageWork& package : session.packages) {
    for (auto& [id, block] : package.blocks) {
      block.address = allocateBlock(session, block.size, block.alignment);
    }
  }
}

void writePreparedBlocks(RemoteSession& session) {
  for (PackageWork& package : session.packages) {
    for (auto& [id, block] : package.blocks) {
      if (!writeRemote(session.process, block.address, block.bytes.data(), block.bytes.size())) fail(package.id + ": could not write block " + id);
      if (readRemoteBytes(session.process, block.address, block.bytes.size(), "prepared block readback") != block.bytes) {
        fail(package.id + ": block readback failed for " + id);
      }
      DWORD protection = block.protection == "rx" ? PAGE_EXECUTE_READ : block.protection == "r" ? PAGE_READONLY : PAGE_READWRITE;
      DWORD oldProtection = 0;
      SYSTEM_INFO systemInfo{};
      GetSystemInfo(&systemInfo);
      const SIZE_T protectedSize = static_cast<SIZE_T>(alignUp(block.size, systemInfo.dwPageSize));
      if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(block.address), protectedSize, protection, &oldProtection)) {
        fail(package.id + ": could not apply final protection to block " + id);
      }
      if (block.protection == "rx" && !FlushInstructionCache(session.process, reinterpret_cast<LPCVOID>(block.address), block.size)) {
        fail(package.id + ": could not flush instruction cache for block " + id);
      }
    }
  }
}

struct RuntimeEntry { uint32_t begin; uint32_t end; uint32_t unwind; };

std::vector<RuntimeEntry> buildRuntimeEntries(RemoteSession& session) {
  std::vector<RuntimeEntry> entries;
  for (PackageWork& package : session.packages) {
    for (const Json& function : arrayOf(required(*package.node, "runtime_functions", package.id), package.id + ".runtime_functions")) {
      const ResolvedAddress begin = resolveReference(session, package, required(function, "begin", "runtime function"));
      const ResolvedAddress end = resolveReference(session, package, required(function, "end", "runtime function"));
      const ResolvedAddress unwind = resolveReference(session, package, required(function, "unwind", "runtime function"));
      if (begin.value >= end.value || end.value - begin.value > SIZE_MAX) fail(package.id + ": invalid runtime function range");
      const size_t codeSize = static_cast<size_t>(end.value - begin.value);
      const bool moduleCode = isMappedModuleRange(session, begin.value, codeSize, IMAGE_SCN_MEM_EXECUTE);
      const bool blockCode = isBlockRange(session, begin.value, codeSize, true, true) && isBlockRange(session, end.value, 0, true, true);
      if (!moduleCode && !blockCode) fail(package.id + ": runtime function code must be wholly inside an executable image section or RX block");
      const bool moduleUnwind = isMappedModuleRange(session, unwind.value, 4);
      const bool blockUnwind = isBlockRange(session, unwind.value, 4, false);
      if (!moduleUnwind && !blockUnwind) fail(package.id + ": unwind data must point to four mapped bytes in the image or a package block");
      if (unwind.value % 4 != 0) fail(package.id + ": unwind information must be 4-byte aligned");
      if (begin.value < session.moduleBase || end.value < session.moduleBase || unwind.value < session.moduleBase) fail(package.id + ": runtime function pointers must be inside the permitted module window");
      const uint64_t beginRva = begin.value - session.moduleBase;
      const uint64_t endRva = end.value - session.moduleBase;
      const uint64_t unwindRva = unwind.value - session.moduleBase;
      if (beginRva > 0x80000000ull || endRva > 0x80000000ull || unwindRva > 0x80000000ull ||
          beginRva > UINT32_MAX || endRva > UINT32_MAX || unwindRva > UINT32_MAX || endRva <= beginRva) {
        fail(package.id + ": runtime function RVA exceeds the Windows x64 table range");
      }
      entries.push_back({static_cast<uint32_t>(beginRva), static_cast<uint32_t>(endRva), static_cast<uint32_t>(unwindRva)});
    }
  }
  std::sort(entries.begin(), entries.end(), [](const RuntimeEntry& first, const RuntimeEntry& second) { return first.begin < second.begin; });
  for (size_t index = 1; index < entries.size(); index++) {
    if (entries[index].begin < entries[index - 1].end) fail("runtime function ranges overlap");
  }
  return entries;
}

uint64_t findRemoteNtdll(HANDLE process, DWORD processId) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, processId);
  if (snapshot == INVALID_HANDLE_VALUE) fail("could not enumerate target modules for unwind registration");
  MODULEENTRY32W module{};
  module.dwSize = sizeof(module);
  uint64_t result = 0;
  if (Module32FirstW(snapshot, &module)) {
    do {
      if (_wcsicmp(module.szModule, L"ntdll.dll") == 0) {
        result = reinterpret_cast<uint64_t>(module.modBaseAddr);
        break;
      }
    } while (Module32NextW(snapshot, &module));
  }
  CloseHandle(snapshot);
  if (!result) fail("target ntdll.dll is not available before initialization");
  (void)process;
  return result;
}

uint64_t findRemoteExport(HANDLE process, uint64_t moduleBase, const std::string& name) {
  IMAGE_DOS_HEADER dos{};
  if (!readRemote(process, moduleBase, &dos, sizeof(dos)) || dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < 0) fail("target ntdll DOS header could not be read");
  const uint64_t ntAddress = moduleBase + static_cast<uint32_t>(dos.e_lfanew);
  IMAGE_NT_HEADERS64 nt{};
  if (!readRemote(process, ntAddress, &nt, sizeof(nt)) || nt.Signature != IMAGE_NT_SIGNATURE || nt.OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC) {
    fail("target ntdll PE header could not be read");
  }
  const IMAGE_DATA_DIRECTORY exports = nt.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT];
  if (exports.VirtualAddress == 0 || exports.Size < sizeof(IMAGE_EXPORT_DIRECTORY)) fail("target ntdll has no export directory");
  IMAGE_EXPORT_DIRECTORY directory{};
  if (!readRemote(process, moduleBase + exports.VirtualAddress, &directory, sizeof(directory)) || directory.NumberOfNames > 200000) fail("target ntdll export directory is invalid");
  for (uint32_t index = 0; index < directory.NumberOfNames; index++) {
    uint32_t nameRva = 0;
    uint16_t ordinal = 0;
    if (!readRemote(process, moduleBase + directory.AddressOfNames + static_cast<uint64_t>(index) * 4, &nameRva, sizeof(nameRva)) ||
        !readRemote(process, moduleBase + directory.AddressOfNameOrdinals + static_cast<uint64_t>(index) * 2, &ordinal, sizeof(ordinal))) {
      fail("target ntdll export names could not be read");
    }
    char exportName[256]{};
    SIZE_T copied = 0;
    if (!ReadProcessMemory(process, reinterpret_cast<LPCVOID>(moduleBase + nameRva), exportName, sizeof(exportName) - 1, &copied) || copied == 0) continue;
    exportName[sizeof(exportName) - 1] = '\0';
    if (name != exportName) continue;
    if (ordinal >= directory.NumberOfFunctions) fail("target ntdll export ordinal is invalid");
    uint32_t functionRva = 0;
    if (!readRemote(process, moduleBase + directory.AddressOfFunctions + static_cast<uint64_t>(ordinal) * 4, &functionRva, sizeof(functionRva))) {
      fail("target ntdll export address could not be read");
    }
    if (functionRva >= exports.VirtualAddress && functionRva < exports.VirtualAddress + exports.Size) fail("RtlAddFunctionTable is unexpectedly forwarded");
    return moduleBase + functionRva;
  }
  fail("RtlAddFunctionTable was not exported by target ntdll.dll");
}

uint64_t allocateRemote(RemoteSession& session, size_t size, DWORD protection) {
  void* address = VirtualAllocEx(session.process, nullptr, size, MEM_RESERVE | MEM_COMMIT, protection);
  if (!address) fail("could not allocate target bootstrap memory");
  const uint64_t value = reinterpret_cast<uint64_t>(address);
  session.remoteAllocations.push_back(value);
  return value;
}

HANDLE openTargetThread(DWORD threadId) {
  HANDLE thread = OpenThread(THREAD_GET_CONTEXT | THREAD_SET_CONTEXT | THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION, FALSE, threadId);
  if (!thread) fail("could not open target thread " + std::to_string(threadId));
  return thread;
}

void suspendOtherThreads(RemoteSession& session, DWORD excludedThreadId) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE) fail("could not enumerate target threads before unwind registration");
  THREADENTRY32 entry{};
  entry.dwSize = sizeof(entry);
  if (Thread32First(snapshot, &entry)) {
    do {
      if (entry.th32OwnerProcessID != session.processInfo.dwProcessId || entry.th32ThreadID == excludedThreadId) continue;
      HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION, FALSE, entry.th32ThreadID);
      if (!thread) {
        if (GetLastError() == ERROR_INVALID_PARAMETER) continue;
        CloseHandle(snapshot);
        fail("could not open a target thread to hold it during unwind registration");
      }
      const DWORD prior = SuspendThread(thread);
      CloseHandle(thread);
      if (prior == static_cast<DWORD>(-1)) {
        CloseHandle(snapshot);
        fail("could not hold every other target thread during unwind registration");
      }
      session.acquiredSuspends[entry.th32ThreadID]++;
    } while (Thread32Next(snapshot, &entry));
  } else if (GetLastError() != ERROR_NO_MORE_FILES) {
    CloseHandle(snapshot);
    fail("could not enumerate target threads before unwind registration");
  }
  CloseHandle(snapshot);
}

void suspendNewThread(RemoteSession& session, const DEBUG_EVENT& event) {
  HANDLE thread = event.u.CreateThread.hThread;
  const DWORD prior = SuspendThread(thread);
  if (prior == static_cast<DWORD>(-1)) fail("could not hold a thread created during unwind registration");
  session.acquiredSuspends[event.dwThreadId]++;
}

void suspendGateThread(RemoteSession& session) {
  HANDLE thread = openTargetThread(session.gateThreadId);
  const DWORD prior = SuspendThread(thread);
  CloseHandle(thread);
  if (prior == static_cast<DWORD>(-1)) fail("could not hold the initializer thread while detaching the debugger");
  session.acquiredSuspends[session.gateThreadId]++;
}

void resumeAcquiredThreadSuspends(RemoteSession& session) {
  for (const auto& [threadId, count] : session.acquiredSuspends) {
    HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION, FALSE, threadId);
    if (!thread) {
      if (GetLastError() == ERROR_INVALID_PARAMETER) continue;
      fail("could not reopen target thread to restore its suspend count");
    }
    for (unsigned index = 0; index < count; index++) {
      if (ResumeThread(thread) == static_cast<DWORD>(-1)) {
        CloseHandle(thread);
        fail("could not restore a target thread suspend count");
      }
    }
    CloseHandle(thread);
  }
  session.acquiredSuspends.clear();
}

void runRemoteAddFunctionTable(RemoteSession& session, uint64_t function, uint64_t table, size_t count) {
  if (count == 0) return;
  if (!session.hasPendingEvent || session.pendingEvent.dwDebugEventCode != EXCEPTION_DEBUG_EVENT || count > UINT32_MAX) {
    fail("unwind registration requires an active loader-gate debug stop");
  }
  const DWORD threadId = session.pendingEvent.dwThreadId;
  HANDLE thread = openTargetThread(threadId);
  suspendOtherThreads(session, threadId);
  CONTEXT original{};
  original.ContextFlags = CONTEXT_ALL;
  if (!GetThreadContext(thread, &original)) { CloseHandle(thread); fail("could not save the loader-gate thread context"); }
  CONTEXT bootstrap = original;
  const uint64_t stack = allocateRemote(session, 64 * 1024, PAGE_READWRITE);
  const uint64_t sentinelPage = allocateRemote(session, 4096, PAGE_READWRITE);
  const uint8_t int3 = 0xcc;
  if (!writeRemote(session.process, sentinelPage, &int3, 1)) fail("could not write unwind bootstrap sentinel");
  DWORD discardedProtection = 0;
  if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(sentinelPage), 4096, PAGE_EXECUTE_READ, &discardedProtection) ||
      !FlushInstructionCache(session.process, reinterpret_cast<LPCVOID>(sentinelPage), 1)) {
    fail("could not protect and flush unwind bootstrap sentinel");
  }
  uint64_t entryRsp = (stack + 64 * 1024 - 0x100) & ~static_cast<uint64_t>(0xf);
  entryRsp -= 8;
  if (entryRsp < stack || !writeRemote(session.process, entryRsp, &sentinelPage, sizeof(sentinelPage))) fail("could not prepare the unwind bootstrap stack");
  // Windows x64 entry ABI: RSP is 8 mod 16, with the 32-byte home area immediately above it.
  bootstrap.Rip = function;
  bootstrap.Rcx = table;
  bootstrap.Rdx = static_cast<uint32_t>(count);
  bootstrap.R8 = session.moduleBase;
  bootstrap.Rsp = entryRsp;
  bootstrap.ContextFlags = CONTEXT_ALL;
  if (!SetThreadContext(thread, &bootstrap)) { CloseHandle(thread); fail("could not install unwind bootstrap context"); }
  if (!ContinueDebugEvent(session.pendingEvent.dwProcessId, session.pendingEvent.dwThreadId, DBG_CONTINUE)) { CloseHandle(thread); fail("could not continue loader-gate event for unwind registration"); }
  session.hasPendingEvent = false;
  DEBUG_EVENT event{};
  const ULONGLONG deadline = GetTickCount64() + 15000;
  bool reachedSentinel = false;
  while (GetTickCount64() < deadline) {
    const DWORD wait = static_cast<DWORD>(std::min<ULONGLONG>(kDebugWaitMs, deadline - GetTickCount64()));
    if (!WaitForDebugEvent(&event, wait)) {
      if (GetLastError() == ERROR_SEM_TIMEOUT) continue;
      fail("waiting for target unwind registration failed");
    }
    if (event.dwDebugEventCode == EXCEPTION_DEBUG_EVENT &&
        event.u.Exception.ExceptionRecord.ExceptionCode == EXCEPTION_BREAKPOINT &&
        event.dwThreadId == threadId &&
        reinterpret_cast<uint64_t>(event.u.Exception.ExceptionRecord.ExceptionAddress) == sentinelPage) {
      reachedSentinel = true;
      session.pendingEvent = event;
      session.hasPendingEvent = true;
      break;
    }
    if (event.dwDebugEventCode == EXIT_PROCESS_DEBUG_EVENT) fail("target exited during unwind registration");
    if (event.dwDebugEventCode == CREATE_THREAD_DEBUG_EVENT) {
      suspendNewThread(session, event);
      ContinueDebugEvent(event.dwProcessId, event.dwThreadId, DBG_CONTINUE);
      continue;
    }
    if (event.dwDebugEventCode == EXCEPTION_DEBUG_EVENT) fail("unexpected target exception during unwind registration");
    if (event.dwDebugEventCode == LOAD_DLL_DEBUG_EVENT || event.dwDebugEventCode == CREATE_PROCESS_DEBUG_EVENT) fail("unexpected loader event during unwind registration bootstrap");
    if (!ContinueDebugEvent(event.dwProcessId, event.dwThreadId, DBG_CONTINUE)) fail("could not continue target debug event");
  }
  if (!reachedSentinel) fail("target unwind registration bootstrap timed out");
  CONTEXT returned{};
  returned.ContextFlags = CONTEXT_ALL;
  if (!GetThreadContext(thread, &returned)) { CloseHandle(thread); fail("could not inspect unwind bootstrap result"); }
  const uint64_t result = returned.Rax;
  // CONTEXT_ALL carries the complete general, flags, x87 and XMM/FltSave state.
  if (!SetThreadContext(thread, &original)) { CloseHandle(thread); fail("could not restore the complete loader-gate thread context"); }
  CloseHandle(thread);
  if (result == 0) fail("RtlAddFunctionTable returned FALSE in the target process");
}

uint64_t registerRuntimeFunctions(RemoteSession& session) {
  const std::vector<RuntimeEntry> entries = buildRuntimeEntries(session);
  if (entries.empty()) return 0;
  const uint64_t bytes = static_cast<uint64_t>(entries.size()) * sizeof(RUNTIME_FUNCTION);
  if (bytes > 16 * 1024 * 1024) fail("dynamic runtime function table exceeds its safety limit");
  const uint64_t table = allocateRemote(session, static_cast<size_t>(bytes), PAGE_READWRITE);
  std::vector<RUNTIME_FUNCTION> nativeEntries;
  nativeEntries.reserve(entries.size());
  for (const RuntimeEntry& entry : entries) nativeEntries.push_back({entry.begin, entry.end, entry.unwind});
  if (!writeRemote(session.process, table, nativeEntries.data(), nativeEntries.size() * sizeof(RUNTIME_FUNCTION))) fail("could not write the dynamic runtime function table");
  DWORD oldProtection = 0;
  if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(table), bytes, PAGE_READONLY, &oldProtection)) fail("could not make the runtime function table read-only");
  const std::vector<uint8_t> expectedTable(reinterpret_cast<const uint8_t*>(nativeEntries.data()),
      reinterpret_cast<const uint8_t*>(nativeEntries.data()) + static_cast<size_t>(bytes));
  if (readRemoteBytes(session.process, table, static_cast<size_t>(bytes), "runtime function table readback") != expectedTable) {
    fail("dynamic runtime function table readback failed");
  }
  const uint64_t ntdll = findRemoteNtdll(session.process, session.processInfo.dwProcessId);
  const uint64_t addFunctionTable = findRemoteExport(session.process, ntdll, "RtlAddFunctionTable");
  runRemoteAddFunctionTable(session, addFunctionTable, table, entries.size());
  return table;
}

void activateWrites(RemoteSession& session) {
  for (const GuardWork& guard : session.guards) {
    if (readRemoteBytes(session.process, guard.address, guard.expected.size(), "activation guard") != guard.expected) {
      fail(guard.package->id + ": guard changed before activation");
    }
  }
  for (const auto& write : session.writes) {
    if (readRemoteBytes(session.process, write->address, write->expected.size(), "activation write check") != write->expected) {
      fail(write->package->id + ": expected game bytes changed before activation");
    }
  }
  SYSTEM_INFO systemInfo{};
  GetSystemInfo(&systemInfo);
  const uint64_t pageSize = systemInfo.dwPageSize;
  std::map<uint64_t, DWORD> originalProtections;
  for (const auto& write : session.writes) {
    const uint64_t firstPage = write->address & ~(pageSize - 1);
    const uint64_t lastPage = (write->address + write->replacement.size() - 1) & ~(pageSize - 1);
    for (uint64_t page = firstPage; page <= lastPage; page += pageSize) {
      if (originalProtections.contains(page)) continue;
      DWORD oldProtection = 0;
      if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(page), pageSize, PAGE_EXECUTE_READWRITE, &oldProtection)) {
        fail("could not make all activation pages writable and executable");
      }
      originalProtections.emplace(page, oldProtection);
    }
  }
  for (const auto& write : session.writes) {
    if (!writeRemote(session.process, write->address, write->replacement.data(), write->replacement.size())) {
      fail(write->package->id + ": activation write failed; terminating the newly created game");
    }
    if (!FlushInstructionCache(session.process, reinterpret_cast<LPCVOID>(write->address), write->replacement.size())) {
      fail(write->package->id + ": instruction cache flush failed; terminating the newly created game");
    }
  }
  for (const auto& write : session.writes) {
    if (readRemoteBytes(session.process, write->address, write->replacement.size(), "activation readback") != write->replacement) {
      fail(write->package->id + ": activation readback failed; terminating the newly created game");
    }
  }
  for (const auto& [page, protection] : originalProtections) {
    DWORD discarded = 0;
    if (!VirtualProtectEx(session.process, reinterpret_cast<LPVOID>(page), pageSize, protection, &discarded)) {
      fail("could not restore original game page protections");
    }
  }
}

std::string sha256File(const std::wstring& path) {
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  BCRYPT_HASH_HANDLE hash = nullptr;
  DWORD objectBytes = 0, hashBytes = 0, copied = 0;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) < 0) fail("could not initialize target SHA-256 verification");
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, reinterpret_cast<PUCHAR>(&objectBytes), sizeof(objectBytes), &copied, 0) < 0 ||
      BCryptGetProperty(algorithm, BCRYPT_HASH_LENGTH, reinterpret_cast<PUCHAR>(&hashBytes), sizeof(hashBytes), &copied, 0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    fail("could not query target SHA-256 properties");
  }
  std::vector<uint8_t> object(objectBytes), digest(hashBytes), chunk(1024 * 1024);
  if (BCryptCreateHash(algorithm, &hash, object.data(), objectBytes, nullptr, 0, 0) < 0) {
    BCryptCloseAlgorithmProvider(algorithm, 0);
    fail("could not create target SHA-256 context");
  }
  std::ifstream file(path, std::ios::binary);
  if (!file) { BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0); fail("could not open target executable for hash verification"); }
  while (file) {
    file.read(reinterpret_cast<char*>(chunk.data()), static_cast<std::streamsize>(chunk.size()));
    const std::streamsize count = file.gcount();
    if (count > 0 && BCryptHashData(hash, chunk.data(), static_cast<ULONG>(count), 0) < 0) {
      BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0); fail("target SHA-256 update failed");
    }
  }
  if (!file.eof() || BCryptFinishHash(hash, digest.data(), hashBytes, 0) < 0) {
    BCryptDestroyHash(hash); BCryptCloseAlgorithmProvider(algorithm, 0); fail("target SHA-256 calculation failed");
  }
  BCryptDestroyHash(hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  std::ostringstream out;
  out << std::hex << std::setfill('0');
  for (uint8_t value : digest) out << std::setw(2) << static_cast<unsigned>(value);
  return out.str();
}

std::wstring quoteWindowsArgument(const std::wstring& value) {
  if (!value.empty() && value.find_first_of(L" \t\n\v\"") == std::wstring::npos) return value;
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t ch : value) {
    if (ch == L'\\') { slashes++; continue; }
    if (ch == L'\"') {
      result.append(slashes * 2 + 1, L'\\');
      result.push_back(L'\"');
      slashes = 0;
      continue;
    }
    result.append(slashes, L'\\');
    slashes = 0;
    result.push_back(ch);
  }
  result.append(slashes * 2, L'\\');
  result.push_back(L'\"');
  return result;
}

struct HelperPlan {
  std::string runId;
  std::wstring targetPath;
  std::wstring workingDirectory;
  std::vector<std::wstring> arguments;
  std::string targetSha256;
  ULONGLONG timeoutMs = 120000;
};
HelperPlan parseHelperPlan(const Json& plan) {
  if (uintOf(required(plan, "protocol", "plan"), "plan.protocol") != 1) fail("unsupported native patch helper plan protocol");
  HelperPlan result;
  result.runId = stringOf(required(plan, "runId", "plan"), "plan.runId");
  if (result.runId.empty() || result.runId.size() > 128) fail("plan.runId must be a nonempty bounded value");
  result.targetPath = widen(stringOf(required(plan, "targetPath", "plan"), "plan.targetPath"));
  result.workingDirectory = widen(stringOf(required(plan, "targetWorkingDirectory", "plan"), "plan.targetWorkingDirectory"));
  if (const Json* sha = plan.get("targetSha256")) {
    result.targetSha256 = lowerAscii(stringOf(*sha, "plan.targetSha256"));
    if (result.targetSha256.size() != 64 || !std::all_of(result.targetSha256.begin(), result.targetSha256.end(), [](char ch) { return std::isxdigit(static_cast<unsigned char>(ch)); })) {
      fail("plan.targetSha256 must be a 64-character SHA-256 digest");
    }
  }
  if (const Json* timeout = plan.get("sessionTimeoutMs")) {
    const uint64_t value = uintOf(*timeout, "plan.sessionTimeoutMs");
    if (value < 1000 || value > 10 * 60 * 1000) fail("plan.sessionTimeoutMs is outside the supported range");
    result.timeoutMs = value;
  }
  const auto& arguments = arrayOf(required(plan, "targetArguments", "plan"), "plan.targetArguments");
  if (arguments.size() > 256) fail("plan.targetArguments contains too many arguments");
  size_t totalChars = 0;
  for (const Json& argument : arguments) {
    std::wstring value = widen(stringOf(argument, "plan.targetArguments[]"));
    if (value.find(L'\0') != std::wstring::npos) fail("plan target argument contains a NUL character");
    totalChars += value.size();
    result.arguments.push_back(std::move(value));
  }
  if (totalChars > 30000) fail("plan target arguments exceed the Windows command-line limit");
  return result;
}

void validateAllocationPolicies(const Json& plan) {
  for (const Json& package : arrayOf(required(plan, "packages", "plan"), "plan.packages")) {
    const std::string packageId = stringOf(required(package, "id", "package"), "package.id");
    const Json& policy = required(package, "allocation_policy", packageId);
    if (stringOf(required(policy, "type", packageId + ".allocation_policy"), "allocation_policy.type") != "module_window" ||
        stringOf(required(policy, "module", packageId + ".allocation_policy"), "allocation_policy.module") != "game" ||
        stringOf(required(policy, "min_rva", packageId + ".allocation_policy"), "allocation_policy.min_rva") != "after_image" ||
        parseHexU64(stringOf(required(policy, "max_rva_exclusive", packageId + ".allocation_policy"), "allocation_policy.max_rva_exclusive"), "allocation_policy.max_rva_exclusive") != 0x80000000ull) {
      fail(packageId + ": unsupported native allocation policy");
    }
  }
}

std::wstring activeMutexName(const std::wstring& targetPath) {
  uint64_t hash = 1469598103934665603ull;
  for (wchar_t ch : normalizedPath(targetPath)) {
    const wchar_t folded = static_cast<wchar_t>(towlower(ch));
    hash ^= static_cast<uint16_t>(folded);
    hash *= 1099511628211ull;
  }
  std::wostringstream name;
  name << L"Local\\WH3MM.NativePatch." << std::hex << hash;
  return name.str();
}

void continueEvent(const DEBUG_EVENT& event, DWORD status = DBG_CONTINUE) {
  if (!ContinueDebugEvent(event.dwProcessId, event.dwThreadId, status)) fail("could not continue target debug event");
}

void waitForLoaderGate(RemoteSession& session, const HelperPlan& plan, const ULONGLONG deadline) {
  bool sawCreateProcess = false;
  while (!session.activationGateReached) {
    if (WaitForSingleObject(session.process, 0) == WAIT_OBJECT_0) fail("game exited before a safe initializer gate was reached");
    const ULONGLONG now = GetTickCount64();
    if (now >= deadline) fail("timed out waiting for the game initializer gate");
    DEBUG_EVENT event{};
    const DWORD wait = static_cast<DWORD>(std::min<ULONGLONG>(kDebugWaitMs, deadline - now));
    if (!WaitForDebugEvent(&event, wait)) {
      if (GetLastError() == ERROR_SEM_TIMEOUT) continue;
      fail("waiting for game loader events failed");
    }
    switch (event.dwDebugEventCode) {
      case CREATE_PROCESS_DEBUG_EVENT: {
        if (sawCreateProcess) fail("received an unexpected second process-create event");
        sawCreateProcess = true;
        const uint64_t base = reinterpret_cast<uint64_t>(event.u.CreateProcessInfo.lpBaseOfImage);
        if (base == 0) fail("game image was not mapped at process creation");
        session.moduleBase = base;
        const RemotePeInfo remote = readRemotePeInfo(session.process, base);
        if (remote.image.imageSize != session.pe.imageSize || remote.entryPoint == 0) fail("mapped game image does not match the planned PE layout");
        session.pe = remote.image;
        armModuleGates(session, base, plan.targetPath, true);
        if (event.u.CreateProcessInfo.hFile) CloseHandle(event.u.CreateProcessInfo.hFile);
        continueEvent(event);
        break;
      }
      case LOAD_DLL_DEBUG_EVENT: {
        if (!sawCreateProcess) fail("DLL mapped before game process creation event");
        const uint64_t base = reinterpret_cast<uint64_t>(event.u.LoadDll.lpBaseOfDll);
        const std::wstring path = modulePathFromDebugEvent(event.u.LoadDll.hFile, event.dwProcessId, base);
        armModuleGates(session, base, path, false);
        continueEvent(event);
        if (event.u.LoadDll.hFile) CloseHandle(event.u.LoadDll.hFile);
        break;
      }
      case EXCEPTION_DEBUG_EVENT: {
        if (event.u.Exception.ExceptionRecord.ExceptionCode == EXCEPTION_BREAKPOINT) {
          if (handleStartupBreakpoint(session, event)) return;
          continueEvent(event, DBG_CONTINUE);
        } else {
          if (!event.u.Exception.dwFirstChance) fail("game raised an unhandled exception before native patch activation");
          continueEvent(event, DBG_EXCEPTION_NOT_HANDLED);
        }
        break;
      }
      case CREATE_THREAD_DEBUG_EVENT:
        continueEvent(event);
        break;
      case EXIT_THREAD_DEBUG_EVENT:
        continueEvent(event);
        break;
      case EXIT_PROCESS_DEBUG_EVENT:
        fail("game exited before native patch activation");
      case UNLOAD_DLL_DEBUG_EVENT:
      case OUTPUT_DEBUG_STRING_EVENT:
      case RIP_EVENT:
        continueEvent(event);
        break;
      default:
        fail("received an unsupported debug event during game initialization");
    }
  }
  if (!sawCreateProcess) fail("game process creation event was not observed");
}

std::string readDecision(const std::wstring& path, const std::string& runId) {
  if (GetFileAttributesW(path.c_str()) == INVALID_FILE_ATTRIBUTES) return {};
  Json decision;
  try {
    decision = JsonParser(readTextFile(path, 4096)).parse();
  } catch (...) {
    // The manager publishes with CREATE_NEW then writes the small JSON file; a concurrent read can see it mid-write.
    return {};
  }
  if (uintOf(required(decision, "protocol", "decision"), "decision.protocol") != 1 ||
      stringOf(required(decision, "runId", "decision"), "decision.runId") != runId) fail("release decision does not match this helper session");
  const std::string value = stringOf(required(decision, "decision", "decision"), "decision.decision");
  if (value != "release" && value != "cancel") fail("release decision has an invalid value");
  return value;
}

void terminateCreatedGame(RemoteSession& session) {
  if (!session.process) return;
  DebugSetProcessKillOnExit(TRUE);
  if (WaitForSingleObject(session.process, 0) != WAIT_OBJECT_0 &&
      !TerminateProcess(session.process, 0x4e505446) && GetLastError() != ERROR_ACCESS_DENIED) {
    return;
  }
  if (session.hasPendingEvent) {
    ContinueDebugEvent(session.pendingEvent.dwProcessId, session.pendingEvent.dwThreadId, DBG_CONTINUE);
    session.hasPendingEvent = false;
  }
  const ULONGLONG deadline = GetTickCount64() + 10000;
  bool sawExitEvent = false;
  while (GetTickCount64() < deadline && !sawExitEvent) {
    DEBUG_EVENT event{};
    if (!WaitForDebugEvent(&event, 100)) {
      if (GetLastError() == ERROR_SEM_TIMEOUT) continue;
      break;
    }
    const bool processExit = event.dwDebugEventCode == EXIT_PROCESS_DEBUG_EVENT;
    if (event.dwDebugEventCode == CREATE_PROCESS_DEBUG_EVENT) {
      if (event.u.CreateProcessInfo.hFile) CloseHandle(event.u.CreateProcessInfo.hFile);
    } else if (event.dwDebugEventCode == CREATE_THREAD_DEBUG_EVENT) {
      // Windows owns event-provided thread handles and closes them automatically.
    } else if (event.dwDebugEventCode == LOAD_DLL_DEBUG_EVENT) {
      if (event.u.LoadDll.hFile) CloseHandle(event.u.LoadDll.hFile);
    }
    if (!ContinueDebugEvent(event.dwProcessId, event.dwThreadId, DBG_CONTINUE)) break;
    sawExitEvent = processExit;
  }
  const bool terminated = WaitForSingleObject(session.process, 0) == WAIT_OBJECT_0;
  if (terminated && session.attached && sawExitEvent && DebugActiveProcessStop(session.processInfo.dwProcessId)) {
    session.attached = false;
    DebugSetProcessKillOnExit(FALSE);
  }
}

int runHelper(const Arguments& args) {
  SessionStatus status;
  RemoteSession session;
  HANDLE mutex = nullptr;
  try {
    const Json planJson = JsonParser(readTextFile(args.plan, kMaxPlanBytes)).parse();
    const HelperPlan plan = parseHelperPlan(planJson);
    status.runId = plan.runId;
    writeStatus(args, status, "starting");
    validateAllocationPolicies(planJson);
    const std::wstring targetPath = normalizedPath(plan.targetPath);
    const DWORD targetAttributes = GetFileAttributesW(targetPath.c_str());
    if (targetAttributes == INVALID_FILE_ATTRIBUTES || (targetAttributes & FILE_ATTRIBUTE_DIRECTORY)) fail("planned game executable does not exist");
    if (!plan.targetSha256.empty() && sha256File(targetPath) != plan.targetSha256) fail("game executable SHA-256 does not match the selected patch target");
    const std::vector<uint8_t> peHeaders = readFilePrefix(targetPath, 1024 * 1024);
    session.pe = parsePe(peHeaders);
    session.packages = loadPackages(planJson);
    session.targetDirectory = std::filesystem::path(targetPath).parent_path().wstring();
    wchar_t windowsPath[32768]{};
    const UINT windowsLength = GetWindowsDirectoryW(windowsPath, static_cast<UINT>(std::size(windowsPath)));
    if (windowsLength == 0 || windowsLength >= std::size(windowsPath)) fail("could not determine Windows system directory for loader-safe gates");
    session.windowsDirectory = normalizedPath(std::wstring(windowsPath, windowsLength));
    const std::wstring mutexName = activeMutexName(targetPath);
    mutex = CreateMutexW(nullptr, FALSE, mutexName.c_str());
    if (!mutex) fail("could not create the active native patch session ledger");
    if (GetLastError() == ERROR_ALREADY_EXISTS) fail("a native patch helper already owns this game launch session");

    std::wstring commandLine = quoteWindowsArgument(targetPath);
    for (const std::wstring& argument : plan.arguments) { commandLine.push_back(L' '); commandLine += quoteWindowsArgument(argument); }
    if (commandLine.size() >= 32767) fail("target command line exceeds the Windows limit");
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION processInfo{};
    DebugSetProcessKillOnExit(TRUE);
    if (!CreateProcessW(targetPath.c_str(), commandLine.data(), nullptr, nullptr, FALSE,
          DEBUG_ONLY_THIS_PROCESS | CREATE_UNICODE_ENVIRONMENT, nullptr, plan.workingDirectory.c_str(), &startup, &processInfo)) {
      fail("could not create the game under the native patch debugger (Windows error " + std::to_string(GetLastError()) + ")");
    }
    session.processInfo = processInfo;
    session.process = processInfo.hProcess;
    session.thread = processInfo.hThread;
    session.attached = true;
    status.pid = processInfo.dwProcessId;
    status.processCreationTime = fileTimeText(session.process);
    writeStatus(args, status, "prepared");

    const ULONGLONG activationDeadline = GetTickCount64() + plan.timeoutMs;
    waitForLoaderGate(session, plan, activationDeadline);
    // All armed bytes are restored before scanning or comparing expected game bytes.
    restoreAllBreakpoints(session);
    scanSignatures(session.process, session);
    prepareGuardAndWrites(session);
    allocateBlocks(session);
    applyFixups(session);
    writePreparedBlocks(session);
    registerRuntimeFunctions(session);
    activateWrites(session);
    writeStatus(args, status, "activated");

    while (GetTickCount64() < activationDeadline) {
      if (WaitForSingleObject(session.process, 0) == WAIT_OBJECT_0) fail("game exited before release was authorized");
      if (signalMatches(args.cancel, status.runId) || readDecision(args.decision, status.runId) == "cancel") fail("native patch launch was cancelled before game release");
      if (signalMatches(args.release, status.runId)) break;
      Sleep(100);
    }
    if (!signalMatches(args.release, status.runId)) fail("timed out waiting for launch manager release signal");
    writeStatus(args, status, "release_ready");
    const ULONGLONG releaseDeadline = GetTickCount64() + 15000;
    std::string decision;
    while (GetTickCount64() < releaseDeadline) {
      decision = readDecision(args.decision, status.runId);
      if (!decision.empty()) break;
      if (signalMatches(args.cancel, status.runId)) fail("native patch launch was cancelled before release authorization");
      Sleep(100);
    }
    if (decision != "release") fail("launch manager did not authorize game release");
    if (!session.hasPendingEvent) fail("loader gate was lost before game release");
    // Hold every target thread explicitly so none can exit or enter a new debug event
    // while the debugger is detached from the gate event.
    suspendOtherThreads(session, session.gateThreadId);
    suspendGateThread(session);
    const DEBUG_EVENT pending = session.pendingEvent;
    if (!ContinueDebugEvent(pending.dwProcessId, pending.dwThreadId, DBG_CONTINUE)) fail("could not continue the activated game initializer event");
    session.hasPendingEvent = false;
    if (!DebugActiveProcessStop(session.processInfo.dwProcessId)) fail("could not detach debugger after game release (Windows error " + std::to_string(GetLastError()) + ")");
    session.attached = false;
    resumeAcquiredThreadSuspends(session);
    writeStatus(args, status, "released");
    WaitForSingleObject(session.process, INFINITE);
    if (session.thread) CloseHandle(session.thread);
    if (session.process) CloseHandle(session.process);
    if (mutex) CloseHandle(mutex);
    return 0;
  } catch (const std::exception& error) {
    terminateCreatedGame(session);
    try { writeStatus(args, status, "failed", error.what()); } catch (...) {}
    if (session.thread) CloseHandle(session.thread);
    if (session.process) CloseHandle(session.process);
    if (mutex) CloseHandle(mutex);
    std::fprintf(stderr, "WH3NativePatchHelper: %s\n", error.what());
    return 1;
  }
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  try {
    const Arguments args = parseArguments(argc, argv);
    return runHelper(args);
  } catch (const std::exception& error) {
    std::fprintf(stderr, "WH3NativePatchHelper: %s\n", error.what());
    return 2;
  }
}

