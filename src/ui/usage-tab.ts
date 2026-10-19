import type { PlanInfo } from "../types.ts";
import { boxBottom, boxLine, boxTop, clipAnsi, zipLinesSideBySide } from "./box.ts";
import { C, fit, formatReset, healthColor, renderQuotaBar, visibleLength } from "./theme.ts";

export interface UsageTabState {
  plans: PlanInfo[];
  selectedIndex: number;
  updatedAt: Date;
  isRefreshing: boolean;
}

const BAR_WIDTH = 10;
const MAX_INSPECTOR_BUCKETS = 4;
const SIDE_BY_SIDE_MIN_WIDTH = 100;

const isHealthy = (plan: PlanInfo) => plan.status === "active" || plan.status === "connected";
/** Quota API answered with an HTTP error, timed out, or we are showing cached data. */
const hasFetchProblem = (plan: PlanInfo) => /\d{3}|time|stale/i.test(plan.statusText ?? "");
const isBroken = (plan: PlanInfo) => plan.status === "error" || plan.status === "offline";

function toMillis(value: string | Date | undefined): number {
  if (value instanceof Date) return value.getTime();
  return value ? Date.parse(value) : NaN;
}

/** Lowest-remaining metric of a plan: the number that actually blocks you first. */
function worstBucket(plan: PlanInfo) {
  const buckets = plan.quotaGroups?.flatMap((group) => group.buckets) ?? [];
  if (buckets.length === 0) return undefined;
  return buckets.reduce((worst, bucket) => (bucket.remainingFraction < worst.remainingFraction ? bucket : worst));
}

/** Nearest future reset across every windowed metric: answers "when does capacity come back?" */
function findNextReset(plans: PlanInfo[]): { provider: string; at: number } | undefined {
  let best: { provider: string; at: number } | undefined;
  for (const plan of plans) {
    const candidates = [plan.primaryLimit?.resetAt, ...(plan.quotaGroups ?? []).flatMap((g) => g.buckets.map((b) => b.resetTime))];
    for (const candidate of candidates) {
      const at = toMillis(candidate);
      if (Number.isFinite(at) && at > Date.now() && (!best || at < best.at)) best = { provider: plan.name, at };
    }
  }
  return best;
}

function label(text: string, width = 11): string {
  return `${C.gray}${fit(text, width)}${C.reset}`;
}

function renderReadinessCard(state: UsageTabState, width: number): string[] {
  const inner = width - 4;
  const { plans } = state;
  const ready = plans.filter(isHealthy).length;
  const watch = plans.filter((p) => p.status === "limited").length;
  const issues = plans.filter(isBroken).length;
  const next = findNextReset(plans);
  const overall = issues ? `${C.red}● ATTENTION` : watch ? `${C.amber}● WATCH` : `${C.green}● READY`;
  const refreshing = state.isRefreshing ? `  ${C.amber}⟳ refreshing${C.reset}` : "";

  return [
    boxTop("READINESS", width),
    boxLine(`${label("State")}${C.bold}${overall}${C.reset}`, inner),
    boxLine(`${label("Capacity")}${C.green}${ready} ready${C.reset}${C.gray} · ${watch} watch · ${issues} issue${C.reset}`, inner),
    boxLine(
      `${label("Next reset")}${C.bold}${C.amber}${next ? formatReset(new Date(next.at)) : "—"}${C.reset}${next ? `${C.gray}  ${next.provider}${C.reset}` : ""}`,
      inner,
    ),
    boxLine(`${label("Updated")}${C.white}${state.updatedAt.toLocaleTimeString()}${C.reset}${refreshing}`, inner),
  ];
}

