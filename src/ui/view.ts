import type { PlanInfo, PulseScope, PulseSnapshot, TimeFilter } from "../types.js";
import {
  C,
  formatCost,
  formatTokens,
  padToCellWidth,
  renderTokScaleBar,
  visibleLength,
} from "./theme.js";

function boxTop(title: string, width: number, borderColor: string = C.boxOrange): string {
  const t = title ? ` ${title} ` : "";
  const tLen = t.length;
  const rem = Math.max(0, width - tLen - 3);
  return `${borderColor}╭${C.bold}${C.white}${t}${C.reset}${borderColor}${"─".repeat(rem)}╮${C.reset}`;
}

function boxBottom(width: number, borderColor: string = C.boxOrange): string {
  return `${borderColor}╰${"─".repeat(Math.max(0, width - 2))}╯${C.reset}`;
}

function boxLine(content: string, innerWidth: number, borderColor: string = C.boxOrange): string {
  const safeStr = typeof content === "string" ? content : String(content ?? "");
  const vis = visibleLength(safeStr);
  const pad = Math.max(0, innerWidth - vis);
  return `${borderColor}│${C.reset} ${safeStr}${" ".repeat(pad)} ${borderColor}│${C.reset}`;
}

function zipLinesSideBySide(left: string[], right: string[], leftW: number, rightW: number, gap = 2): string[] {
  const maxRows = Math.max(left.length, right.length);
  const out: string[] = [];
  const spaceGap = " ".repeat(gap);

  for (let i = 0; i < maxRows; i++) {
    const l = i < left.length ? left[i] : " ".repeat(leftW);
    const r = i < right.length ? right[i] : " ".repeat(rightW);
    out.push(l + spaceGap + r);
  }
  return out;
}

export class TokScaleView {
  private activeTab: "usage" | "overview" = "usage"; // First tab is Usage Limits by default!
  private currentScope: PulseScope = "repo";
  private currentTimeFilter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
  private selectedAccountIndex: number = 0;
  private maskEmails: boolean = true;
  private snapshot: PulseSnapshot;
  private isRefreshing = false;
  private readonly done: () => void;
  private readonly getTerminalRows: () => number;
  private readonly onRefresh: (scope: PulseScope, filter: TimeFilter) => Promise<PulseSnapshot>;

  constructor(options: {
    snapshot: PulseSnapshot;
    done: () => void;
    getTerminalRows: () => number;
    onRefresh: (scope: PulseScope, filter: TimeFilter) => Promise<PulseSnapshot>;
    initialTab?: "usage" | "overview";
  }) {
    this.snapshot = options.snapshot;
    this.currentScope = options.snapshot.activeScope;
    this.activeTab = options.initialTab || "usage";
    this.done = options.done;
    this.getTerminalRows = options.getTerminalRows;
    this.onRefresh = options.onRefresh;
  }

  public invalidate(): void {}

  private async triggerRefresh(): Promise<void> {
    this.isRefreshing = true;
    try {
      this.snapshot = await this.onRefresh(this.currentScope, this.currentTimeFilter);
    } finally {
      this.isRefreshing = false;
    }
  }

  public handleInput(data: string): void {
    // Escape or q or Ctrl+C
    if (data === "q" || data === "Q" || data === "\x1b" || data === "\x03") {
      this.done();
      return;
    }

    // Up / Down arrow navigation for accounts table
    if (data === "\x1b[A" || data === "k") {
      if (this.selectedAccountIndex > 0) {
        this.selectedAccountIndex--;
      }
      return;
    }
    if (data === "\x1b[B" || data === "j") {
      const maxIdx = Math.max(0, this.snapshot.plans.length - 1);
      if (this.selectedAccountIndex < maxIdx) {
        this.selectedAccountIndex++;
      }
      return;
    }

    // Tab switching: [1] Usage, [2] Overview / Tokscale
    if (data === "1" || data === "\t") {
      this.activeTab = this.activeTab === "usage" ? "overview" : "usage";
      return;
    }
    if (data === "2") {
      this.activeTab = "overview";
      return;
    }

    // Scope toggle: [s]
    if (data === "s" || data === "S") {
      this.currentScope = this.currentScope === "repo" ? "global" : "repo";
      this.triggerRefresh();
      return;
    }

    // Email mask toggle: [e]
    if (data === "e" || data === "E") {
      this.maskEmails = !this.maskEmails;
      return;
    }

    // Time filter cycling: [t]
    if (data === "t" || data === "T") {
      if (this.currentTimeFilter.mode === "day") {
        this.currentTimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
      } else if (this.currentTimeFilter.mode === "7d") {
        this.currentTimeFilter = { mode: "30d", dayOffset: 0, label: "30 Days" };
      } else if (this.currentTimeFilter.mode === "30d") {
        this.currentTimeFilter = { mode: "all", dayOffset: 0, label: "All-Time" };
      } else {
        this.currentTimeFilter = { mode: "day", dayOffset: 0, label: "Today" };
      }
      this.triggerRefresh();
      return;
    }

    // Manual reload: [r]
    if (data === "r" || data === "R") {
      this.triggerRefresh();
      return;
    }
  }

