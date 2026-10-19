import type { PlanInfo } from "../types.ts";
import { boxBottom, boxLine, boxTop, zipLinesSideBySide } from "./box.ts";
import { C, fit, formatReset, renderQuotaBar } from "./theme.ts";

export interface UsageTabState {
  plans: PlanInfo[];
  selectedIndex: number;
  updatedAt: Date;
  isRefreshing: boolean;
}

/** Nearest future reset across every windowed metric: answers "when does capacity come back?" */
function findNextReset(plans: PlanInfo[]): { provider: string; at: number } | undefined {
  let best: { provider: string; at: number } | undefined;
  for (const plan of plans) {
    const candidates: Array<string | Date | undefined> = [
      plan.primaryLimit?.resetAt,
      ...(plan.quotaGroups ?? []).flatMap((group) => group.buckets.map((bucket) => bucket.resetTime)),
    ];
    for (const candidate of candidates) {
      const at = candidate instanceof Date ? candidate.getTime() : candidate ? Date.parse(candidate) : NaN;
      if (Number.isFinite(at) && at > Date.now() && (!best || at < best.at)) best = { provider: plan.name, at };
    }
  }
  return best;
}

/** Lowest-remaining metric of a plan: the number that actually blocks you first. */
function worstBucket(plan: PlanInfo) {
  const buckets = plan.quotaGroups?.flatMap((group) => group.buckets) ?? [];
  if (buckets.length === 0) return undefined;
  return buckets.reduce((worst, bucket) => (bucket.remainingFraction < worst.remainingFraction ? bucket : worst));
}

function renderReadinessCard(state: UsageTabState, colW: number): string[] {
  const inner = colW - 4;
  const { plans } = state;
  const ready = plans.filter((p) => p.status === "active").length;
  const watch = plans.filter((p) => p.status === "limited").length;
  const issues = plans.filter((p) => p.status === "error" || p.status === "offline").length;
  const next = findNextReset(plans);
  const overall = issues ? `${C.red}● ATTENTION` : watch ? `${C.amber}● WATCH` : `${C.green}● READY`;

  const card = [boxTop("READINESS", colW, C.boxBlue)];
  card.push(boxLine(`${C.gray}State      ${C.reset}${overall}${C.reset}`, inner, C.boxBlue));
  card.push(boxLine(`${C.gray}Capacity   ${C.reset}${C.green}${ready} ready${C.reset} · ${watch} watch · ${issues} issue`, inner, C.boxBlue));
  card.push(
    boxLine(
      `${C.gray}Next reset ${C.reset}${C.amber}${next ? formatReset(new Date(next.at)) : "—"}${C.reset}${next ? `${C.gray} · ${next.provider}${C.reset}` : ""}`,
      inner,
      C.boxBlue,
    ),
  );
  card.push(boxLine(`${C.gray}Sources    ${C.reset}auth.json (auto-detected)`, inner, C.boxBlue));
  card.push(
    boxLine(
      `${C.gray}Updated    ${C.reset}${state.updatedAt.toLocaleTimeString()}${state.isRefreshing ? `  ${C.amber}⟳ refreshing${C.reset}` : ""}`,
      inner,
      C.boxBlue,
    ),
  );
  return card;
}

function renderInspectorCard(state: UsageTabState, colW: number): string[] {
  const inner = colW - 4;
  const selected = state.plans[state.selectedIndex] ?? state.plans[0];
  const card = [boxTop(`INSPECTOR · ${selected ? selected.name : "none"}`, colW, C.boxPurple)];

  if (!selected) {
    card.push(boxLine(`${C.gray}No provider connected. Add one with /login.${C.reset}`, inner, C.boxPurple));
    return card;
  }

  card.push(boxLine(`${C.gray}Account ${C.reset}${selected.account} · ${C.amber}${selected.planType}${C.reset}`, inner, C.boxPurple));

  if (selected.balance) {
    const balance = selected.balance;
    card.push(boxLine(`${C.gray}Credit  ${C.reset}${C.bold}${C.green}$${balance.totalBalance.toFixed(2)} ${balance.currency}${C.reset}`, inner, C.boxPurple));
    card.push(
      boxLine(
        `${C.gray}Granted ${C.reset}$${(balance.grantedBalance ?? 0).toFixed(2)}  ${C.gray}Topped up ${C.reset}$${(balance.toppedUpBalance ?? 0).toFixed(2)}`,
        inner,
        C.boxPurple,
      ),
    );
  }

  for (const group of selected.quotaGroups ?? []) {
    for (const bucket of group.buckets) {
      const pct = `${Math.round(bucket.remainingFraction * 100)}%`;
      card.push(
        boxLine(
          `${C.white}${fit(bucket.name, 22)}${C.reset} ${renderQuotaBar(bucket.remainingFraction, 12)} ${fit(pct, 4)} ${C.gray}resets ${formatReset(bucket.resetTime)}${C.reset}`,
          inner,
          C.boxPurple,
        ),
      );
    }
  }

  if (!selected.balance && !selected.quotaGroups?.length) {
    card.push(boxLine(`${C.gray}Status  ${C.reset}${selected.statusText ?? selected.status}`, inner, C.boxPurple));
  }
  return card;
}

