$ErrorActionPreference = "Stop"

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
  $cmakeCommand = Get-Command cmake -ErrorAction SilentlyContinue
  if ($cmakeCommand) { $cmakePath = $cmakeCommand.Source }
}
if (-not $cmakePath) { throw "CMake 3.24 or newer was not found. Install the Visual Studio 2022 CMake component or add CMake to PATH." }

$sourceDirectory = $PSScriptRoot
$buildDirectory = Join-Path $sourceDirectory ".build"
& $cmakePath -S $sourceDirectory -B $buildDirectory -G "Visual Studio 17 2022" -A x64
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed with exit code $LASTEXITCODE." }

& $cmakePath --build $buildDirectory --config Release --target WH3NativePatchHelper --parallel
if ($LASTEXITCODE -ne 0) { throw "Native helper build failed with exit code $LASTEXITCODE." }