function renderInspectorCard(state: UsageTabState, width: number): string[] {
  const inner = width - 4;
  const selected = state.plans[state.selectedIndex] ?? state.plans[0];
  const card = [boxTop(selected ? `${selected.name}` : "INSPECTOR", width)];

  if (!selected) {
    card.push(boxLine(`${C.gray}No provider connected. Add one with /login.${C.reset}`, inner));
    return card;
  }

  card.push(boxLine(`${label("Account")}${C.white}${selected.account}${C.reset}${C.gray} · ${C.reset}${C.amber}${selected.planType}${C.reset}`, inner));

  if (selected.balance) {
    const { totalBalance, currency, grantedBalance = 0, toppedUpBalance = 0 } = selected.balance;
    card.push(boxLine(`${label("Credit")}${C.bold}${C.green}$${totalBalance.toFixed(2)} ${currency}${C.reset}`, inner));
    card.push(boxLine(`${label("Breakdown")}${C.gray}granted $${grantedBalance.toFixed(2)} · topped up $${toppedUpBalance.toFixed(2)}${C.reset}`, inner));
  }

  const buckets = (selected.quotaGroups ?? []).flatMap((group) => group.buckets);
  const nameWidth = Math.max(10, Math.min(24, inner - BAR_WIDTH - 4 - 8 - 3));
  for (const bucket of buckets.slice(0, MAX_INSPECTOR_BUCKETS)) {
    const color = healthColor(bucket.remainingFraction);
    const percent = `${Math.round(bucket.remainingFraction * 100)}%`.padStart(4);
    card.push(
      boxLine(
        `${C.white}${fit(bucket.name, nameWidth)}${C.reset} ${renderQuotaBar(bucket.remainingFraction, BAR_WIDTH)} ${color}${percent}${C.reset} ${C.gray}${formatReset(bucket.resetTime)}${C.reset}`,
        inner,
      ),
    );
  }
  if (buckets.length > MAX_INSPECTOR_BUCKETS) {
    card.push(boxLine(`${C.darkGray}+${buckets.length - MAX_INSPECTOR_BUCKETS} more${C.reset}`, inner));
  }

  if (!selected.balance && buckets.length === 0) {
    card.push(boxLine(`${label("Status")}${C.white}${selected.statusText ?? selected.status}${C.reset}`, inner));
  }
  return card;
}

/** Pad the shorter card just above its bottom border so both end on the same row. */
function closeCards(left: string[], right: string[], leftW: number, rightW: number): [string[], string[]] {
  const rows = Math.max(left.length, right.length);
  const close = (card: string[], width: number): string[] => {
    const body = card.slice();
    while (body.length < rows) body.push(boxLine("", width - 4));
    body.push(boxBottom(width));
    return body;
  };
  return [close(left, leftW), close(right, rightW)];
}

interface Column {
  title: string;
  width: number;
}

/** Drop low-value columns as the window narrows so rows never wrap or clip mid-bar. */
function pickColumns(innerWidth: number): { plan: boolean; account: boolean } {
  const base = 2 + 20 + 22 + 9 + 9;
  if (innerWidth >= base + 18 + 18) return { plan: true, account: true };
  if (innerWidth >= base + 18) return { plan: false, account: true };
  return { plan: false, account: false };
}

function describeQuota(plan: PlanInfo): { text: string; resetAt?: string | Date; color: string } {
  if (plan.balance) {
    return { text: `$${plan.balance.totalBalance.toFixed(2)} ${plan.balance.currency}`, color: C.green };
  }
  const left = plan.primaryLimit
    ? Math.max(0, 1 - plan.primaryLimit.usedPercent / 100)
    : worstBucket(plan)?.remainingFraction;
  if (left === undefined) {
    const failed = hasFetchProblem(plan);
    return failed ? { text: plan.statusText!, color: C.amber } : { text: "key valid", color: C.gray };
  }
  return {
    text: `${Math.round(left * 100)}% left`,
    resetAt: plan.primaryLimit?.resetAt ?? worstBucket(plan)?.resetTime,
    color: healthColor(left),
  };
}

