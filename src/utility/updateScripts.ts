import { win32 as windowsPath } from "node:path";

export interface WindowsUpdateScriptOptions {
  processId: number;
  updateSourceDir: string;
  appDir: string;
  updateLogPath: string;
  appExecutablePath: string;
  readyPath: string;
  cancelPath: string;
}

const quotePowerShellLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Launches PowerShell through cmd because directly detached PowerShell skips -File on some Windows
 * systems. The PowerShell script is addressed relative to this bootstrap, which lives next to it:
 * cmd reads .cmd files in the OEM code page, so an absolute path would be mangled for anyone whose
 * temporary directory contains non-ASCII characters.
 */
export const buildWindowsUpdateBootstrapScript = (powerShellScriptPath: string) => {
  const escapedScriptName = windowsPath.basename(powerShellScriptPath).replaceAll("%", "%%");
  return `@echo off\r
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0${escapedScriptName}"\r
exit /b %errorlevel%\r
`;
};

/** Builds a console-free Windows updater script that waits for the running app before replacing it. */
export const buildWindowsUpdateScript = ({
  processId,
  updateSourceDir,
  appDir,
  updateLogPath,
  appExecutablePath,
  readyPath,
  cancelPath,
}: WindowsUpdateScriptOptions) => `$ErrorActionPreference = 'Stop'
$updateSourceDir = ${quotePowerShellLiteral(updateSourceDir)}
$appDir = ${quotePowerShellLiteral(appDir)}
$updateLogPath = ${quotePowerShellLiteral(updateLogPath)}
$appExecutablePath = ${quotePowerShellLiteral(appExecutablePath)}
$readyPath = ${quotePowerShellLiteral(readyPath)}
$cancelPath = ${quotePowerShellLiteral(cancelPath)}
$updateForm = $null
$statusLabel = $null

function Write-UpdateLog([string] $message) {
  try {
    Add-Content -LiteralPath $updateLogPath -Value "[$(Get-Date -Format o)] $message" -ErrorAction Stop
  } catch { }
}

function Set-UpdateStatus([string] $message) {
  if ($null -eq $statusLabel) { return }
  $statusLabel.Text = $message
  $updateForm.Refresh()
  [System.Windows.Forms.Application]::DoEvents()
}

# The application drops this marker when it gave up on the update. Without the check a helper that
# outlived that hand-off would sit here until the user closed the application on their own terms and
# then replace it behind their back, hours after they were told the update had failed.
function Exit-IfUpdateCancelled {
  if (-not (Test-Path -LiteralPath $cancelPath)) { return }
  Write-UpdateLog 'The application cancelled the update; leaving the installation untouched.'
  Set-UpdateStatus 'Update cancelled.'
  if ($null -ne $updateForm) { $updateForm.Close() }
  exit 1
}

Write-UpdateLog "Updater started; waiting for process ${processId}."
try {
  Add-Type -AssemblyName System.Windows.Forms
  $updateForm = New-Object System.Windows.Forms.Form
  $updateForm.Text = 'WH3 Mod Manager Updater'
  $updateForm.Width = 440
  $updateForm.Height = 130
  $updateForm.StartPosition = 'CenterScreen'
  $updateForm.FormBorderStyle = 'FixedDialog'
  $updateForm.MaximizeBox = $false
  $updateForm.MinimizeBox = $false
  $updateForm.TopMost = $true

  $statusLabel = New-Object System.Windows.Forms.Label
  $statusLabel.Left = 18
  $statusLabel.Top = 15
  $statusLabel.Width = 390
  $statusLabel.Text = 'Waiting for WH3 Mod Manager to close...'
  $updateForm.Controls.Add($statusLabel)

  $progressBar = New-Object System.Windows.Forms.ProgressBar
  $progressBar.Left = 18
  $progressBar.Top = 43
  $progressBar.Width = 390
  $progressBar.Style = 'Marquee'
  $progressBar.MarqueeAnimationSpeed = 30
  $updateForm.Controls.Add($progressBar)
  $updateForm.Show()
  [System.Windows.Forms.Application]::DoEvents()
} catch {
  Write-UpdateLog "Could not show updater progress window: $($_.Exception.Message)"
}

try {
  Set-Content -LiteralPath $readyPath -Value ([DateTime]::UtcNow.ToString('o')) -ErrorAction Stop
  Write-UpdateLog 'Updater ready; waiting for the application to close.'
} catch {
  Write-UpdateLog "Could not create updater readiness marker: $($_.Exception.Message)"
  if ($null -ne $updateForm) { $updateForm.Close() }
  exit 1
}

Wait-Process -Id ${processId} -ErrorAction SilentlyContinue
Write-UpdateLog 'Application process closed.'
Exit-IfUpdateCancelled
Set-UpdateStatus 'Waiting for application processes to exit...'
$processWaitDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  $remainingAppProcesses = @(
    Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($appExecutablePath)) -ErrorAction SilentlyContinue |
      Where-Object {
        try { [string]::Equals($_.Path, $appExecutablePath, [StringComparison]::OrdinalIgnoreCase) }
        catch { $false }
      }
  )
  if ($remainingAppProcesses.Count -eq 0) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $processWaitDeadline)

if ($remainingAppProcesses.Count -gt 0) {
  Write-UpdateLog "Timed out waiting for related application processes: $($remainingAppProcesses.Id -join ', ')."
} else {
  Write-UpdateLog 'All application processes closed.'
}

Exit-IfUpdateCancelled
Set-UpdateStatus 'Installing update...'
$copySucceeded = $false
try {
  $robocopyPath = Join-Path (Join-Path $env:SystemRoot 'System32') 'robocopy.exe'
  & $robocopyPath $updateSourceDir $appDir /E /COPY:DAT /DCOPY:DAT /R:15 /W:1 /NFL /NDL /NJH /NJS /NP "/LOG+:$updateLogPath"
  $copyExitCode = $LASTEXITCODE
  if ($copyExitCode -ge 8) {
    throw "robocopy failed with exit code $copyExitCode"
  }
  $copySucceeded = $true
  Write-UpdateLog "Update files copied successfully (robocopy exit code $copyExitCode)."
} catch {
  Write-UpdateLog "Copying the update into $appDir failed: $($_.Exception.Message)"
}

if ($copySucceeded) {
  Set-UpdateStatus 'Starting the updated WH3 Mod Manager...'
} else {
  Set-UpdateStatus 'Update failed; restarting the previous version. See update.log for details.'
  Start-Sleep -Seconds 5
}
try {
  $applicationProcess = Start-Process -FilePath $appExecutablePath -WorkingDirectory $appDir -PassThru
  Write-UpdateLog "Application restart requested (process $($applicationProcess.Id))."
  try {
    if ($applicationProcess.WaitForInputIdle(15000)) {
      $activated = (New-Object -ComObject WScript.Shell).AppActivate($applicationProcess.Id)
      Write-UpdateLog "Application window activation result: $activated."
    }
  } catch {
    Write-UpdateLog "Could not activate the restarted application window: $($_.Exception.Message)"
  }
} catch {
  Write-UpdateLog "Application restart failed: $($_.Exception.Message)"
  Set-UpdateStatus 'Could not restart WH3 Mod Manager. See update.log for details.'
  Start-Sleep -Seconds 5
  if ($null -ne $updateForm) { $updateForm.Close() }
  exit 1
}
if ($null -ne $updateForm) { $updateForm.Close() }
`;
