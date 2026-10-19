import { fetchAllPlans } from "./data/plans.ts";
import { syncSessionsIncremental } from "./data/sync.ts";
import { getTokenOverview } from "./data/telemetry.ts";
import type { TimeFilter, TokenScope, TokenSnapshot } from "./types.ts";

/** Shared by the in-Pi overlay and the standalone window so both show identical data. */
export async function loadSnapshot(cwd: string, scope: TokenScope, filter: TimeFilter): Promise<TokenSnapshot> {
  await syncSessionsIncremental().catch(() => {});
  const plans = await fetchAllPlans();
  const overview = getTokenOverview(scope, cwd, filter);
  return {
    timestamp: new Date(),
    activeScope: scope,
    plans,
    overview,
    activeSessions: [],
    daemonRunning: false,
  };
}
