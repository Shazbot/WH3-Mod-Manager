import { describe, expect, it } from "vitest";

import { buildWindowsUpdateScript } from "../src/utility/updateScripts";

describe("buildWindowsUpdateScript", () => {
  it("waits for the application without opening the old cmd find loop", () => {
    const script = buildWindowsUpdateScript({
      processId: 43816,
      updateSourceDir: "C:\\Temp\\staging",
      appDir: "C:\\Apps\\WH3MM",
      updateLogPath: "C:\\Users\\Tester\\update.log",
      appExecutablePath: "C:\\Apps\\WH3MM\\WH3 Mod Manager.exe",
    });

    expect(script).toContain("Wait-Process -Id 43816 -ErrorAction SilentlyContinue");
    expect(script).not.toContain("tasklist");
    expect(script).not.toContain('find "43816"');
    expect(script).toContain("$updateSourceDir = 'C:\\Temp\\staging'");
    expect(script).toContain("$appExecutablePath = 'C:\\Apps\\WH3MM\\WH3 Mod Manager.exe'");
    expect(script).toContain("Get-ChildItem -LiteralPath $updateSourceDir -Force");
    expect(script).toContain("Start-Process -FilePath $appExecutablePath");
  });

  it("escapes apostrophes in paths", () => {
    const script = buildWindowsUpdateScript({
      processId: 1,
      updateSourceDir: "C:\\User's Files\\staging",
      appDir: "C:\\User's Files\\WH3MM",
      updateLogPath: "C:\\User's Files\\update.log",
      appExecutablePath: "C:\\User's Files\\WH3MM\\WH3MM.exe",
    });

    expect(script).toContain("'C:\\User''s Files\\staging'");
    expect(script).toContain("'C:\\User''s Files\\WH3MM'");
    expect(script).toContain("'C:\\User''s Files\\update.log'");
  });
});
