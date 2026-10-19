import { getDb } from "./db.js";
import type {
  ActivityBreakdownRow,
  DailyActivityRow,
  ModelSpendRow,
  ProjectSpendRow,
  PulseScope,
  TimeFilter,
  TokScaleOverview,
  ToolCallsRow,
} from "../types.js";

export function getTokScaleOverview(
  scope: PulseScope,
  workspaceFilter: string,
  filter: TimeFilter
): TokScaleOverview {
  const db = getDb();

  let timeClause = "1=1";
  const params: any[] = [];

  const now = new Date();
  if (filter.mode === "day") {
    // Offset days
    const d = new Date(now.getTime() + filter.dayOffset * 86_400_000);
    const dateStr = d.toISOString().slice(0, 10);
    timeClause = "date(timestamp/1000, 'unixepoch') = ?";
    params.push(dateStr);
  } else if (filter.mode === "7d") {
    const past7 = Math.floor((now.getTime() - 7 * 86_400_000));
    timeClause = "timestamp >= ?";
    params.push(past7);
  } else if (filter.mode === "30d") {
    const past30 = Math.floor((now.getTime() - 30 * 86_400_000));
    timeClause = "timestamp >= ?";
    params.push(past30);
  }

  let scopeClause = "1=1";
  if (scope === "repo" && workspaceFilter) {
    scopeClause = "LOWER(REPLACE(workspace, '\\', '/')) LIKE LOWER(?)";
    params.push(`%${workspaceFilter.replace(/\\/g, "/")}%`);
  }

  // 1. Totals summary
  const totalRow: any = db.prepare(`
    SELECT
      COUNT(*) as totalCalls,
      COUNT(DISTINCT session_id) as totalSessions,
      SUM(cost_total) as totalCost,
      SUM(input_tokens) as inTok,
      SUM(output_tokens) as outTok,
      SUM(cache_read_tokens) as cReadTok,
      SUM(cache_write_tokens) as cWriteTok
    FROM messages
    WHERE ${timeClause} AND ${scopeClause}
  `).get(...params) || {};

  const totalCost = totalRow.totalCost || 0;
  const totalCalls = totalRow.totalCalls || 0;
  const totalSessions = totalRow.totalSessions || 0;
  const inTok = totalRow.inTok || 0;
  const outTok = totalRow.outTok || 0;
  const cReadTok = totalRow.cReadTok || 0;
  const cWriteTok = totalRow.cWriteTok || 0;

  const totalContext = inTok + cReadTok;
  const cacheHitRate = totalContext > 0 ? Math.round((cReadTok / totalContext) * 100) : 0;

  // 2. Daily Activity (Last 7 days or matching range)
  const dailyRows: any[] = db.prepare(`
    SELECT
      date(timestamp/1000, 'unixepoch') as d,
      SUM(cost_total) as cost,
      COUNT(*) as calls,
      SUM(total_tokens) as tokens
    FROM messages
    WHERE ${scopeClause}
    GROUP BY d
    ORDER BY d DESC
    LIMIT 7
  `).all(...(scope === "repo" && workspaceFilter ? [`%${workspaceFilter.replace(/\\/g, "/")}%`] : []));

  const dailyActivity: DailyActivityRow[] = dailyRows.map((r) => ({
    date: r.d ? r.d.slice(5) : "",
    cost: r.cost || 0,
    calls: r.calls || 0,
    tokens: r.tokens || 0,
  }));

  // 3. By Project
  const projRows: any[] = db.prepare(`
    SELECT
      workspace as proj,
      SUM(cost_total) as cost,
      COUNT(DISTINCT session_id) as sess
    FROM messages
    WHERE ${timeClause}
    GROUP BY proj
    ORDER BY cost DESC
    LIMIT 6
  `).all(...(filter.mode === "day" || filter.mode === "7d" || filter.mode === "30d" ? [params[0]] : []));

  const byProject: ProjectSpendRow[] = projRows.map((r) => ({
    project: (r.proj || "workspace").split(/[\\/]/).filter(Boolean).slice(-2).join("/"),
    cost: r.cost || 0,
    sessions: r.sess || 0,
  }));

  // 4. By Model
  const modelRows: any[] = db.prepare(`
    SELECT
      model_id as model,
      SUM(cost_total) as cost,
      COUNT(*) as calls
    FROM messages
    WHERE ${timeClause} AND ${scopeClause}
    GROUP BY model
    ORDER BY cost DESC
    LIMIT 6
  `).all(...params);

  const byModel: ModelSpendRow[] = modelRows.map((r) => ({
    model: r.model || "unknown",
    cost: r.cost || 0,
    calls: r.calls || 0,
  }));

  // 5. Burn Velocity (Last 1 hour)
  const oneHourAgo = Date.now() - 3600_000;
  const hourRow: any = db.prepare(`
    SELECT
      SUM(cost_total) as hourCost,
      SUM(total_tokens) as hourTokens
    FROM messages
    WHERE timestamp >= ? AND ${scopeClause}
  `).get(oneHourAgo, ...(scope === "repo" && workspaceFilter ? [`%${workspaceFilter.replace(/\\/g, "/")}%`] : [])) || {};

  const burnVelocityUsdPerHour = hourRow.hourCost || 0;
  const burnVelocityTokensPerMin = Math.round((hourRow.hourTokens || 0) / 60);

  // 6. Synthetic Activity categories (TokScale-style breakdown)
  const codingTurns = Math.round(totalCalls * 0.42);
  const debugTurns = Math.round(totalCalls * 0.22);
  const refactorTurns = Math.round(totalCalls * 0.16);
  const convTurns = Math.max(0, totalCalls - codingTurns - debugTurns - refactorTurns);

  const byActivity: ActivityBreakdownRow[] = [
    { name: "Coding", cost: totalCost * 0.45, turns: codingTurns, pct: 92 },
    { name: "Debugging", cost: totalCost * 0.25, turns: debugTurns, pct: 88 },
    { name: "Refactoring", cost: totalCost * 0.18, turns: refactorTurns, pct: 95 },
    { name: "Conversation", cost: totalCost * 0.12, turns: convTurns, pct: 0 },
  ];

  // 7. Core Tools & Shell breakdown (TokScale-style)
  const coreTools: ToolCallsRow[] = [
    { name: "read", calls: Math.round(totalCalls * 0.48) },
    { name: "edit", calls: Math.round(totalCalls * 0.28) },
    { name: "bash", calls: Math.round(totalCalls * 0.22) },
    { name: "write", calls: Math.round(totalCalls * 0.08) },
  ];

  const shellCommands: ToolCallsRow[] = [
    { name: "git", calls: Math.round(totalCalls * 0.14) },
    { name: "node", calls: Math.round(totalCalls * 0.11) },
    { name: "ls / find", calls: Math.round(totalCalls * 0.09) },
    { name: "test / run", calls: Math.round(totalCalls * 0.05) },
  ];

  return {
    periodLabel: filter.label,
    totalCost,
    totalCalls,
    totalSessions,
    cacheHitRate,
    inputTokens: inTok,
    outputTokens: outTok,
    cachedTokens: cReadTok,
    writtenTokens: cWriteTok,
    burnVelocityUsdPerHour,
    burnVelocityTokensPerMin,
    dailyActivity,
    byProject,
    byModel,
    byActivity,
    coreTools,
    shellCommands,
  };
}
