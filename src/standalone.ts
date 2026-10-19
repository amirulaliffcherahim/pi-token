// Standalone dashboard: runs in its own terminal window so the Pi session stays usable.
// Usage: node --experimental-strip-types src/standalone.ts [--cwd DIR] [--scope repo|global] [--tab usage|overview|...]
//        [--once [--width N] [--rows N]]   (print one frame and exit; for non-TTY checks)
import { loadSnapshot } from "./snapshot.ts";
import type { TimeFilter, TokenScope, TokenTab } from "./types.ts";
import { TokenView } from "./ui/view.ts";

const AUTO_REFRESH_MS = 30_000;
const TABS: TokenTab[] = ["usage", "overview", "models", "daily", "hourly", "sessions"];

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const cwd = argValue("cwd") ?? process.cwd();
const scope: TokenScope = argValue("scope") === "global" ? "global" : "repo";
const requestedTab = argValue("tab") as TokenTab | undefined;
const initialTab: TokenTab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "usage";
const filter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
const onceMode = process.argv.includes("--once");

const load = (nextScope: TokenScope, nextFilter: TimeFilter, force = false) => loadSnapshot(cwd, nextScope, nextFilter, force);

async function printOnce(): Promise<void> {
  const width = Number(argValue("width") ?? 120);
  const rows = Number(argValue("rows") ?? 36);
  const view = new TokenView({
    snapshot: await load(scope, filter),
    done: () => {},
    getTerminalRows: () => rows,
    onRefresh: load,
    initialTab,
  });
  process.stdout.write(view.render(width).join("\n") + "\n");
}

async function runInteractive(): Promise<void> {
  const out = process.stdout;
  let closing = false;
  let timer: NodeJS.Timeout | undefined;

  const restoreTerminal = () => {
    if (timer) clearInterval(timer);
    out.write("\x1b[?25h\x1b[?1049l");
    process.stdin.setRawMode(false);
  };
  const close = () => {
    if (closing) return;
    closing = true;
    restoreTerminal();
    process.exit(0);
  };

  const paint = () => {
    const lines = view.render(out.columns || 120);
    out.write("\x1b[H" + lines.map((line) => `${line}\x1b[K`).join("\n") + "\x1b[J");
  };

  const view = new TokenView({
    snapshot: await load(scope, filter),
    done: close,
    getTerminalRows: () => out.rows || 30,
    onRefresh: load,
    initialTab,
    onUpdate: paint,
  });

  out.write(`\x1b]0;pi-token\x07\x1b[?1049h\x1b[?25l`);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key: string) => {
    view.handleInput(key);
    paint();
  });
  out.on("resize", paint);
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
  process.on("exit", () => {
    if (!closing) restoreTerminal();
  });
  timer = setInterval(() => void view.triggerRefresh(), AUTO_REFRESH_MS);
  paint();
}

const entry = onceMode ? printOnce() : runInteractive();
entry.catch((error: unknown) => {
  process.stderr.write(`pi-token: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