/** Pad the shorter card just above its bottom border so both end on the same row. */
function equalizeHeights(left: string[], right: string[], leftW: number, rightW: number): [string[], string[]] {
  const rows = Math.max(left.length, right.length);
  const pad = (card: string[], color: string, colW: number): string[] => {
    const body = card.slice();
    while (body.length < rows) body.push(boxLine("", colW - 4, color));
    body.push(boxBottom(colW, color));
    return body;
  };
  return [pad(left, C.boxBlue, leftW), pad(right, C.boxPurple, rightW)];
}

function renderAccountsTable(state: UsageTabState, totalW: number): string[] {
  const tableW = totalW;
  const inner = tableW - 4;
  const wProvider = 20;
  const wAccount = 20;
  const wPlan = 22;
  const wQuota = 26;
  const wReset = 10;

  const table = [boxTop("ACCOUNTS  (▲/▼ select)", tableW, C.boxOrange)];
  table.push(
    boxLine(
      `${C.gray}  ${fit("Provider", wProvider)}${fit("Account", wAccount)}${fit("Plan", wPlan)}${fit("Quota / Credit", wQuota)}${fit("Reset", wReset)}Status${C.reset}`,
      inner,
      C.boxOrange,
    ),
  );

  state.plans.forEach((plan, index) => {
    const selected = index === state.selectedIndex;
    const pointer = selected ? `${C.brandOrange}▶${C.reset} ` : "  ";
    const weight = selected ? C.bold : "";

    let quota: string;
    let resetAt: string | Date | undefined;
    const worst = worstBucket(plan);
    if (plan.balance) {
      quota = `${C.green}${fit(`$${plan.balance.totalBalance.toFixed(2)} ${plan.balance.currency} credit`, wQuota)}${C.reset}`;
    } else if (plan.primaryLimit) {
      const left = Math.max(0, 1 - plan.primaryLimit.usedPercent / 100);
      quota = `${renderQuotaBar(left, 12)} ${fit(`${Math.round(left * 100)}% left`, wQuota - 13)}`;
      resetAt = plan.primaryLimit.resetAt;
    } else if (worst) {
      quota = `${renderQuotaBar(worst.remainingFraction, 12)} ${fit(`${Math.round(worst.remainingFraction * 100)}% left`, wQuota - 13)}`;
      resetAt = worst.resetTime;
    } else {
      quota = `${C.gray}${fit("key valid", wQuota)}${C.reset}`;
    }

    const badge =
      plan.status === "active"
        ? `${C.green}● ok${C.reset}`
        : plan.status === "limited"
          ? `${C.amber}● limited${C.reset}`
          : `${C.red}● ${plan.status}${C.reset}`;

    const row =
      `${pointer}${weight}${C.white}${fit(plan.name, wProvider)}${C.reset}` +
      `${weight}${C.gray}${fit(plan.account, wAccount)}${C.reset}` +
      `${weight}${fit(plan.planType, wPlan)}${C.reset}` +
      `${quota}${C.gray}${fit(formatReset(resetAt), wReset)}${C.reset}${badge}`;
    table.push(boxLine(row, inner, C.boxOrange));
  });

  table.push(boxBottom(tableW, C.boxOrange));
  return table;
}

export function renderUsageTab(totalW: number, state: UsageTabState): string[] {
  const stacked = totalW < 110;
  const leftW = stacked ? totalW : Math.floor((totalW - 2) / 2);
  const rightW = stacked ? totalW : totalW - 2 - leftW;

  const [left, right] = equalizeHeights(renderReadinessCard(state, leftW), renderInspectorCard(state, rightW), leftW, rightW);
  const cards = stacked ? [...left, ...right] : zipLinesSideBySide(left, right, leftW, rightW, 2);

  const { plans } = state;
  const ready = plans.filter((p) => p.status === "active").length;
  const watch = plans.filter((p) => p.status === "limited").length;
  const issues = plans.filter((p) => p.status === "error" || p.status === "offline").length;
  const summary =
    `  ${C.bold}${C.white}Usage${C.reset}  ${C.green}● ${ready} ready${C.reset}  ` +
    `${watch ? C.amber : C.gray}● ${watch} watch${C.reset}  ${issues ? C.red : C.gray}● ${issues} issue${C.reset}  ` +
    `${C.gray}${plans.length} providers · identities masked${C.reset}`;

  return [summary, "", ...cards, "", ...renderAccountsTable(state, totalW)];
}
