import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { buildWindowsUpdateBootstrapScript, buildWindowsUpdateScript } from "../src/utility/updateScripts";

describe("buildWindowsUpdateBootstrapScript", () => {
  it("launches PowerShell through a detached-cmd-compatible wrapper", () => {
    const script = buildWindowsUpdateBootstrapScript("C:\\Temp Folder\\update.ps1");

    expect(script).toContain(
      'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0update.ps1"',
    );
    expect(script).toContain("exit /b %errorlevel%");
  });

  it("keeps the script directory out of the batch file so a non-ASCII temporary path cannot be mangled", () => {
    const script = buildWindowsUpdateBootstrapScript("C:\\Users\\Ярослав\\AppData\\Local\\Temp\\wh3mm\\update.ps1");

    expect(script).not.toContain("Ярослав");
    expect(script).toContain('-File "%~dp0update.ps1"');
  });

  it("escapes percent signs in the script name", () => {
    expect(buildWindowsUpdateBootstrapScript("C:\\Temp\\update%20.ps1")).toContain('-File "%~dp0update%%20.ps1"');
  });
});

describe("buildWindowsUpdateScript", () => {
  it("waits for the application without opening the old cmd find loop", () => {
    const script = buildWindowsUpdateScript({
      processId: 43816,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Apps\\WH3MM",
      updateLogPath: "C:\\Users\\Tester\\update.log",
      appExecutablePath: "C:\\Apps\\WH3MM\\WH3 Mod Manager.exe",
      readyPath: "C:\\Temp\\update-ready",
      cancelPath: "C:\\Temp\\update-cancelled",
    });

    expect(script).toContain("while ($null -ne (Get-Process -Id 43816 -ErrorAction SilentlyContinue))");
    expect(script).not.toContain("tasklist");
    expect(script).not.toContain('find "43816"');
    expect(script).toContain("$updateSourceDir = 'C:\\Temp\\staging'");
    expect(script).toContain("$appExecutablePath = 'C:\\Apps\\WH3MM\\WH3 Mod Manager.exe'");
    expect(script).toContain("$readyPath = 'C:\\Temp\\update-ready'");
    expect(script).toContain("Set-Content -LiteralPath $readyPath");
    expect(script).toContain("$updateForm.Text = 'WH3 Mod Manager Updater'");
    expect(script).toContain("Set-UpdateStatus 'Installing update...'");
    expect(script).toContain("Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($appExecutablePath))");
    expect(script).toContain("$robocopyPath = Join-Path (Join-Path $env:SystemRoot 'System32') 'robocopy.exe'");
    expect(script).toContain(
      "Start-Process -FilePath $robocopyPath -ArgumentList $robocopyArguments -WindowStyle Hidden -PassThru",
    );
    expect(script).toContain("if ($copyExitCode -ge 8)");
    expect(script).not.toContain("\r");
    expect(script).toContain("Update failed; restarting the previous version. See update.log for details.");
    expect(script).toContain("Start-Process -FilePath $appExecutablePath -WorkingDirectory $appDir -PassThru");
    expect(script).toContain("AppActivate($applicationProcess.Id)");
  });

  it("gives up instead of installing once the application has cancelled the update", () => {
    const script = buildWindowsUpdateScript({
      processId: 43816,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Apps\\WH3MM",
      updateLogPath: "C:\\Users\\Tester\\update.log",
      appExecutablePath: "C:\\Apps\\WH3MM\\WH3 Mod Manager.exe",
      readyPath: "C:\\Temp\\update-ready",
      cancelPath: "C:\\Temp\\update-cancelled",
    });

    expect(script).toContain("$cancelPath = 'C:\\Temp\\update-cancelled'");
    expect(script).toContain("if (-not (Test-Path -LiteralPath $cancelPath)) { return }");

    // The check has to sit between waiting for the application and touching the installation.
    const waitIndex = script.indexOf("while ($null -ne (Get-Process -Id 43816");
    const copyIndex = script.indexOf("Start-Process -FilePath $robocopyPath");
    const cancelChecks = [...script.matchAll(/^Exit-IfUpdateCancelled$/gm)].map((match) => match.index!);
    expect(cancelChecks).toHaveLength(2);
    expect(cancelChecks[0]).toBeGreaterThan(waitIndex);
    expect(cancelChecks[1]).toBeLessThan(copyIndex);
  });

  it("keeps the progress window pumping through every wait", () => {
    const script = buildWindowsUpdateScript({
      processId: 43816,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Apps\\WH3MM",
      updateLogPath: "C:\\Users\\Tester\\update.log",
      appExecutablePath: "C:\\Apps\\WH3MM\\WH3 Mod Manager.exe",
      readyPath: "C:\\Temp\\update-ready",
      cancelPath: "C:\\Temp\\update-cancelled",
    });

    expect(script).toContain("[System.Windows.Forms.Application]::DoEvents()\n    Start-Sleep -Milliseconds 25");

    // Nothing past the function definitions may block the thread the window is painted on: that is
    // what turns the dialog into a white "Not Responding" rectangle for the length of the copy.
    const scriptBody = script.slice(script.indexOf('Write-UpdateLog "Updater started'));
    expect(scriptBody).not.toContain("Start-Sleep");
    expect(scriptBody).not.toContain("Wait-Process");
    expect(scriptBody).not.toContain("WaitForInputIdle(15000)");
    expect(scriptBody).toContain("Wait-UpdateWindow 250");
    expect(scriptBody).toContain("Wait-UpdateWindow 100");
    expect(scriptBody).toContain("Wait-UpdateWindow 5000");
  });

  it("quotes the robocopy paths itself because Start-Process does not", () => {
    const script = buildWindowsUpdateScript({
      processId: 1,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Program Files\\WH3 Mod Manager",
      updateLogPath: "C:\\Users\\Tester Name\\update.log",
      appExecutablePath: "C:\\Program Files\\WH3 Mod Manager\\WH3MM.exe",
      readyPath: "C:\\Temp\\update-ready",
      cancelPath: "C:\\Temp\\update-cancelled",
    });

    expect(script).toContain(`('"{0}"' -f $updateSourceDir)`);
    expect(script).toContain(`('"{0}"' -f $appDir)`);
    expect(script).toContain(`('/LOG+:"{0}"' -f $updateLogPath)`);
  });

  it("escapes apostrophes in paths", () => {
    const script = buildWindowsUpdateScript({
      processId: 1,
      updateSourceDir: "C:\\User's Files\\staging",
      appDir: "C:\\User's Files\\WH3MM",
      updateLogPath: "C:\\User's Files\\update.log",
      appExecutablePath: "C:\\User's Files\\WH3MM\\WH3MM.exe",
      readyPath: "C:\\User's Files\\update-ready",
      cancelPath: "C:\\User's Files\\update-cancelled",
    });

    expect(script).toContain("'C:\\User''s Files\\staging'");
    expect(script).toContain("'C:\\User''s Files\\WH3MM'");
    expect(script).toContain("'C:\\User''s Files\\update.log'");
  });

  it.runIf(process.platform === "win32")("is valid Windows PowerShell syntax", () => {
    const script = buildWindowsUpdateScript({
      processId: 43816,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Apps\\WH3MM",
      updateLogPath: "C:\\Users\\Tester\\update.log",
      appExecutablePath: "C:\\Apps\\WH3MM\\WH3 Mod Manager.exe",
      readyPath: "C:\\Temp\\update-ready",
      cancelPath: "C:\\Temp\\update-cancelled",
    });

    execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$source = [Console]::In.ReadToEnd(); [scriptblock]::Create($source) | Out-Null",
      ],
      { input: script },
    );
  });
});
