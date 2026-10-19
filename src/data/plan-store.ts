import { getDb, getState, setState } from "./db.ts";
import type { PlanInfo } from "../types.ts";

const PLANS_KEY = "plans_json";
const HISTORY_KEY = "plans_history_at";
const HISTORY_INTERVAL_MS = 5 * 60_000;
const HISTORY_RETENTION_MS = 30 * 86_400_000;

const hasQuotaData = (plan: PlanInfo) => Boolean(plan.primaryLimit || plan.quotaGroups?.length || plan.balance);

/** Provider quota APIs rate-limit (Claude returns 429): keep the last good numbers and mark them stale. */
export function mergeWithPrevious(fresh: PlanInfo[], previous: PlanInfo[]): PlanInfo[] {
  return fresh.map((plan) => {
    const last = previous.find((old) => old.id === plan.id);
    return !hasQuotaData(plan) && last && hasQuotaData(last)
      ? { ...last, statusText: `stale · ${plan.statusText ?? "fetch failed"}` }
      : plan;
  });
}

function reviveDates(plan: PlanInfo): PlanInfo {
  const limit = plan.primaryLimit;
  return {
    ...plan,
    lastUpdated: new Date(plan.lastUpdated),
    primaryLimit: limit ? { ...limit, resetAt: limit.resetAt ? new Date(limit.resetAt) : undefined } : undefined,
  };
}

/** Plans the daemon cached, or undefined when absent/older than maxAgeMs. PlanInfo never contains secrets (identities are masked upstream). */
export function loadCachedPlans(maxAgeMs: number): PlanInfo[] | undefined {
  const raw = getState(PLANS_KEY);
  const updatedAt = Number(getState("plans_at") ?? 0);
  if (!raw || Date.now() - updatedAt > maxAgeMs) return undefined;
  try {
    return (JSON.parse(raw) as PlanInfo[]).map(reviveDates);
  } catch {
    return undefined;
  }
}

function worstUsedPercent(plan: PlanInfo): number | null {
  if (plan.primaryLimit) return plan.primaryLimit.usedPercent;
  const buckets = plan.quotaGroups?.flatMap((group) => group.buckets) ?? [];
  if (buckets.length === 0) return null;
  return (1 - Math.min(...buckets.map((bucket) => bucket.remainingFraction))) * 100;
}

function nextResetMillis(plan: PlanInfo): number | null {
  const candidates = [plan.primaryLimit?.resetAt, ...(plan.quotaGroups ?? []).flatMap((g) => g.buckets.map((b) => b.resetTime))]
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((ms) => Number.isFinite(ms) && ms > Date.now());
  return candidates.length ? Math.min(...candidates) : null;
}

export function savePlans(plans: PlanInfo[]): void {
  setState(PLANS_KEY, JSON.stringify(plans));
  setState("plans_at", String(Date.now()));

  const lastHistory = Number(getState(HISTORY_KEY) ?? 0);
  if (Date.now() - lastHistory < HISTORY_INTERVAL_MS) return;

  const db = getDb();
  const insert = db.prepare(
    "INSERT INTO plan_snapshots (timestamp, provider_id, plan_type, account, status, used_percent, reset_at, resets_available) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const now = Date.now();
  for (const plan of plans) {
    insert.run(now, plan.id, plan.planType, plan.account, plan.status, worstUsedPercent(plan), nextResetMillis(plan), plan.resetsAvailable ?? null);
  }
  db.prepare("DELETE FROM plan_snapshots WHERE timestamp < ?").run(now - HISTORY_RETENTION_MS);
  setState(HISTORY_KEY, String(now));
}
