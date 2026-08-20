export interface WindowsUpdateScriptOptions {
  processId: number;
  updateSourceDir: string;
  appDir: string;
  updateLogPath: string;
  appExecutablePath: string;
}

const quotePowerShellLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Builds a console-free Windows updater script that waits for the running app before replacing it. */
export const buildWindowsUpdateScript = ({
  processId,
  updateSourceDir,
  appDir,
  updateLogPath,
  appExecutablePath,
}: WindowsUpdateScriptOptions) => `$ErrorActionPreference = 'Stop'
$updateSourceDir = ${quotePowerShellLiteral(updateSourceDir)}
$appDir = ${quotePowerShellLiteral(appDir)}
$updateLogPath = ${quotePowerShellLiteral(updateLogPath)}
$appExecutablePath = ${quotePowerShellLiteral(appExecutablePath)}
Wait-Process -Id ${processId} -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
try {
  Get-ChildItem -LiteralPath $updateSourceDir -Force |
    Copy-Item -Destination $appDir -Recurse -Force
} catch {
  $message = "[$(Get-Date -Format o)] Copying the update into $appDir failed: $($_.Exception.Message)"
  try { Add-Content -LiteralPath $updateLogPath -Value $message } catch { }
}
Start-Process -FilePath $appExecutablePath
`;
