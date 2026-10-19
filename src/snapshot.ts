import { fetchAllPlans } from "./data/plans.ts";
import { syncSessionsIncremental } from "./data/sync.ts";
import { getTokenOverview } from "./data/telemetry.ts";
import type { PlanInfo, TimeFilter, TokenScope, TokenSnapshot } from "./types.ts";

const PLAN_CACHE_TTL_MS = 60_000;
let planCache: { plans: PlanInfo[]; fetchedAt: number } | undefined;

const hasQuotaData = (plan: PlanInfo) => Boolean(plan.primaryLimit || plan.quotaGroups?.length || plan.balance);

/** Provider quota APIs rate-limit (Claude returns 429), so fetch at most once a minute and keep last good data on failure. */
async function getPlans(force: boolean): Promise<PlanInfo[]> {
  if (!force && planCache && Date.now() - planCache.fetchedAt < PLAN_CACHE_TTL_MS) return planCache.plans;
  const fresh = await getPlans(force);
  const previous = planCache?.plans ?? [];
  const merged = fresh.map((plan) => {
    const last = previous.find((old) => old.id === plan.id);
    return !hasQuotaData(plan) && last && hasQuotaData(last) ? { ...last, statusText: `stale · ${plan.statusText ?? "fetch failed"}` } : plan;
  });
  planCache = { plans: merged, fetchedAt: Date.now() };
  return merged;
}

/** Shared by the in-Pi overlay and the standalone window so both show identical data. */
export async function loadSnapshot(cwd: string, scope: TokenScope, filter: TimeFilter, force = false): Promise<TokenSnapshot> {
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