  public render(width: number): string[] {
    const totalW = Math.max(88, Math.min(width || 100, 140));

    // Top Navigation & Filter Bar
    const navBar = this.renderTopNavBar(totalW);

    let bodyLines: string[] = [];
    if (this.activeTab === "usage") {
      bodyLines = this.renderUsageLimitsTab(totalW);
    } else {
      bodyLines = this.renderTokScaleOverviewTab(totalW);
    }

    // Help Footer Bar
    const footer = this.renderFooter(totalW);

    // Ensure EVERY line returned is strictly a string (preventing uncaughtException in paintBox)
    const result = [...navBar, "", ...bodyLines, "", footer];
    return result.map((l) => (typeof l === "string" ? l : String(l ?? "")));
  }

  /** Render top tabs and time selectors */
  private renderTopNavBar(totalW: number): string[] {
    const tab1 = this.activeTab === "usage"
      ? `${C.bold}${C.brandOrange}● 1. USAGE LIMITS${C.reset}`
      : `${C.gray}○ 1. Usage Limits${C.reset}`;

    const tab2 = this.activeTab === "overview"
      ? `${C.bold}${C.brandCyan}● 2. TOKSCALE OVERVIEW${C.reset}`
      : `${C.gray}○ 2. TokScale Overview${C.reset}`;

    const scopeBadge = this.currentScope === "repo"
      ? `${C.amber}[Scope: ${C.bold}Workspace${C.reset}${C.amber}]${C.reset}`
      : `${C.cyan}[Scope: ${C.bold}Global Machine${C.reset}${C.cyan}]${C.reset}`;

    const filterBadge = `${C.purple}[t] Period: ${C.bold}${this.currentTimeFilter.label}${C.reset}`;

    const left = `  ${tab1}    ${tab2}`;
    const right = `${scopeBadge}   ${filterBadge}  `;
    const space = Math.max(2, totalW - visibleLength(left) - visibleLength(right));

    return [left + " ".repeat(space) + right];
  }

