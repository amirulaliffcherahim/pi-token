import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PlanInfo, QuotaBucket, QuotaGroup, RateLimitWindow } from "../types.js";

function maskIdentifier(val: string): string {
  if (!val) return "unknown";
  if (val.includes("@")) {
    const parts = val.split("@");
    const name = parts[0];
    const domain = parts[1];
    const maskedName = name.length <= 2 ? name[0] + "***" : name.slice(0, 2) + "***" + name.slice(-1);
    return `${maskedName}@${domain}`;
  }
  if (val.length <= 8) return "***";
  return val.slice(0, 3) + "***" + val.slice(-3);
}

function getPiDir(): string {
  return path.join(os.homedir(), ".pi", "agent");
}

export function readAuthFile(): Record<string, any> {
  try {
    const authPath = path.join(getPiDir(), "auth.json");
    if (fs.existsSync(authPath)) {
      return JSON.parse(fs.readFileSync(authPath, "utf-8"));
    }
  } catch {}
  return {};
}

/** 1. Claude Plan Quota & Session/Weekly Windows */
async function fetchClaudePlan(authEntry: any): Promise<PlanInfo | null> {
  if (!authEntry || (!authEntry.access && !authEntry.refresh)) return null;

  const email = authEntry.emailAddress || authEntry.email || "Claude Pro User";
  const maskedEmail = maskIdentifier(email);
  const planType = (authEntry.subscriptionType || "pro").toUpperCase();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: "Bearer " + authEntry.access,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-cli/2.1.303 (external, cli)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        id: "claude",
        name: "Anthropic Claude",
        account: maskedEmail,
        planType: `Claude ${planType}`,
        status: "connected",
        statusText: `API Status ${res.status}`,
        lastUpdated: new Date(),
      };
    }

    const payload: any = await res.json();
    let primaryLimit: RateLimitWindow | undefined;
    const quotaBuckets: QuotaBucket[] = [];

    if (payload.five_hour) {
      const used = payload.five_hour.utilization ?? 0;
      const remFrac = Math.max(0, Math.min(1, 1 - used / 100));
      primaryLimit = {
        allowed: used < 100,
        usedPercent: used,
        resetAt: payload.five_hour.resets_at ? new Date(payload.five_hour.resets_at) : undefined,
      };
      quotaBuckets.push({
        name: "5-Hour Session Window",
        remainingFraction: remFrac,
        resetTime: payload.five_hour.resets_at,
        unit: "%",
      });
    }

    if (payload.seven_day) {
      const used = payload.seven_day.utilization ?? 0;
      const remFrac = Math.max(0, Math.min(1, 1 - used / 100));
      quotaBuckets.push({
        name: "7-Day Weekly Window",
        remainingFraction: remFrac,
        resetTime: payload.seven_day.resets_at,
        unit: "%",
      });
    }

    if (payload.seven_day_opus) {
      const used = payload.seven_day_opus.utilization ?? 0;
      quotaBuckets.push({
        name: "7-Day Opus Tier",
        remainingFraction: Math.max(0, Math.min(1, 1 - used / 100)),
        resetTime: payload.seven_day_opus.resets_at,
        unit: "%",
      });
    }

    if (payload.seven_day_sonnet) {
      const used = payload.seven_day_sonnet.utilization ?? 0;
      quotaBuckets.push({
        name: "7-Day Sonnet Tier",
        remainingFraction: Math.max(0, Math.min(1, 1 - used / 100)),
        resetTime: payload.seven_day_sonnet.resets_at,
        unit: "%",
      });
    }

    const isLimited = (primaryLimit && primaryLimit.usedPercent >= 100) || false;

    return {
      id: "claude",
      name: "Anthropic Claude",
      account: maskedEmail,
      planType: `Claude ${planType}`,
      status: isLimited ? "limited" : "active",
      statusText: isLimited ? "Rate limit reached" : "Active & Ready",
      primaryLimit,
      quotaGroups: [{ groupName: "Claude Quota Windows", buckets: quotaBuckets }],
      lastUpdated: new Date(),
    };
  } catch (err: any) {
    return {
      id: "claude",
      name: "Anthropic Claude",
      account: maskedEmail,
      planType: `Claude ${planType}`,
      status: "connected",
      statusText: err.name === "AbortError" ? "Usage check timed out" : (err.message || "Connected"),
      lastUpdated: new Date(),
    };
  }
}

