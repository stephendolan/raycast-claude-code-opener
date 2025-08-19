import { TerminalAdapter } from "./types";

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