  /** 1. Tab 1: TokScale Structured Usage Tab (Summary + Inspector + Accounts Table) */
  private renderUsageLimitsTab(totalW: number): string[] {
    const plans = this.snapshot.plans;
    const colW = Math.floor((totalW - 4) / 2);
    const innerColW = colW - 4;

    // 1. One-line snapshot status header (always visible)
    const readyCount = plans.filter((p) => p.status === "active").length;
    const watchCount = plans.filter((p) => p.status === "limited").length;
    const emailState = this.maskEmails ? "emails masked" : "emails visible";
    const snapshotText = `  ${C.bold}Usage Snapshot:${C.reset} ${C.green}● ${readyCount} Ready${C.reset} · ${watchCount > 0 ? `${C.amber}● ${watchCount} Watch` : `${C.darkGray}0 Watch`}${C.reset} · ${plans.length} Providers · ${C.gray}[e] ${emailState}${C.reset}`;

    // 2. Left Card: Overall System Readiness & Reset Countdown
    const leftLines: string[] = [];
    leftLines.push(boxTop("SYSTEM READINESS", colW, C.boxBlue));

    const overallState = watchCount > 0 ? `${C.amber}● WATCH (1 or more limited)${C.reset}` : `${C.green}● READY (Normal operation)${C.reset}`;
    leftLines.push(boxLine(`State:     ${overallState}`, innerColW, C.boxBlue));

    const activeProvider = plans[0]?.name || "None";
    leftLines.push(boxLine(`Primary:   ${C.bold}${C.white}${activeProvider}${C.reset} (Auto-detected in auth.json)`, innerColW, C.boxBlue));

    leftLines.push(boxLine(`Capacity:  ${C.green}${readyCount} ready${C.reset} · ${watchCount} watch · ${plans.length} total`, innerColW, C.boxBlue));

    // Next nearest reset time
    let nextReset = "No active resets pending";
    for (const p of plans) {
      if (p.primaryLimit?.resetAt) {
        nextReset = `${p.primaryLimit.resetAt.toLocaleTimeString()} (${p.name})`;
        break;
      }
    }
    leftLines.push(boxLine(`Next Reset:${C.amber} ${nextReset}${C.reset}`, innerColW, C.boxBlue));
    leftLines.push(boxLine(`Action:    ${C.cyan}Ready for subagent & heavy tasks${C.reset}`, innerColW, C.boxBlue));
    leftLines.push(boxBottom(colW, C.boxBlue));

    // 3. Right Card: Selected Account Deep-Dive Inspector
    const selected = plans[this.selectedAccountIndex] || plans[0];
    const rightLines: string[] = [];
    rightLines.push(boxTop(`INSPECTOR: ${selected ? selected.name.toUpperCase() : "NO ACCOUNT"}`, colW, C.boxPurple));

    if (!selected) {
      rightLines.push(boxLine(`${C.darkGray}No provider selected${C.reset}`, innerColW, C.boxPurple));
    } else {
      const acct = this.maskEmails ? selected.account : (selected.account || "Account");
      rightLines.push(boxLine(`Account:   ${C.white}${acct}${C.reset} · ${C.amber}${selected.planType}${C.reset}`, innerColW, C.boxPurple));

      if (selected.balance) {
        const bal = selected.balance;
        rightLines.push(boxLine(`Balance:   ${C.bold}${C.green}$${bal.totalBalance.toFixed(2)} USD${C.reset}  (Granted: $${(bal.grantedBalance || 0).toFixed(2)})`, innerColW, C.boxPurple));
        rightLines.push(boxLine(`Top-up:    $${(bal.toppedUpBalance || 0).toFixed(2)} USD available`, innerColW, C.boxPurple));
      } else if (selected.quotaGroups && selected.quotaGroups.length > 0) {
        for (const g of selected.quotaGroups) {
          for (const b of g.buckets.slice(0, 3)) {
            const remPct = Math.round(b.remainingFraction * 100);
            const bar = renderTokScaleBar(b.remainingFraction, 10);
            const label = b.name.padEnd(16);
            rightLines.push(boxLine(`├─ ${label} ${bar} ${C.white}${remPct}% left${C.reset}`, innerColW, C.boxPurple));
          }
        }
      } else if (selected.primaryLimit) {
        const remPct = Math.max(0, 100 - selected.primaryLimit.usedPercent);
        const bar = renderTokScaleBar(remPct / 100, 14);
        rightLines.push(boxLine(`Window:    ${bar} ${C.white}${remPct.toFixed(0)}% left${C.reset}`, innerColW, C.boxPurple));
        rightLines.push(boxLine(`Status:    ${selected.statusText || "Active"}`, innerColW, C.boxPurple));
      } else {
        rightLines.push(boxLine(`Status:    ${C.green}● ${selected.statusText || "Active & Connected"}${C.reset}`, innerColW, C.boxPurple));
        rightLines.push(boxLine(`Type:      Fast Compliance / API Gate`, innerColW, C.boxPurple));
      }
    }
    rightLines.push(boxBottom(colW, C.boxPurple));

    const topCards = zipLinesSideBySide(leftLines, rightLines, colW, colW, 2);

    // 4. Bottom Table: Full Accounts & Providers Matrix
    const tableW = totalW - 2;
    const innerTableW = tableW - 4;
    const tableLines: string[] = [];

    tableLines.push(boxTop("ACCOUNTS & PROVIDERS TABLE (Use [↑]/[↓] to select)", tableW, C.boxOrange));
    tableLines.push(boxLine(`${C.gray}  Provider           Account             Plan                   Primary Limit / Quota         Status${C.reset}`, innerTableW, C.boxOrange));

    for (let i = 0; i < plans.length; i++) {
      const p = plans[i];
      const isSelected = i === this.selectedAccountIndex;
      const pointer = isSelected ? `${C.brandOrange}▸${C.reset}` : " ";
      const prov = padToCellWidth(p.name, 17);
      const acct = padToCellWidth(this.maskEmails ? p.account : (p.account || "Account"), 18);
      const plan = padToCellWidth(p.planType, 21);

      let quotaCol = "                      ";
      if (p.balance) {
        quotaCol = padToCellWidth(`${C.green}$${p.balance.totalBalance.toFixed(2)} USD Balance${C.reset}`, 22);
      } else if (p.primaryLimit) {
        const rem = Math.max(0, 100 - p.primaryLimit.usedPercent);
        const bar = renderTokScaleBar(rem / 100, 8);
        quotaCol = `${bar} ${rem.toFixed(0)}% left     `;
      } else if (p.quotaGroups?.[0]?.buckets?.[0]) {
        const b = p.quotaGroups[0].buckets[0];
        const rem = Math.round(b.remainingFraction * 100);
        const bar = renderTokScaleBar(b.remainingFraction, 8);
        quotaCol = `${bar} ${rem}% left      `;
      } else {
        quotaCol = padToCellWidth(`Ready (${p.id})`, 22);
      }

      const statusBadge = p.status === "active" ? `${C.green}● Active${C.reset}` : `${C.amber}● Watch${C.reset}`;
      const row = `${pointer} ${isSelected ? C.bold : ""}${prov}${acct}${plan}${quotaCol} ${statusBadge}`;
      tableLines.push(boxLine(row, innerTableW, C.boxOrange));
    }
    tableLines.push(boxBottom(tableW, C.boxOrange));

    return [snapshotText, "", ...topCards, "", ...tableLines];
  }

