$ErrorActionPreference = "Stop"

$sourceDirectory = Split-Path -Parent $PSScriptRoot
$rootBuild = Join-Path $sourceDirectory ".build"
$cmakePath = $null
$vsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path -LiteralPath $vsWhere) {
  $vsInstall = & $vsWhere -latest -products "*" -requires Microsoft.VisualStudio.Component.VC.CMake.Project -property installationPath
  if ($vsInstall) {
    $candidate = Join-Path $vsInstall "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    if (Test-Path -LiteralPath $candidate) { $cmakePath = $candidate }
  }
}
if (-not $cmakePath) {
  $cmake = Get-Command cmake -ErrorAction SilentlyContinue
  if ($cmake) { $cmakePath = $cmake.Source }
}
if (-not $cmakePath) { throw "CMake 3.24 or newer is required; install the Visual Studio 2022 CMake component or add CMake to PATH." }

& $cmakePath -S $sourceDirectory -B $rootBuild -G "Visual Studio 17 2022" -A x64
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed with exit code $LASTEXITCODE." }
& $cmakePath --build $rootBuild --config Release --target WH3NativePatchHelper NativePatchStartupHarness NativePatchCompanion --parallel
if ($LASTEXITCODE -ne 0) { throw "The native startup harness build failed with exit code $LASTEXITCODE." }

$helperPath = Join-Path $sourceDirectory "WH3NativePatchHelper.exe"
$harnessDirectory = Join-Path $rootBuild "harness-bin"
$targetPath = Join-Path $harnessDirectory "NativePatchStartupHarness.exe"
$companionPath = Join-Path $harnessDirectory "companions\NativePatchCompanion.dll"
if (-not (Test-Path -LiteralPath $helperPath) -or -not (Test-Path -LiteralPath $targetPath) -or -not (Test-Path -LiteralPath $companionPath)) {
  throw "The helper or synthetic harness build output is missing."
}

