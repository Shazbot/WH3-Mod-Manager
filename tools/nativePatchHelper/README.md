# Native patch helper

Build the Windows x64 helper from a Visual Studio 2022 x64 developer shell with CMake 3.24 or newer:

```powershell
.\build.ps1
```

The build uses the static MSVC runtime and reproducible compiler/linker flags. It writes `WH3NativePatchHelper.exe` next to this file. The same Windows executable runs directly on Windows and through Protontricks in the Warhammer III Steam prefix.

The startup harness in `harness/` builds an EXE and a companion DLL, then verifies activation before their TLS callbacks and entrypoints. It exercises signature scanning, relative address decoding, chained unwind registration, final page protections, and five rejected or cancelled launches. Run it with:

```powershell
.\harness\run.ps1
```

The harness is synthetic and does not launch Warhammer III or touch game files.
