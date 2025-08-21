import { exec } from "child_process";
import { promisify } from "util";
import { TerminalAdapter } from "../types";

const execAsync = promisify(exec);

export class TerminalAppAdapter implements TerminalAdapter {
  name = "Terminal";
  bundleId = "com.apple.Terminal";

  async open(directory: string, claudeBinary: string): Promise<void> {
    const userShell = process.env.SHELL || "/bin/zsh";

    // Properly escape for shell execution within AppleScript
    const escapeForShell = (str: string) => str.replace(/'/g, "'\\''");
    
    const escapedDir = escapeForShell(directory);
    const escapedBinary = escapeForShell(claudeBinary);
    
    // Build the shell command
    const shellCommand = `cd '${escapedDir}' && clear && '${escapedBinary}' ; exec ${userShell}`;
    
    // Escape for AppleScript - we need to escape backslashes and double quotes
    const escapeForAppleScript = (str: string) => {
      return str
        .replace(/\\/g, "\\\\")  // Escape backslashes first
        .replace(/"/g, '\\"');    // Then escape double quotes
    };
    
    const escapedCommand = escapeForAppleScript(shellCommand);
    
    // Use heredoc-style approach to avoid complex escaping
    const appleScript = `tell application "Terminal"
do script "${escapedCommand}"
activate
end tell`;

    // Execute with proper escaping for the shell
    const finalScript = appleScript.replace(/'/g, "'\"'\"'");
    await execAsync(`osascript -e '${finalScript}'`);
  }
}
