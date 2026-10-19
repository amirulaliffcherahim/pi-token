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

/**
 * Opens the dashboard in its own window. Resolves false when no launcher is available so the caller can fall back.
 * wt.exe is an app-execution alias: fs.stat/existsSync fail on it, so spawn it and trust the spawn/error events instead.
 */
function launchWindow(options: LaunchOptions): Promise<boolean> {
  if (process.platform !== "win32" || !existsSync(STANDALONE_ENTRY)) return Promise.resolve(false);

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
  const candidates = ["wt.exe", join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "wt.exe")];
  return tryLaunch(candidates, args);
}

function tryLaunch(candidates: string[], args: string[]): Promise<boolean> {
  const [command, ...rest] = candidates;
  if (!command) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", () => resolve(tryLaunch(rest, args)));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(tryLaunch(rest, args));
    }
  });
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

  if (!words.includes("here") && (await launchWindow(options))) {
    ctx.ui.notify("pi-token opened in a new window (/token here for in-terminal view)", "info");
    return;
  }
  await openOverlay(ctx, options);
}
