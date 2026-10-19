import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fetchAllPlans } from "./data/plans.js";
import { syncSessionsIncremental } from "./data/sync.js";
import { getTokScaleOverview } from "./data/telemetry.js";
import type { PulseScope, PulseSnapshot, TimeFilter } from "./types.js";
import { TokScaleView } from "./ui/view.js";

async function loadSnapshot(
  ctx: ExtensionCommandContext,
  scope: PulseScope,
  filter: TimeFilter
): Promise<PulseSnapshot> {
  // 1. Sync messages from sessions folder
  await syncSessionsIncremental().catch(() => {});

  // 2. Fetch connected provider plans (Claude, Antigravity, DeepSeek, SubQ, etc.)
  const plans = await fetchAllPlans();

  // 3. Compute telemetry overview
  const cwd = ctx.cwd || process.cwd();
  const overview = getTokScaleOverview(scope, cwd, filter);

  return {
    timestamp: new Date(),
    activeScope: scope,
    plans,
    overview,
    activeSessions: [],
    daemonRunning: false,
  };
}

export async function runPulse(
  pi: ExtensionAPI,
  rawArgs: string,
  ctx: ExtensionCommandContext
): Promise<void> {
  const args = (rawArgs || "").trim().toLowerCase();

  let initialScope: PulseScope = "repo";
  let initialTab: "usage" | "overview" = "usage";

  if (args.includes("global")) {
    initialScope = "global";
  }
  if (args.includes("tokscale") || args.includes("overview") || args.includes("spend")) {
    initialTab = "overview";
  }

  const initialFilter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
  const initialSnapshot = await loadSnapshot(ctx, initialScope, initialFilter);

  // Open custom interactive TUI overlay
  await ctx.ui.custom<{ done: () => void }>(
    (tui: any, theme: any, _kb: any, done: () => void) => {
      const view = new TokScaleView({
        snapshot: initialSnapshot,
        done,
        getTerminalRows: () => tui.rows || 30,
        initialTab,
        onRefresh: async (scope, filter) => {
          return await loadSnapshot(ctx, scope, filter);
        },
      });

      return {
        render: (w: number) => {
          const lines = view.render(w);
          return lines.map((l) => (typeof l === "string" ? l : String(l ?? "")));
        },
        handleInput: (data: string) => {
          view.handleInput(data);
          tui.requestRender();
        },
        invalidate: () => view.invalidate(),
      };
    }
  );
}