/** 2. Antigravity Quota & Models Availability */
async function fetchAntigravityPlan(authEntry: any): Promise<PlanInfo | null> {
  if (!authEntry || (!authEntry.access && !authEntry.refresh)) return null;

  const email = authEntry.email || "Google Account";
  const maskedEmail = maskIdentifier(email);
  const token = authEntry.access;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const endpoints = [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://daily-cloudcode-pa.sandbox.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ];

    let quotaData: any = null;
    let tierData: any = null;

    for (const endpoint of endpoints) {
      try {
        const [assistRes, quotaRes] = await Promise.all([
          fetch(`${endpoint}/v1internal:loadCodeAssist`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "User-Agent": "antigravity/cli/1.2.4 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)",
            },
            body: JSON.stringify({
              metadata: { ideType: "ANTIGRAVITY", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
            }),
            signal: controller.signal,
          }),
          fetch(`${endpoint}/v1internal:fetchAvailableModels`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "User-Agent": "antigravity/cli/1.2.4 (aidev_client; os_type=linux; arch=amd64; cl=982146307; auth_method=consumer)",
            },
            body: JSON.stringify({}),
            signal: controller.signal,
          }),
        ]);

        if (assistRes.ok) tierData = await assistRes.json();
        if (quotaRes.ok) quotaData = await quotaRes.json();
        if (tierData || quotaData) break;
      } catch {}
    }
    clearTimeout(timeout);

    const planType = tierData?.currentTier?.name || "Antigravity";
    const quotaBuckets: QuotaBucket[] = [];

    if (quotaData && quotaData.models) {
      // Pick key representative models: opus, sonnet, gemini-3.8-flash, gemini-2.5-flash-thinking
      const keyModels = ["claude-opus-5-5-low", "claude-sonnet-5-5-low", "gemini-3.8-flash-high", "gemini-2.5-flash-thinking"];
      for (const mId of keyModels) {
        const m = quotaData.models[mId];
        if (m && m.quotaInfo) {
          const remFrac = typeof m.quotaInfo.remainingFraction === "number" ? m.quotaInfo.remainingFraction : 1.0;
          quotaBuckets.push({
            name: mId.replace("-low", "").replace("-high", ""),
            remainingFraction: remFrac,
            resetTime: m.quotaInfo.resetTime,
            unit: "%",
          });
        }
      }
    }

    return {
      id: "agy",
      name: "Google Antigravity",
      account: maskedEmail,
      planType,
      status: "active",
      statusText: "Ready & Connected",
      quotaGroups: quotaBuckets.length > 0 ? [{ groupName: "Model Quotas", buckets: quotaBuckets }] : undefined,
      lastUpdated: new Date(),
    };
  } catch (err: any) {
    return {
      id: "agy",
      name: "Google Antigravity",
      account: maskedEmail,
      planType: "Antigravity",
      status: "connected",
      statusText: err.name === "AbortError" ? "Timeout checking quota" : "Connected",
      lastUpdated: new Date(),
    };
  }
}

/** 3. DeepSeek Account & Real-Time Balance */
async function fetchDeepSeekPlan(authEntry: any): Promise<PlanInfo | null> {
  if (!authEntry || !authEntry.key) return null;

  const maskedKey = maskIdentifier(authEntry.key);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch("https://api.deepseek.com/user/balance", {
      headers: {
        Authorization: "Bearer " + authEntry.key,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        id: "deepseek",
        name: "DeepSeek",
        account: maskedKey,
        planType: "Pay-as-you-go",
        status: "connected",
        statusText: `Status ${res.status}`,
        lastUpdated: new Date(),
      };
    }

    const data: any = await res.json();
    const info = data.balance_infos?.[0];
    const total = parseFloat(info?.total_balance || "0");
    const granted = parseFloat(info?.granted_balance || "0");
    const toppedUp = parseFloat(info?.topped_up_balance || "0");

    return {
      id: "deepseek",
      name: "DeepSeek",
      account: maskedKey,
      planType: "Pay-as-you-go",
      status: total > 0 ? "active" : "limited",
      statusText: total > 0 ? `$${total.toFixed(2)} available` : "Zero balance",
      balance: {
        currency: info?.currency || "USD",
        totalBalance: total,
        grantedBalance: granted,
        toppedUpBalance: toppedUp,
      },
      lastUpdated: new Date(),
    };
  } catch (err: any) {
    return {
      id: "deepseek",
      name: "DeepSeek",
      account: maskedKey,
      planType: "Pay-as-you-go",
      status: "connected",
      statusText: "Connected (balance check skipped)",
      lastUpdated: new Date(),
    };
  }
}

/** 4. SubQ / Snap Gate Provider */
async function fetchSubqPlan(authEntry: any): Promise<PlanInfo | null> {
  if (!authEntry || !authEntry.key) return null;
  const maskedKey = maskIdentifier(authEntry.key);

  return {
    id: "subq",
    name: "SubQ Gate",
    account: maskedKey,
    planType: "Fast Snap Compliance Gate",
    status: "active",
    statusText: "Ready & Active",
    lastUpdated: new Date(),
  };
}

/** 5. OpenAI / Other Fallback */
async function fetchOpenAiPlan(authEntry: any): Promise<PlanInfo | null> {
  if (!authEntry) return null;
  const key = authEntry.key || authEntry.access;
  if (!key) return null;

  return {
    id: "openai",
    name: "OpenAI",
    account: maskIdentifier(key),
    planType: "API Key",
    status: "active",
    statusText: "Ready",
    lastUpdated: new Date(),
  };
}

/** Auto-detect all connected accounts in auth.json */
export async function fetchAllPlans(): Promise<PlanInfo[]> {
  const auth = readAuthFile();
  const plans: PlanInfo[] = [];

  const promises: Promise<PlanInfo | null>[] = [];

  if (auth.claude) promises.push(fetchClaudePlan(auth.claude));
  if (auth.agy || auth.antigravity) promises.push(fetchAntigravityPlan(auth.agy || auth.antigravity));
  if (auth.deepseek) promises.push(fetchDeepSeekPlan(auth.deepseek));
  if (auth.subq) promises.push(fetchSubqPlan(auth.subq));
  if (auth.openai || auth["openai-codex"]) promises.push(fetchOpenAiPlan(auth.openai || auth["openai-codex"]));

  const results = await Promise.allSettled(promises);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      plans.push(r.value);
    }
  }

  return plans;
}
