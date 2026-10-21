<#
.SYNOPSIS
  Publishes WH3AssetHost from the AssetEditor checkout and copies it into tools/WH3AssetHost.

.DESCRIPTION
  The mod optimizer (Workshop mod staging) runs inside WH3AssetHost.exe, so the committed exe must
  come from a known commit. This script builds a Release win-x64 single-file publish, copies the
  exe, and writes tools/WH3AssetHost/host-build.txt (commit, version, size, sha256) next to it.
  Review the new exe and host-build.txt, then commit both.

.PARAMETER AssetEditorPath
  The AssetEditor checkout that holds Tools/WH3AssetHost. Default: a sibling "assedfork-host" or "assedFork" folder.
#>
[CmdletBinding()]
param(
  [string]$AssetEditorPath
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $AssetEditorPath) {
  foreach ($candidate in @("assedfork-host", "assedFork", "TheAssetEditor")) {
    $path = Join-Path (Split-Path -Parent $repoRoot) $candidate
    if (Test-Path (Join-Path $path "Tools/WH3AssetHost/WH3AssetHost.csproj")) { $AssetEditorPath = $path; break }
  }
}
if (-not $AssetEditorPath -or -not (Test-Path (Join-Path $AssetEditorPath "Tools/WH3AssetHost/WH3AssetHost.csproj"))) {
  throw "Pass -AssetEditorPath <checkout containing Tools/WH3AssetHost>."
}

$status = git -C $AssetEditorPath status --porcelain
if ($status) { Write-Warning "The AssetEditor checkout has uncommitted changes; the recorded commit will not match the exe." }
$commit = (git -C $AssetEditorPath rev-parse HEAD).Trim()

dotnet publish (Join-Path $AssetEditorPath "Tools/WH3AssetHost") -c Release
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }

$published = Join-Path $AssetEditorPath "Tools/WH3AssetHost/bin/Release/net10.0-windows/win-x64/publish/WH3AssetHost.exe"
if (-not (Test-Path $published)) { throw "Published exe not found at $published" }

$target = Join-Path $repoRoot "tools/WH3AssetHost"
Copy-Item $published (Join-Path $target "WH3AssetHost.exe") -Force

$exe = Get-Item (Join-Path $target "WH3AssetHost.exe")
$hash = (Get-FileHash $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$version = (& $exe.FullName --version) -join " "
@(
  "commit: $commit",
  "version: $version",
  "size: $($exe.Length)",
  "sha256: $hash",
  "built: $((Get-Date).ToUniversalTime().ToString('s'))Z"
) | Set-Content (Join-Path $target "host-build.txt") -Encoding utf8

Write-Host "Updated tools/WH3AssetHost/WH3AssetHost.exe ($version, $hash)."
