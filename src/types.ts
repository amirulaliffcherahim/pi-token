export type PulseScope = "repo" | "global";

export type TimeFilterMode = "day" | "all" | "7d" | "30d";

export interface TimeFilter {
  mode: TimeFilterMode;
  dayOffset: number; // 0 = today, -1 = yesterday, etc.
  label: string;
}

export type TokScaleTab =
  | "usage"     // 1. Quota & Limits
  | "overview"  // 2. 2-Col Burn & Tool breakdown
  | "models"    // 3. Models comparison table
  | "daily"     // 4. Daily history table
  | "hourly"    // 5. 24h diurnal pattern
  | "sessions"; // 6. Recent sessions ledger

export interface RateLimitWindow {
  allowed: boolean;
  usedPercent: number;
  limitWindowSeconds?: number;
  resetAfterSeconds?: number;
  resetAt?: Date;
}

export interface SecondaryRateLimit {
  name: string;
  usedPercent: number;
  resetAfterSeconds?: number;
}

export interface QuotaBucket {
  name: string;
  remainingFraction: number; // 0..1 (e.g. 0.98 = 98% left)
  resetTime?: string;
  unit?: string;
}

export interface QuotaGroup {
  groupName: string;
  buckets: QuotaBucket[];
}

export interface BalanceInfo {
  currency: string;
  totalBalance: number;
  grantedBalance?: number;
  toppedUpBalance?: number;
}

export interface PlanInfo {
  id: "claude" | "agy" | "deepseek" | "subq" | "openai" | string;
  name: string;
  account: string;
  planType: string;
  status: "active" | "limited" | "connected" | "error" | "offline";
  statusText?: string;
  primaryLimit?: RateLimitWindow;
  secondaryLimits?: SecondaryRateLimit[];
  quotaGroups?: QuotaGroup[];
  balance?: BalanceInfo;
  resetsAvailable?: number;
  lastUpdated: Date;
}

export interface DailyActivityRow {
  date: string;
  cost: number;
  calls: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheHitRate: number;
}

export interface HourlyActivityRow {
  hour: string; // 00..23
  cost: number;
  calls: number;
  tokens: number;
}

export interface ModelDetailRow {
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  cost: number;
  calls: number;
  cacheHitRate: number;
}

export interface SessionDetailRow {
  sessionId: string;
  workspace: string;
  model: string;
  calls: number;
  cost: number;
  tokens: number;
  lastActive: string;
}

export interface ProjectSpendRow {
  project: string;
  cost: number;
  sessions: number;
}

export interface ModelSpendRow {
  model: string;
  cost: number;
  calls: number;
}

export interface ActivityBreakdownRow {
  name: string;
  cost: number;
  turns: number;
  pct: number;
}

export interface ToolCallsRow {
  name: string;
  calls: number;
}

export interface TokScaleOverview {
  periodLabel: string;
  totalCost: number;
  totalCalls: number;
  totalSessions: number;
  cacheHitRate: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  writtenTokens: number;
  burnVelocityUsdPerHour: number;
  burnVelocityTokensPerMin: number;

  dailyActivity: DailyActivityRow[];
  hourlyActivity: HourlyActivityRow[];
  byProject: ProjectSpendRow[];
  byModel: ModelSpendRow[];
  detailedModels: ModelDetailRow[];
  detailedSessions: SessionDetailRow[];
  byActivity: ActivityBreakdownRow[];
  coreTools: ToolCallsRow[];
  shellCommands: ToolCallsRow[];
}

export interface PulseSnapshot {
  timestamp: Date;
  activeScope: PulseScope;
  plans: PlanInfo[];
  overview: TokScaleOverview;
  daemonRunning: boolean;
}