function renderAccountsTable(state: UsageTabState, width: number): string[] {
  const inner = width - 4;
  const show = pickColumns(inner);
  const columns: Column[] = [{ title: "Provider", width: 20 }];
  if (show.account) columns.push({ title: "Account", width: 18 });
  if (show.plan) columns.push({ title: "Plan", width: 18 });
  columns.push({ title: "Quota", width: 22 }, { title: "Reset", width: 9 }, { title: "Status", width: 9 });

  const header = `  ${columns.map((column) => fit(column.title, column.width - 1) + " ").join("")}`;
  const table = [boxTop("ACCOUNTS", width), boxLine(`${C.bold}${C.gray}${header}${C.reset}`, inner)];

  state.plans.forEach((plan, index) => {
    const selected = index === state.selectedIndex;
    const quota = describeQuota(plan);
    const fraction = plan.balance ? undefined : quota.text.endsWith("left") ? parseInt(quota.text, 10) / 100 : undefined;
    const quotaCell =
      fraction !== undefined
        ? `${renderQuotaBar(fraction, BAR_WIDTH)} ${quota.color}${fit(quota.text, 10)} ${C.reset}`
        : `${quota.color}${fit(quota.text, 21)} ${C.reset}`;
    const badge = isHealthy(plan)
      ? hasFetchProblem(plan) && !plan.balance
        ? `${C.amber}● check${C.reset}`
        : `${C.green}● ok${C.reset}`
      : plan.status === "limited"
        ? `${C.amber}● limited${C.reset}`
        : `${C.red}● ${plan.status}${C.reset}`;

    // Every text cell is one column narrower than its slot so neighbours never touch
    const cells = [`${C.bold}${C.white}${fit(plan.name, 19)} ${C.reset}`];
    if (show.account) cells.push(`${C.gray}${fit(plan.account, 17)} ${C.reset}`);
    if (show.plan) cells.push(`${C.amber}${fit(plan.planType, 17)} ${C.reset}`);
    cells.push(quotaCell, `${C.white}${fit(formatReset(quota.resetAt), 8)} ${C.reset}`, badge);

    const pointer = selected ? `${C.brandCyan}▌${C.reset} ` : "  ";
    let row = clipAnsi(pointer + cells.join(""), inner);
    if (selected) {
      // Re-apply the background after every colour reset so the highlight spans the whole row
      row = C.bgSelected + row.split(C.reset).join(C.reset + C.bgSelected) + " ".repeat(Math.max(0, inner - visibleLength(row))) + C.reset;
    }
    table.push(boxLine(row, inner));
  });

  table.push(boxBottom(width));
  return table;
}

export function renderUsageTab(totalW: number, state: UsageTabState): string[] {
  const { plans } = state;
  const ready = plans.filter(isHealthy).length;
  const watch = plans.filter((p) => p.status === "limited").length;
  const issues = plans.filter(isBroken).length;
  const summary =
    ` ${C.green}● ${ready} ready${C.reset}  ` +
    `${watch ? C.amber : C.darkGray}● ${watch} watch${C.reset}  ` +
    `${issues ? C.red : C.darkGray}● ${issues} issue${C.reset}  ` +
    `${C.darkGray}${plans.length} providers · identities masked${C.reset}`;

  let cards: string[];
  if (totalW >= SIDE_BY_SIDE_MIN_WIDTH) {
    const leftW = Math.floor((totalW - 2) / 2);
    const rightW = totalW - 2 - leftW;
    const [left, right] = closeCards(renderReadinessCard(state, leftW), renderInspectorCard(state, rightW), leftW, rightW);
    cards = zipLinesSideBySide(left, right, leftW, rightW, 2);
  } else {
    // Narrow: the summary line already carries readiness, so only the inspector earns its rows
    const inspector = renderInspectorCard(state, totalW);
    cards = [...inspector, boxBottom(totalW)];
  }

  return [summary, ...cards, ...renderAccountsTable(state, totalW)];
}
