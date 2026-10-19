import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadSnapshot } from "./snapshot.ts";
import type { TimeFilter, TokenScope, TokenTab } from "./types.ts";
import { TokenView } from "./ui/view.ts";

const STANDALONE_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "standalone.ts");

interface LaunchOptions {
  cwd: string;
  scope: TokenScope;
  tab: TokenTab;
}

/** Windows Terminal ships as a per-user app alias, so it is not always on PATH for child processes. */
function findWindowsTerminal(): string | undefined {
  const alias = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "wt.exe");
  return existsSync(alias) ? alias : undefined;
}

/** Opens the dashboard in its own window. Returns false when no launcher is available so the caller can fall back. */
function launchWindow(options: LaunchOptions): boolean {
  if (process.platform !== "win32") return false;
  const wt = findWindowsTerminal();
  if (!wt || !existsSync(STANDALONE_ENTRY)) return false;

  const args = [
    "-w", "new",
    "--title", "pi-token",
    process.execPath,
    "--experimental-strip-types", "--no-warnings",
    STANDALONE_ENTRY,
    "--cwd", options.cwd,
    "--scope", options.scope,
    "--tab", options.tab,
  ];
  try {
    const child = spawn(wt, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function openOverlay(ctx: ExtensionCommandContext, options: LaunchOptions): Promise<void> {
  const filter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
  const snapshot = await loadSnapshot(options.cwd, options.scope, filter);

  await ctx.ui.custom<void>((tui: any, _theme: any, _keybindings: any, done: () => void) => {
    const view = new TokenView({
      snapshot,
      done,
      getTerminalRows: () => tui.rows || 30,
      initialTab: options.tab,
      onRefresh: (scope, nextFilter) => loadSnapshot(options.cwd, scope, nextFilter),
      onUpdate: () => tui.requestRender(),
    });
    return {
      render: (width: number) => view.render(width).map((line) => String(line ?? "")),
      handleInput: (data: string) => {
        view.handleInput(data);
        tui.requestRender();
      },
      invalidate: () => view.invalidate(),
    };
  });
}

/** /token [usage|overview] [global] [here]  — opens a separate window by default; `here` forces the in-Pi overlay. */
export async function runToken(_pi: ExtensionAPI, rawArgs: string, ctx: ExtensionCommandContext): Promise<void> {
  const words = (rawArgs || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const options: LaunchOptions = {
    cwd: ctx.cwd || process.cwd(),
    scope: words.includes("global") ? "global" : "repo",
    tab: words.includes("overview") || words.includes("spend") ? "overview" : "usage",
  };

  if (!words.includes("here") && launchWindow(options)) {
    ctx.ui.notify("pi-token opened in a new window (/token here for in-terminal view)", "info");
    return;
  }
  await openOverlay(ctx, options);
}
