import { getDaemonStatus } from "./daemon/control.ts";
import { fetchAllPlans } from "./data/plans.ts";
import { loadCachedPlans, mergeWithPrevious } from "./data/plan-store.ts";
import { syncSessionsIncremental } from "./data/sync.ts";
import { getTokenOverview } from "./data/telemetry.ts";
import type { PlanInfo, TimeFilter, TokenScope, TokenSnapshot } from "./types.ts";

const PLAN_CACHE_TTL_MS = 60_000;
/** The daemon refreshes every 60s; allow one missed refresh before the dashboard fetches for itself. */
const DAEMON_PLAN_MAX_AGE_MS = 150_000;

let memoryCache: { plans: PlanInfo[]; fetchedAt: number } | undefined;

/** Provider quota APIs rate-limit (Claude returns 429): prefer the daemon's cache, then a 60s in-memory cache. */
async function getPlans(force: boolean, daemonRunning: boolean): Promise<PlanInfo[]> {
  if (!force && daemonRunning) {
    const cached = loadCachedPlans(DAEMON_PLAN_MAX_AGE_MS);
    if (cached) return cached;
  }
  if (!force && memoryCache && Date.now() - memoryCache.fetchedAt < PLAN_CACHE_TTL_MS) return memoryCache.plans;
  const plans = mergeWithPrevious(await fetchAllPlans(), memoryCache?.plans ?? []);
  memoryCache = { plans, fetchedAt: Date.now() };
  return plans;
}

/** Shared by the in-Pi overlay and the standalone window so both show identical data. */
export async function loadSnapshot(cwd: string, scope: TokenScope, filter: TimeFilter, force = false): Promise<TokenSnapshot> {
  const daemon = getDaemonStatus();
  // The daemon already indexes sessions; indexing here too would just race it for the write lock.
  if (!daemon.isRunning) await syncSessionsIncremental().catch(() => {});
  const plans = await getPlans(force, daemon.isRunning);
  return {
    timestamp: new Date(),
    activeScope: scope,
    plans,
    overview: getTokenOverview(scope, cwd, filter),
    daemon,
  };
}
