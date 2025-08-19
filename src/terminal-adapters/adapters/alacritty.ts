import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { BaseTerminalAdapter } from "../base";

const execAsync = promisify(exec);

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
