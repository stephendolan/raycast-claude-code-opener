import { exec } from "child_process";
import { promisify } from "util";
import { TerminalAdapter } from "../types";

const execAsync = promisify(exec);

export class AlacrittyAdapter implements TerminalAdapter {
  name = "Alacritty";
  bundleId = "org.alacritty";

  private escapeForShell(str: string): string {
    return str.replace(/'/g, "'\\''");
  }

  async open(directory: string, claudeBinary: string): Promise<void> {
    const userShell = process.env.SHELL || "/bin/zsh";
    const escapedDir = this.escapeForShell(directory);
    const escapedBinary = this.escapeForShell(claudeBinary);

    const command = `cd '${escapedDir}' && clear && '${escapedBinary}' ; exec ${userShell} -l`;

    await execAsync(`open -n -a Alacritty --args -e ${userShell} -l -i -c "${command}"`);
  }
}
