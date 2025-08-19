import { exec } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import { BaseTerminalAdapter } from "../base";

const execAsync = promisify(exec);

export class TerminalAppAdapter extends BaseTerminalAdapter {
  name = "Terminal";
  bundleId = "com.apple.Terminal";

  async open(directory: string, claudeBinary: string): Promise<void> {
    const command = `cd '${this.escapeShellArg(directory)}'
clear
'${this.escapeShellArg(claudeBinary)}'
exec bash`;

    const scriptFile = `/tmp/terminal-cmd-${Date.now()}.sh`;
    await writeFile(scriptFile, command, { mode: 0o755 });

    const checkScript = `
      tell application "System Events"
        set isRunning to (name of processes) contains "Terminal"
      end tell
      
      if isRunning then
        tell application "Terminal"
          set windowCount to count of windows
          if windowCount > 0 then
            set frontWindow to front window
            set tabCount to count of tabs of frontWindow
            set currentTab to selected tab of frontWindow
            try
              set isBusy to busy of currentTab
              set processCount to count of processes of currentTab
            catch
              set isBusy to false
              set processCount to 1
            end try
            return "running:" & windowCount & ":" & tabCount & ":" & isBusy & ":" & processCount
          else
            return "running:0:0:false:0"
          end if
        end tell
      else
        return "not_running"
      end if
    `;

    const { stdout: checkResult } = await execAsync(
      `osascript -e '${checkScript.replace(/'/g, "'\"'\"'").replace(/\n/g, "' -e '")}'`,
    );

    let openScript: string;
    const result = checkResult.trim();

    if (result === "not_running") {
      openScript = `
        tell application "Terminal"
          activate
          delay 0.5
          do script "bash ${scriptFile} && rm ${scriptFile}" in front window
        end tell
      `;
    } else {
      const [, windowCount, tabCount, isBusy, processCount] = result.split(":");

      if (windowCount === "0") {
        openScript = `
          tell application "Terminal"
            do script "bash ${scriptFile} && rm ${scriptFile}"
            activate
          end tell
        `;
      } else if (tabCount === "1" && (isBusy === "false" || processCount === "1")) {
        openScript = `
          tell application "Terminal"
            do script "bash ${scriptFile} && rm ${scriptFile}" in front window
            activate
          end tell
        `;
      } else {
        openScript = `
          tell application "Terminal"
            do script "bash ${scriptFile} && rm ${scriptFile}"
            activate
          end tell
        `;
      }
    }

    await execAsync(`osascript -e '${openScript.replace(/'/g, "'\"'\"'").replace(/\n/g, "' -e '")}'`);
  }
}