  /** 2. Tab 2: TokScale 2-Column Dashboard */
  private renderTokScaleOverviewTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const colW = Math.floor((totalW - 4) / 2);
    const innerColW = colW - 4;

    // Header summary card (Hero)
    const heroBoxW = totalW - 2;
    const innerHeroW = heroBoxW - 4;
    const heroLines: string[] = [
      boxTop(`CodeBurn ⚡ Tokscale [ ${o.periodLabel} ]`, heroBoxW, C.boxOrange),
      boxLine(
        `${C.bold}${C.brandGold}${formatCost(o.totalCost)}${C.reset} cost   ${C.bold}${C.white}${o.totalCalls.toLocaleString()}${C.reset} calls   ${C.bold}${C.white}${o.totalSessions}${C.reset} sessions   ${C.bold}${C.green}${o.cacheHitRate}% cache hit${C.reset}   ${C.purple}Burn: $${o.burnVelocityUsdPerHour.toFixed(2)}/hr · ${o.burnVelocityTokensPerMin} tok/min${C.reset}`,
        innerHeroW,
        C.boxOrange
      ),
      boxLine(
        `${C.gray}${formatTokens(o.inputTokens)} in   ${formatTokens(o.outputTokens)} out   ${formatTokens(o.cachedTokens)} cached   ${formatTokens(o.writtenTokens)} written${C.reset}`,
        innerHeroW,
        C.boxOrange
      ),
      boxBottom(heroBoxW, C.boxOrange),
    ];

    // Left Column: Daily Activity + By Activity + Core Tools
    const leftColLines: string[] = [];

