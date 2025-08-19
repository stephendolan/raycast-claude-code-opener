import { TerminalAdapter } from "./types";
import { TerminalAppAdapter } from "./adapters/terminal-app";
import { AlacrittyAdapter } from "./adapters/alacritty";

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