function Get-PatchSectionRva([string] $path) {
  $bytes = [IO.File]::ReadAllBytes($path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  if ([BitConverter]::ToUInt32($bytes, $peOffset) -ne 0x00004550) { throw "Harness is not a PE executable." }
  $sectionCount = [BitConverter]::ToUInt16($bytes, $peOffset + 6)
  $optionalSize = [BitConverter]::ToUInt16($bytes, $peOffset + 20)
  $sectionTable = $peOffset + 24 + $optionalSize
  for ($index = 0; $index -lt $sectionCount; $index++) {
    $section = $sectionTable + (40 * $index)
    $name = [Text.Encoding]::ASCII.GetString($bytes, $section, 8).Trim([char] 0)
    if ($name -eq ".patch") { return [BitConverter]::ToUInt32($bytes, $section + 12) }
  }
  throw "The harness .patch section was not found."
}

function ConvertTo-ProcessArgument([string] $value) {
  if ($value.Length -gt 0 -and $value -notmatch '[\s"]') { return $value }
  $builder = [Text.StringBuilder]::new()
  [void] $builder.Append('"')
  $slashes = 0
  foreach ($character in $value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') {
      [void] $builder.Append(('\' * (2 * $slashes + 1)))
      [void] $builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) { [void] $builder.Append(('\' * $slashes)); $slashes = 0 }
    [void] $builder.Append($character)
  }
  if ($slashes -gt 0) { [void] $builder.Append(('\' * (2 * $slashes))) }
  [void] $builder.Append('"')
  return $builder.ToString()
}

function Read-RunStatus([string] $path, [string] $id) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  try {
    $value = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($value.protocol -eq 1 -and $value.runId -eq $id) { return $value }
  } catch { }
  return $null
}

function Invoke-NegativeCase([string] $caseName, [object] $basePlan, [string] $helperPath, [string] $harnessDirectory, [string] $runRoot) {
  $caseRunId = [Guid]::NewGuid().ToString("N")
  $caseDirectory = Join-Path $runRoot "negative-$caseName-$caseRunId"
  [void] [IO.Directory]::CreateDirectory($caseDirectory)
  $caseLog = Join-Path $caseDirectory "startup.log"
  $casePlanPath = Join-Path $caseDirectory "plan.json"
  $caseStatusPath = Join-Path $caseDirectory "status.json"
  $caseReleasePath = Join-Path $caseDirectory "release.signal"
  $caseCancelPath = Join-Path $caseDirectory "cancel.signal"
  $caseDecisionPath = Join-Path $caseDirectory "decision.json"
  $casePlan = ConvertFrom-Json -InputObject ($basePlan | ConvertTo-Json -Depth 30 -Compress)
  $casePlan.runId = $caseRunId
  $casePlan.targetArguments = @($caseLog)
  switch ($caseName) {
    "wrong-expected" { $casePlan.packages[0].writes[0].expected = "FF" }
    "missing-signature" {
      $casePlan.packages[0].signatures = @(@{ id = "missing"; module = "game"; pattern = "DE AD BE EF"; scope = "executable" })
    }
    "ambiguous-signature" {
      $casePlan.packages[0].signatures = @(@{ id = "ambiguous"; module = "game"; pattern = "00"; scope = "readable" })
    }
    "bad-fixup" { $casePlan.packages[0].fixups[0].target = @{ block = "missing"; offset = 0 } }
  }
  [IO.File]::WriteAllText($casePlanPath, ($casePlan | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))
  $processInfo = [Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $helperPath
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $helperArguments = @("--plan", $casePlanPath, "--status", $caseStatusPath, "--release", $caseReleasePath, "--cancel", $caseCancelPath, "--decision", $caseDecisionPath)
  $processInfo.Arguments = (($helperArguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " ")
  $previousLogPath = $env:WH3_NATIVE_PATCH_HARNESS_LOG
  $env:WH3_NATIVE_PATCH_HARNESS_LOG = $caseLog
  $caseProcess = $null
  try {
    $caseProcess = [Diagnostics.Process]::Start($processInfo)
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    $caseStatus = $null
    while ([DateTime]::UtcNow -lt $deadline) {
      $caseStatus = Read-RunStatus $caseStatusPath $caseRunId
      if ($caseStatus -and $caseStatus.state -in @("activated", "failed")) { break }
      $caseProcess.Refresh()
      if ($caseProcess.HasExited) { throw "$caseName helper exited early with code $($caseProcess.ExitCode)." }
      Start-Sleep -Milliseconds 100
    }
    if (-not $caseStatus) { throw "$caseName helper did not report a state before timeout." }
    if ($caseName -eq "cancel-before-release") {
      if ($caseStatus.state -ne "activated") { throw "Cancellation case failed before activation: $($caseStatus.message)" }
      [IO.File]::WriteAllText($caseCancelPath, "$caseRunId`n", [Text.UTF8Encoding]::new($false))
      $cancelDeadline = [DateTime]::UtcNow.AddSeconds(15)
      while ([DateTime]::UtcNow -lt $cancelDeadline) {
        $caseStatus = Read-RunStatus $caseStatusPath $caseRunId
        if ($caseStatus -and $caseStatus.state -eq "failed") { break }
        Start-Sleep -Milliseconds 100
      }
    }
    if (-not $caseStatus -or $caseStatus.state -ne "failed") { throw "$caseName case did not fail closed." }
    if (-not $caseProcess.WaitForExit(15000)) { throw "$caseName helper did not exit after failure." }
    if ($caseProcess.ExitCode -eq 0) { throw "$caseName helper reported success after a rejected launch." }
    $expectedMessage = switch ($caseName) {
      "wrong-expected" { "expected bytes do not match" }
      "missing-signature" { "matched 0 locations" }
      "ambiguous-signature" { "matched [1-9][0-9]* locations" }
      "bad-fixup" { "unknown block reference 'missing'" }
      "cancel-before-release" { "cancelled" }
    }
    if ($caseStatus.message -notmatch $expectedMessage) { throw "$caseName returned an unexpected error: $($caseStatus.message)" }
    if (Test-Path -LiteralPath $caseLog) {
      $caseRecords = @(Get-Content -LiteralPath $caseLog)
      if ($caseRecords.Count -gt 0) { throw "$caseName reached startup code before failing: $($caseRecords -join ', ')" }
    }
    if ($caseStatus.pid -gt 0 -and (Get-Process -Id $caseStatus.pid -ErrorAction SilentlyContinue)) {
      Stop-Process -Id $caseStatus.pid -Force -ErrorAction SilentlyContinue
      throw "$caseName left its synthetic target process running."
    }
  } catch {
    if ($caseProcess -and -not $caseProcess.HasExited) {
      if (-not (Test-Path -LiteralPath $caseCancelPath)) { [IO.File]::WriteAllText($caseCancelPath, "$caseRunId`n", [Text.UTF8Encoding]::new($false)) }
      if (-not $caseProcess.WaitForExit(12000)) { Stop-Process -Id $caseProcess.Id -Force -ErrorAction SilentlyContinue }
    }
    throw "${caseName}: $_ (artifacts retained at $caseDirectory)"
  } finally {
    $env:WH3_NATIVE_PATCH_HARNESS_LOG = $previousLogPath
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$runRoot = Join-Path $repoRoot ".cache\native-harness-runs"
[void] [IO.Directory]::CreateDirectory($runRoot)
$runId = [Guid]::NewGuid().ToString("N")
$runDirectory = Join-Path $runRoot "wh3-native-patch-harness-$runId"
[void] [IO.Directory]::CreateDirectory($runDirectory)
$parentPayloadPath = Join-Path $runDirectory "parent.bin"
$stubPayloadPath = Join-Path $runDirectory "stub.bin"
$readOnlyPayloadPath = Join-Path $runDirectory "readonly.bin"
$writablePayloadPath = Join-Path $runDirectory "writable.bin"
$planPath = Join-Path $runDirectory "plan.json"
$statusPath = Join-Path $runDirectory "status.json"
$releasePath = Join-Path $runDirectory "release.signal"
$cancelPath = Join-Path $runDirectory "cancel.signal"
$decisionPath = Join-Path $runDirectory "decision.json"
$logPath = Join-Path $runDirectory "startup.log"
$helperProcess = $null
$previousLog = $env:WH3_NATIVE_PATCH_HARNESS_LOG
$previousPath = $env:PATH
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:WH3_NATIVE_PATCH_HARNESS_LOG = $logPath
$env:PATH = (Split-Path -Parent $companionPath) + ";" + $env:PATH
$env:TEMP = $runRoot
$env:TMP = $runRoot

try {
  [byte[]] $parentPayload = 0x53, 0x48, 0x83, 0xEC, 0x20, 0xE9, 0, 0, 0, 0, 0x90, 0x90, 0x01, 0x05, 0x02, 0, 0x05, 0x32, 0x01, 0x30
  [byte[]] $stubPayload = 0xB8, 0x2A, 0, 0, 0, 0x48, 0x83, 0xC4, 0x20, 0x5B, 0xC3, 0x90, 0x90, 0x90, 0x90, 0x90, 0x21, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  [byte[]] $readOnlyPayload = 0x52, 0x45, 0x41, 0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  [byte[]] $writablePayload = 0x57, 0x52, 0x49, 0x54, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  [IO.File]::WriteAllBytes($parentPayloadPath, $parentPayload)
  [IO.File]::WriteAllBytes($stubPayloadPath, $stubPayload)
  [IO.File]::WriteAllBytes($readOnlyPayloadPath, $readOnlyPayload)
  [IO.File]::WriteAllBytes($writablePayloadPath, $writablePayload)
  $sectionRva = Get-PatchSectionRva $targetPath
  $targetHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $parentHash = (Get-FileHash -LiteralPath $parentPayloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $stubHash = (Get-FileHash -LiteralPath $stubPayloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $readOnlyHash = (Get-FileHash -LiteralPath $readOnlyPayloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $writableHash = (Get-FileHash -LiteralPath $writablePayloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $toRva = { param([uint32] $value) "0x{0:x}" -f $value }
  $parentPointerRva = & $toRva ($sectionRva + 1)
  $readOnlyPointerRva = & $toRva ($sectionRva + 9)
  $writablePointerRva = & $toRva ($sectionRva + 17)
  $targetArguments = @($logPath)
  $plan = [ordered] @{
    protocol = 1
    runId = $runId
    targetPath = $targetPath
    targetWorkingDirectory = $harnessDirectory
    targetSha256 = $targetHash
    targetArguments = $targetArguments
    sessionTimeoutMs = 30000
    packages = @(
      [ordered] @{
        id = "harness.runtime"
        version = "1.0.0"
        allocation_policy = @{ type = "module_window"; module = "game"; min_rva = "after_image"; max_rva_exclusive = "0x80000000" }
        signatures = @(@{ id = "patch_marker"; module = "game"; pattern = "A1 B2 C3 D4 E9 ?? ?? ?? ??"; scope = "readable" })
        symbols = @{}
        guards = @()
        writes = @(
          @{ id = "patch_byte"; at = @{ relative = @{ from = @{ signature = "patch_marker" }; kind = "rel32"; operand_offset = 5; instruction_end_offset = 9 } }; expected = "11"; bytes = "42" },
          @{ id = "parent_pointer"; at = @{ module = "game"; rva = $parentPointerRva }; expected = "0000000000000000"; bytes = "0000000000000000" },
          @{ id = "readonly_pointer"; at = @{ module = "game"; rva = $readOnlyPointerRva }; expected = "0000000000000000"; bytes = "0000000000000000" },
          @{ id = "writable_pointer"; at = @{ module = "game"; rva = $writablePointerRva }; expected = "0000000000000000"; bytes = "0000000000000000" }
        )
        fixups = @(
          @{ kind = "abs64"; at = @{ write = "parent_pointer"; offset = 0 }; target = @{ block = "parent"; offset = 0 } },
          @{ kind = "abs64"; at = @{ write = "readonly_pointer"; offset = 0 }; target = @{ block = "readonly"; offset = 0 } },
          @{ kind = "abs64"; at = @{ write = "writable_pointer"; offset = 0 }; target = @{ block = "writable"; offset = 0 } },
          @{ kind = "rel32"; at = @{ block = "parent"; offset = 6 }; target = @{ block = "stub"; offset = 0 }; relative_to = @{ block = "parent"; offset = 10 } },
          @{ kind = "rva32"; at = @{ block = "stub"; offset = 20 }; target = @{ block = "parent"; offset = 0 }; base = @{ module = "game"; rva = "0x0" } },
          @{ kind = "rva32"; at = @{ block = "stub"; offset = 24 }; target = @{ block = "parent"; offset = 10 }; base = @{ module = "game"; rva = "0x0" } },
          @{ kind = "rva32"; at = @{ block = "stub"; offset = 28 }; target = @{ block = "parent"; offset = 12 }; base = @{ module = "game"; rva = "0x0" } }
        )
        runtime_functions = @(
          @{ begin = @{ block = "parent"; offset = 0 }; end = @{ block = "parent"; offset = 10 }; unwind = @{ block = "parent"; offset = 12 } },
          @{ begin = @{ block = "stub"; offset = 0 }; end = @{ block = "stub"; offset = 11 }; unwind = @{ block = "stub"; offset = 16 } }
        )
        blocks = @(
          @{ id = "parent"; size = 20; alignment = 16; protection = "rx"; payload_path = $parentPayloadPath; sha256 = $parentHash },
          @{ id = "stub"; size = 32; alignment = 16; protection = "rx"; payload_path = $stubPayloadPath; sha256 = $stubHash },
          @{ id = "readonly"; size = 16; alignment = 16; protection = "r"; payload_path = $readOnlyPayloadPath; sha256 = $readOnlyHash },
          @{ id = "writable"; size = 16; alignment = 16; protection = "rw"; payload_path = $writablePayloadPath; sha256 = $writableHash }
        )
      }
    )
  }
  [IO.File]::WriteAllText($planPath, ($plan | ConvertTo-Json -Depth 30 -Compress), [Text.UTF8Encoding]::new($false))

  $processInfo = [Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = $helperPath
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $helperArguments = @("--plan", $planPath, "--status", $statusPath, "--release", $releasePath, "--cancel", $cancelPath, "--decision", $decisionPath)
  $processInfo.Arguments = (($helperArguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " ")
  $helperProcess = [Diagnostics.Process]::Start($processInfo)

  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  $status = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $status = Read-RunStatus $statusPath $runId
    if ($status -and $status.state -eq "failed") { throw "Native helper failed before activation: $($status.message)" }
    if ($status -and $status.state -eq "activated") { break }
    $helperProcess.Refresh()
    if ($helperProcess.HasExited) { throw "Native helper exited before activation with code $($helperProcess.ExitCode)." }
    Start-Sleep -Milliseconds 100
  }
  if (-not $status -or $status.state -ne "activated") { throw "Native helper did not activate before the harness timeout." }

  [IO.File]::WriteAllText($releasePath, "$runId`n", [Text.UTF8Encoding]::new($false))
  $releaseDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $releaseDeadline) {
    $status = Read-RunStatus $statusPath $runId
    if ($status -and $status.state -eq "failed") { throw "Native helper failed during release: $($status.message)" }
    if ($status -and $status.state -eq "release_ready") {
      $decision = @{ protocol = 1; runId = $runId; decision = "release" } | ConvertTo-Json -Compress
      [IO.File]::WriteAllText($decisionPath, $decision, [Text.UTF8Encoding]::new($false))
    }
    if ($status -and $status.state -eq "released") { break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $status -or $status.state -ne "released") { throw "Native helper did not acknowledge release." }
  if (-not $helperProcess.WaitForExit(15000)) { throw "Harness target did not exit; helper is still waiting for it." }
  if ($helperProcess.ExitCode -ne 0) { throw "Native helper exited with code $($helperProcess.ExitCode)." }

  $log = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath } else { @() }
  $requiredRecords = @("exe_tls:66", "exe_main:66", "companion_tls:66", "companion_dllmain:66", "companion_loaded:66", "injected_code:42", "dynamic_unwind:1")
  foreach ($record in $requiredRecords) {
    if ($log -notcontains $record) { throw "Harness log is missing '$record'. Log: $($log -join ', ')" }
  }
  $companionTlsIndex = [Array]::IndexOf($log, "companion_tls:66")
  $companionDllMainIndex = [Array]::IndexOf($log, "companion_dllmain:66")
  $executableTlsIndex = [Array]::IndexOf($log, "exe_tls:66")
  if (($companionTlsIndex -ge $executableTlsIndex) -or ($companionDllMainIndex -ge $executableTlsIndex)) {
    throw "Imported companion TLS and DllMain did not both run before the executable TLS callback. Log: $($log -join ', ')"
  }
  foreach ($caseName in @("wrong-expected", "missing-signature", "ambiguous-signature", "bad-fixup", "cancel-before-release")) {
    Invoke-NegativeCase $caseName $plan $helperPath $harnessDirectory $runRoot
  }
  Write-Output "Native startup harness passed: early TLS/DllMain gates, chained unwind, final page protections, and five fail-closed launch cases."
} catch {
  if ($helperProcess -and -not $helperProcess.HasExited) {
    if (-not (Test-Path -LiteralPath $decisionPath)) {
      try {
        $decision = @{ protocol = 1; runId = $runId; decision = "cancel" } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($decisionPath, $decision, [Text.UTF8Encoding]::new($false))
      } catch { }
    }
    if (-not (Test-Path -LiteralPath $cancelPath)) { [IO.File]::WriteAllText($cancelPath, "$runId`n", [Text.UTF8Encoding]::new($false)) }
    if (-not $helperProcess.WaitForExit(12000)) { Stop-Process -Id $helperProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  Write-Error "$_`nSynthetic run directory retained for diagnosis: $runDirectory"
} finally {
  if ($null -eq $previousLog) { Remove-Item Env:WH3_NATIVE_PATCH_HARNESS_LOG -ErrorAction SilentlyContinue }
  else { $env:WH3_NATIVE_PATCH_HARNESS_LOG = $previousLog }
  $env:PATH = $previousPath
  $env:TEMP = $previousTemp
  $env:TMP = $previousTmp
}
