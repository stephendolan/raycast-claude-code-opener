import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { BaseTerminalAdapter } from "../base";

const execAsync = promisify(exec);

export class AlacrittyAdapter extends BaseTerminalAdapter {
  name = "Alacritty";
  bundleId = "org.alacritty";

  async open(directory: string, claudeBinary: string): Promise<void> {
    const userShell = this.getUserShell();

    const initScript = `/tmp/claude-init-${Date.now()}.sh`;
    const initContent = `cd '${this.escapeShellArg(directory)}'
clear
'${this.escapeShellArg(claudeBinary)}'
`;

    await writeFile(initScript, initContent, { mode: 0o644 });

    await execAsync(`open -n -a Alacritty --args -e ${userShell} -l -i -c "source ${initScript} && rm -f ${initScript}; exec ${userShell} -l"`);

    setTimeout(() => {
      unlink(initScript).catch(() => {});
    }, 5000);
  }
}
