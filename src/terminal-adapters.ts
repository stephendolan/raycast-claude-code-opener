import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

export interface TerminalAdapter {
  name: string;
  bundleId: string;
  open(directory: string, claudeBinary: string): Promise<void>;
}

export abstract class BaseTerminalAdapter implements TerminalAdapter {
  abstract name: string;
  abstract bundleId: string;

  abstract open(directory: string, claudeBinary: string): Promise<void>;

  protected escapeShellArg(arg: string): string {
    return arg.replace(/'/g, "'\\''");
  }

  protected getUserShell(): string {
    return process.env.SHELL || "/bin/zsh";
  }
}

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

export class AlacrittyAdapter extends BaseTerminalAdapter {
  name = "Alacritty";
  bundleId = "org.alacritty";

  async open(directory: string, claudeBinary: string): Promise<void> {
    const userShell = this.getUserShell();
    const shellName = path.basename(userShell);

    const initScript = `/tmp/claude-init-${Date.now()}.sh`;
    const initContent = `#!/usr/bin/env ${shellName}
cd '${this.escapeShellArg(directory)}'
clear
'${this.escapeShellArg(claudeBinary)}'
exec ${userShell} -l
`;

    await writeFile(initScript, initContent, { mode: 0o755 });

    await execAsync(`open -n -a Alacritty --args -e ${userShell} -l -c "${initScript} && rm -f ${initScript}"`);

    setTimeout(() => {
      unlink(initScript).catch(() => {});
    }, 5000);
  }
}

// Registry of available terminal adapters
const TERMINAL_ADAPTERS = new Map<string, TerminalAdapter>([
  ["Terminal", new TerminalAppAdapter()],
  ["Alacritty", new AlacrittyAdapter()],
]);

export function getTerminalAdapter(terminalApp: string): TerminalAdapter | undefined {
  return TERMINAL_ADAPTERS.get(terminalApp);
}

export function getSupportedTerminals(): string[] {
  return Array.from(TERMINAL_ADAPTERS.keys());
}