    // Box 1: Daily Activity
    leftColLines.push(boxTop("Daily Activity", colW, C.boxBlue));
    leftColLines.push(boxLine(`${C.gray}Date       Tokens       Cost    Calls${C.reset}`, innerColW, C.boxBlue));
    const maxDayCost = Math.max(...o.dailyActivity.map((d) => d.cost), 1);
    for (const d of o.dailyActivity) {
      const bar = renderTokScaleBar(d.cost / maxDayCost, 8);
      const row = `${d.date} ${bar} ${C.amber}${formatCost(d.cost).padStart(7)}${C.reset} ${C.white}${String(d.calls).padStart(5)}${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxBlue));
    }
    leftColLines.push(boxBottom(colW, C.boxBlue));

    // Box 2: By Activity
    leftColLines.push(boxTop("By Activity", colW, C.boxPurple));
    leftColLines.push(boxLine(`${C.gray}Type              Cost  Turns  1-Shot${C.reset}`, innerColW, C.boxPurple));
    for (const a of o.byActivity) {
      const bar = renderTokScaleBar(a.turns / (o.totalCalls || 1), 6);
      const row = `${bar} ${C.cyan}${a.name.padEnd(12)}${C.reset} ${C.amber}${formatCost(a.cost).padStart(6)}${C.reset} ${String(a.turns).padStart(5)}  ${a.pct > 0 ? `${C.green}${a.pct}%${C.reset}` : `${C.darkGray}-${C.reset}`}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    leftColLines.push(boxBottom(colW, C.boxPurple));

    // Box 3: Core Tools
    leftColLines.push(boxTop("Core Tools", colW, C.boxPink));
    for (const t of o.coreTools) {
      const bar = renderTokScaleBar(t.calls / (o.totalCalls || 1), 8);
      const row = `${bar} ${C.white}${t.name.padEnd(14)}${C.reset} ${C.brandCyan}${String(t.calls).padStart(6)} calls${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPink));
    }
    leftColLines.push(boxBottom(colW, C.boxPink));

    // Right Column: By Project + By Model + Shell Commands
    const rightColLines: string[] = [];

    // Box 4: By Project
    rightColLines.push(boxTop("By Project", colW, C.boxGreen));
    rightColLines.push(boxLine(`${C.gray}Workspace / Repo                Cost   Sess${C.reset}`, innerColW, C.boxGreen));
    const maxProjCost = Math.max(...o.byProject.map((p) => p.cost), 1);
    for (const p of o.byProject) {
      const bar = renderTokScaleBar(p.cost / maxProjCost, 6);
      const name = p.project.length > 20 ? p.project.slice(0, 19) + "…" : p.project;
      const row = `${bar} ${name.padEnd(20)} ${C.amber}${formatCost(p.cost).padStart(7)}${C.reset} ${String(p.sessions).padStart(4)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxGreen));
    }
    rightColLines.push(boxBottom(colW, C.boxGreen));

    // Box 5: By Model
    rightColLines.push(boxTop("By Model", colW, C.boxPurple));
    rightColLines.push(boxLine(`${C.gray}Model Identifier                Cost  Calls${C.reset}`, innerColW, C.boxPurple));
    const maxModCost = Math.max(...o.byModel.map((m) => m.cost), 1);
    for (const m of o.byModel) {
      const bar = renderTokScaleBar(m.cost / maxModCost, 6);
      const mName = m.model.length > 20 ? m.model.slice(0, 19) + "…" : m.model;
      const row = `${bar} ${C.cyan}${mName.padEnd(20)}${C.reset} ${C.amber}${formatCost(m.cost).padStart(7)}${C.reset} ${String(m.calls).padStart(5)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    rightColLines.push(boxBottom(colW, C.boxPurple));

    // Box 6: Shell Commands
    rightColLines.push(boxTop("Shell Commands & Runtimes", colW, C.boxOrange));
    for (const s of o.shellCommands) {
      const bar = renderTokScaleBar(s.calls / (o.totalCalls || 1), 8);
      const row = `${bar} ${C.white}${s.name.padEnd(16)}${C.reset} ${C.brandGold}${String(s.calls).padStart(6)} calls${C.reset}`;
      rightColLines.push(boxLine(row, innerColW, C.boxOrange));
    }
    rightColLines.push(boxBottom(colW, C.boxOrange));

    // Combine 2 Columns
    const gridLines = zipLinesSideBySide(leftColLines, rightColLines, colW, colW, 2);

    return [...heroLines, "", ...gridLines];
  }

  /** Render bottom hotkey footer */
  private renderFooter(totalW: number): string[] {
    const keys = `  ${C.amber}[↑/↓]${C.reset} Select Account   ${C.amber}[1]${C.reset} Usage   ${C.cyan}[2]${C.reset} TokScale   ${C.purple}[t]${C.reset} Period   ${C.green}[s]${C.reset} Scope   ${C.gray}[e]${C.reset} Mask   ${C.white}[r]${C.reset} Refresh   ${C.red}[q/Esc]${C.reset} Exit`;
    return [keys];
  }
}
