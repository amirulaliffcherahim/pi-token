import type { PlanInfo, PulseScope, PulseSnapshot, TimeFilter, TokScaleTab } from "../types.js";
import {
  C,
  formatCost,
  formatTokens,
  padToCellWidth,
  renderTokScaleBar,
  visibleLength,
} from "./theme.js";

function boxTop(title: string, width: number, borderColor: string = C.boxBlue): string {
  const t = title ? ` ${title} ` : "";
  const tLen = t.length;
  const rem = Math.max(0, width - tLen - 3);
  return `${borderColor}┌${C.bold}${C.white}${t}${C.reset}${borderColor}${"─".repeat(rem)}┐${C.reset}`;
}

function boxBottom(width: number, borderColor: string = C.boxBlue): string {
  return `${borderColor}└${"─".repeat(Math.max(0, width - 2))}┘${C.reset}`;
}

function boxLine(content: string, innerWidth: number, borderColor: string = C.boxBlue): string {
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
  private activeTab: TokScaleTab = "usage"; // Usage tab by default for live plan status!
  private currentScope: PulseScope = "repo";
  private currentTimeFilter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
  private selectedAccountIndex: number = 0;
  private scrollOffset: number = 0;
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
    initialTab?: TokScaleTab;
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
    // Exit: q or Esc or Ctrl+C
    if (data === "q" || data === "Q" || data === "\x1b" || data === "\x03") {
      this.done();
      return;
    }

    // Direct tab jumps: 1=Usage, 2=Overview, 3=Models, 4=Daily, 5=Hourly, 6=Sessions
    if (data === "1") { this.activeTab = "usage"; this.scrollOffset = 0; return; }
    if (data === "2") { this.activeTab = "overview"; this.scrollOffset = 0; return; }
    if (data === "3") { this.activeTab = "models"; this.scrollOffset = 0; return; }
    if (data === "4") { this.activeTab = "daily"; this.scrollOffset = 0; return; }
    if (data === "5") { this.activeTab = "hourly"; this.scrollOffset = 0; return; }
    if (data === "6") { this.activeTab = "sessions"; this.scrollOffset = 0; return; }

    // Cycle tabs with Tab / Backtab
    if (data === "\t") {
      const tabs: TokScaleTab[] = ["usage", "overview", "models", "daily", "hourly", "sessions"];
      const nextIdx = (tabs.indexOf(this.activeTab) + 1) % tabs.length;
      this.activeTab = tabs[nextIdx];
      this.scrollOffset = 0;
      return;
    }

    // Up / Down navigation
    if (data === "\x1b[A" || data === "k") {
      if (this.activeTab === "usage") {
        if (this.selectedAccountIndex > 0) this.selectedAccountIndex--;
      } else {
        this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      }
      return;
    }
    if (data === "\x1b[B" || data === "j") {
      if (this.activeTab === "usage") {
        const maxIdx = Math.max(0, this.snapshot.plans.length - 1);
        if (this.selectedAccountIndex < maxIdx) this.selectedAccountIndex++;
      } else {
        this.scrollOffset++;
      }
      return;
    }

    // Scope toggle: [s]
    if (data === "s" || data === "S") {
      this.currentScope = this.currentScope === "repo" ? "global" : "repo";
      this.triggerRefresh();
      return;
    }

    // Email / Secret Mask toggle: [e]
    if (data === "e" || data === "E") {
      this.maskEmails = !this.maskEmails;
      return;
    }

    // Time filter cycling: [t] (Today -> 7 Days -> 30 Days -> All-Time)
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
    const totalW = Math.max(90, width || 100);
    const termRows = Math.max(26, this.getTerminalRows());

    // 1. Top Header (Authentic TokScale Header Bar with Pi-Token branding)
    const headerLines = this.renderTokScaleHeader(totalW);

    // 2. Active Tab Content
    let bodyLines: string[] = [];
    switch (this.activeTab) {
      case "usage":
        bodyLines = this.renderUsageTab(totalW);
        break;
      case "overview":
        bodyLines = this.renderOverviewTab(totalW);
        break;
      case "models":
        bodyLines = this.renderModelsTab(totalW);
        break;
      case "daily":
        bodyLines = this.renderDailyTab(totalW);
        break;
      case "hourly":
        bodyLines = this.renderHourlyTab(totalW);
        break;
      case "sessions":
        bodyLines = this.renderSessionsTab(totalW);
        break;
    }

    // 3. Bottom Footer (TokScale Footer Bar)
    const footerLines = this.renderTokScaleFooter(totalW);

    // Full screen assembly
    const rendered = [...headerLines, ...bodyLines, ...footerLines];
    const stringLines = rendered.map((l) => (typeof l === "string" ? l : String(l ?? "")));

    // Fill remaining terminal lines with blank rows to fully paint the screen
    if (stringLines.length < termRows) {
      const padding = new Array(termRows - stringLines.length).fill("");
      return [...stringLines, ...padding];
    }
    return stringLines.slice(0, termRows);
  }

  /** Authentic TokScale Header Bar: "┌ pi-token ───────────── [Tabs] ──────────── GitHub ┐" */
  private renderTokScaleHeader(totalW: number): string[] {
    const tabDefs: { id: TokScaleTab; label: string; num: string }[] = [
      { id: "usage", label: "Usage", num: "1" },
      { id: "overview", label: "Overview", num: "2" },
      { id: "models", label: "Models", num: "3" },
      { id: "daily", label: "Daily", num: "4" },
      { id: "hourly", label: "Hourly", num: "5" },
      { id: "sessions", label: "Sessions", num: "6" },
    ];

    const tabSegments = tabDefs.map((t) => {
      const active = this.activeTab === t.id;
      if (active) {
        return `${C.bold}${C.brandCyan}${t.label}${C.reset}`;
      }
      return `${C.gray}${t.label}${C.reset}`;
    }).join(` ${C.darkGray}│${C.reset} `);

    const title = `${C.bold}${C.brandOrange} pi-token ${C.reset}`;
    const leftPart = `${C.boxBlue}┌${title}${C.boxBlue}`;
    const rightTag = `${C.gray}v1.0.0 · ${this.currentScope === "repo" ? "Workspace" : "Global"}${C.boxBlue}┐${C.reset}`;

    const remTop = Math.max(0, totalW - visibleLength(title) - visibleLength(rightTag) - 1);
    const topLine = `${leftPart}${"─".repeat(remTop)}${rightTag}`;

    const tabLineContent = `  ${tabSegments}`;
    const scopeLabel = `${C.purple}[t] ${this.currentTimeFilter.label}${C.reset}  ${C.amber}[s] ${this.currentScope.toUpperCase()}${C.reset}`;
    const padMid = Math.max(2, totalW - visibleLength(tabLineContent) - visibleLength(scopeLabel) - 4);
    const midLine = `${C.boxBlue}│${C.reset}${tabLineContent}${" ".repeat(padMid)}${scopeLabel}  ${C.boxBlue}│${C.reset}`;

    const botLine = `${C.boxBlue}├${"─".repeat(Math.max(0, totalW - 2))}┤${C.reset}`;

    return [topLine, midLine, botLine];
  }

  /** Authentic TokScale Footer Bar: Sorts, navigation shortcuts & totals */
  private renderTokScaleFooter(totalW: number): string[] {
    const o = this.snapshot.overview;
    const topBorder = `${C.boxBlue}├${"─".repeat(Math.max(0, totalW - 2))}┤${C.reset}`;

    const leftNav = `  ${C.cyan}▲/▼${C.reset} select · ${C.cyan}1..6${C.reset} tab · ${C.cyan}[Tab]${C.reset} cycle · ${C.cyan}[t]${C.reset} period · ${C.cyan}[s]${C.reset} scope · ${C.cyan}[e]${C.reset} mask · ${C.cyan}[r]${C.reset} refresh · ${C.red}[q]${C.reset} quit`;
    const rightTotals = `${C.amber}${formatCost(o.totalCost)}${C.reset} · ${formatTokens(o.inputTokens + o.outputTokens)} tok · ${o.totalCalls.toLocaleString()} calls  `;
    const pad1 = Math.max(2, totalW - visibleLength(leftNav) - visibleLength(rightTotals) - 2);
    const line1 = `${C.boxBlue}│${C.reset}${leftNav}${" ".repeat(pad1)}${rightTotals}${C.boxBlue}│${C.reset}`;

    const bottomBorder = `${C.boxBlue}└${"─".repeat(Math.max(0, totalW - 2))}┘${C.reset}`;
    return [topBorder, line1, bottomBorder];
  }

  /** 1. Tab 1: Authentic TokScale Usage Tab (Readiness + Inspector + Accounts Table) */
  private renderUsageTab(totalW: number): string[] {
    const plans = this.snapshot.plans;
    const colW = Math.floor((totalW - 6) / 2);
    const innerColW = colW - 4;

    const readyCount = plans.filter((p) => p.status === "active").length;
    const watchCount = plans.filter((p) => p.status === "limited").length;
    const emailState = this.maskEmails ? "hidden" : "visible";
    const snapshotText = `  ${C.bold}Usage Snapshot:${C.reset} ${C.green}● ${readyCount} Ready${C.reset} · ${watchCount > 0 ? `${C.amber}● ${watchCount} Watch` : `${C.darkGray}0 Watch`}${C.reset} · ${plans.length} Providers · ${C.gray}[e] ${emailState}${C.reset}`;

    // Left Card: Overall System Readiness
    const leftLines: string[] = [];
    leftLines.push(boxTop("SYSTEM READINESS", colW, C.boxBlue));
    const overallState = watchCount > 0 ? `${C.amber}● WATCH (limits reached)${C.reset}` : `${C.green}● READY (Normal operation)${C.reset}`;
    leftLines.push(boxLine(`State:     ${overallState}`, innerColW, C.boxBlue));
    const activeProvider = plans[0]?.name || "None";
    leftLines.push(boxLine(`Primary:   ${C.bold}${C.white}${activeProvider}${C.reset} (Auto-detected in auth.json)`, innerColW, C.boxBlue));
    leftLines.push(boxLine(`Capacity:  ${C.green}${readyCount} ready${C.reset} · ${watchCount} watch · ${plans.length} total`, innerColW, C.boxBlue));

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

    // Right Card: Selected Account Inspector
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
        rightLines.push(boxLine(`Balance:   ${C.bold}${C.green}$${bal.totalBalance.toFixed(2)} USD${C.reset} (Granted: $${(bal.grantedBalance || 0).toFixed(2)})`, innerColW, C.boxPurple));
        rightLines.push(boxLine(`Top-up:    $${(bal.toppedUpBalance || 0).toFixed(2)} USD available credit`, innerColW, C.boxPurple));
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

    // Bottom Table: Full Accounts & Providers Matrix
    const tableW = totalW - 2;
    const innerTableW = tableW - 4;
    const tableLines: string[] = [];

    tableLines.push(boxTop("ACCOUNTS & PROVIDERS TABLE (Use ▲/▼ to select)", tableW, C.boxOrange));
    tableLines.push(boxLine(`${C.gray}  Provider           Account             Plan                   Primary Limit / Balance       Status${C.reset}`, innerTableW, C.boxOrange));

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

  /** 2. Tab 2: TokScale 2-Column Overview Dashboard */
  private renderOverviewTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const colW = Math.floor((totalW - 6) / 2);
    const innerColW = colW - 4;

    const heroBoxW = totalW - 2;
    const innerHeroW = heroBoxW - 4;
    const heroLines: string[] = [
      boxTop(`Pi-Token ⚡ Overview [ ${o.periodLabel} ]`, heroBoxW, C.boxOrange),
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

    const leftColLines: string[] = [];
    leftColLines.push(boxTop("Daily Activity", colW, C.boxBlue));
    leftColLines.push(boxLine(`${C.gray}Date       Tokens       Cost    Calls${C.reset}`, innerColW, C.boxBlue));
    const maxDayCost = Math.max(...o.dailyActivity.map((d) => d.cost), 1);
    for (const d of o.dailyActivity.slice(0, 5)) {
      const bar = renderTokScaleBar(d.cost / maxDayCost, 8);
      const row = `${d.date.slice(5)} ${bar} ${C.amber}${formatCost(d.cost).padStart(7)}${C.reset} ${C.white}${String(d.calls).padStart(5)}${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxBlue));
    }
    leftColLines.push(boxBottom(colW, C.boxBlue));

    leftColLines.push(boxTop("By Activity", colW, C.boxPurple));
    leftColLines.push(boxLine(`${C.gray}Type              Cost  Turns  1-Shot${C.reset}`, innerColW, C.boxPurple));
    for (const a of o.byActivity) {
      const bar = renderTokScaleBar(a.turns / (o.totalCalls || 1), 6);
      const row = `${bar} ${C.cyan}${a.name.padEnd(12)}${C.reset} ${C.amber}${formatCost(a.cost).padStart(6)}${C.reset} ${String(a.turns).padStart(5)}  ${a.pct > 0 ? `${C.green}${a.pct}%${C.reset}` : `${C.darkGray}-${C.reset}`}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    leftColLines.push(boxBottom(colW, C.boxPurple));

    leftColLines.push(boxTop("Core Tools", colW, C.boxPink));
    for (const t of o.coreTools) {
      const bar = renderTokScaleBar(t.calls / (o.totalCalls || 1), 8);
      const row = `${bar} ${C.white}${t.name.padEnd(14)}${C.reset} ${C.brandCyan}${String(t.calls).padStart(6)} calls${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPink));
    }
    leftColLines.push(boxBottom(colW, C.boxPink));

    const rightColLines: string[] = [];
    rightColLines.push(boxTop("By Project", colW, C.boxGreen));
    rightColLines.push(boxLine(`${C.gray}Workspace / Repo                Cost   Sess${C.reset}`, innerColW, C.boxGreen));
    const maxProjCost = Math.max(...o.byProject.map((p) => p.cost), 1);
    for (const p of o.byProject.slice(0, 5)) {
      const bar = renderTokScaleBar(p.cost / maxProjCost, 6);
      const name = p.project.length > 20 ? p.project.slice(0, 19) + "…" : p.project;
      const row = `${bar} ${name.padEnd(20)} ${C.amber}${formatCost(p.cost).padStart(7)}${C.reset} ${String(p.sessions).padStart(4)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxGreen));
    }
    rightColLines.push(boxBottom(colW, C.boxGreen));

    rightColLines.push(boxTop("By Model", colW, C.boxPurple));
    rightColLines.push(boxLine(`${C.gray}Model Identifier                Cost  Calls${C.reset}`, innerColW, C.boxPurple));
    const maxModCost = Math.max(...o.byModel.map((m) => m.cost), 1);
    for (const m of o.byModel.slice(0, 5)) {
      const bar = renderTokScaleBar(m.cost / maxModCost, 6);
      const mName = m.model.length > 20 ? m.model.slice(0, 19) + "…" : m.model;
      const row = `${bar} ${C.cyan}${mName.padEnd(20)}${C.reset} ${C.amber}${formatCost(m.cost).padStart(7)}${C.reset} ${String(m.calls).padStart(5)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    rightColLines.push(boxBottom(colW, C.boxPurple));

    rightColLines.push(boxTop("Shell Commands & Runtimes", colW, C.boxOrange));
    for (const s of o.shellCommands) {
      const bar = renderTokScaleBar(s.calls / (o.totalCalls || 1), 8);
      const row = `${bar} ${s.name.padEnd(16)} ${C.brandGold}${String(s.calls).padStart(6)} calls${C.reset}`;
      rightColLines.push(boxLine(row, innerColW, C.boxOrange));
    }
    rightColLines.push(boxBottom(colW, C.boxOrange));

    const gridLines = zipLinesSideBySide(leftColLines, rightColLines, colW, colW, 2);
    return [...heroLines, "", ...gridLines];
  }

  /** 3. Tab 3: Detailed Models Comparison */
  private renderModelsTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const boxW = totalW - 2;
    const innerW = boxW - 4;
    const lines: string[] = [];

    lines.push(boxTop("PI-TOKEN MODELS TELEMETRY & SPEND BREAKDOWN", boxW, C.boxPurple));
    lines.push(boxLine(`${C.gray}Rank  Model Identifier         Provider     Input       Output      Cached      Total Tok    Hit %   Calls     Total Cost${C.reset}`, innerW, C.boxPurple));

    for (let i = 0; i < o.detailedModels.length; i++) {
      const m = o.detailedModels[i];
      const rank = String(i + 1).padStart(2);
      const mName = padToCellWidth(m.model.length > 22 ? m.model.slice(0, 21) + "…" : m.model, 23);
      const prov = padToCellWidth(m.provider, 12);
      const inp = padToCellWidth(formatTokens(m.inputTokens), 11);
      const out = padToCellWidth(formatTokens(m.outputTokens), 11);
      const cr = padToCellWidth(formatTokens(m.cachedTokens), 11);
      const tot = padToCellWidth(formatTokens(m.totalTokens), 12);
      const hit = padToCellWidth(`${m.cacheHitRate}%`, 7);
      const calls = padToCellWidth(String(m.calls), 9);
      const cost = `${C.bold}${C.amber}${formatCost(m.cost).padStart(10)}${C.reset}`;

      const row = `${C.gray}${rank}${C.reset}    ${C.cyan}${mName}${C.white}${prov}${inp}${out}${cr}${tot}${hit}${calls}${cost}`;
      lines.push(boxLine(row, innerW, C.boxPurple));
    }

    lines.push(boxBottom(boxW, C.boxPurple));
    return lines;
  }

  /** 4. Tab 4: Daily History */
  private renderDailyTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const boxW = totalW - 2;
    const innerW = boxW - 4;
    const lines: string[] = [];

    lines.push(boxTop("PI-TOKEN DAILY CONSUMPTION & SPEND HISTORY", boxW, C.boxBlue));
    lines.push(boxLine(`${C.gray}Date         Calls    Input       Output      Cached       Total Tok     Hit %    Cost (USD)     Daily Ratio${C.reset}`, innerW, C.boxBlue));

    const maxCost = Math.max(...o.dailyActivity.map((d) => d.cost), 1);
    for (const d of o.dailyActivity) {
      const dt = padToCellWidth(d.date, 12);
      const calls = padToCellWidth(String(d.calls), 8);
      const inp = padToCellWidth(formatTokens(d.inputTokens), 11);
      const out = padToCellWidth(formatTokens(d.outputTokens), 11);
      const cr = padToCellWidth(formatTokens(d.tokens - d.inputTokens - d.outputTokens), 12);
      const tot = padToCellWidth(formatTokens(d.tokens), 13);
      const hit = padToCellWidth(`${d.cacheHitRate}%`, 8);
      const cost = padToCellWidth(formatCost(d.cost), 14);
      const bar = renderTokScaleBar(d.cost / maxCost, 14);

      const row = `${C.white}${dt}${C.reset}${calls}${inp}${out}${cr}${tot}${hit}${C.amber}${cost}${C.reset}${bar}`;
      lines.push(boxLine(row, innerW, C.boxBlue));
    }

    lines.push(boxBottom(boxW, C.boxBlue));
    return lines;
  }

  /** 5. Tab 5: Hourly Diurnal Profile */
  private renderHourlyTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const boxW = totalW - 2;
    const innerW = boxW - 4;
    const lines: string[] = [];

    lines.push(boxTop("PI-TOKEN 24-HOUR HOURLY DIURNAL VELOCITY", boxW, C.boxGreen));
    lines.push(boxLine(`${C.gray}Hour (UTC)    Calls       Tokens         Cost (USD)    Relative Burn Velocity${C.reset}`, innerW, C.boxGreen));

    const maxCost = Math.max(...o.hourlyActivity.map((h) => h.cost), 1);
    for (const h of o.hourlyActivity) {
      const hr = padToCellWidth(`${h.hour}:00`, 13);
      const calls = padToCellWidth(String(h.calls), 11);
      const tok = padToCellWidth(formatTokens(h.tokens), 14);
      const cost = padToCellWidth(formatCost(h.cost), 13);
      const bar = renderTokScaleBar(h.cost / maxCost, 24);

      const row = `${C.cyan}${hr}${C.reset}${calls}${tok}${C.amber}${cost}${C.reset}${bar}`;
      lines.push(boxLine(row, innerW, C.boxGreen));
    }

    lines.push(boxBottom(boxW, C.boxGreen));
    return lines;
  }

  /** 6. Tab 6: Live Sessions Ledger */
  private renderSessionsTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const boxW = totalW - 2;
    const innerW = boxW - 4;
    const lines: string[] = [];

    lines.push(boxTop("PI-TOKEN LIVE RECENT SESSIONS LEDGER", boxW, C.boxOrange));
    lines.push(boxLine(`${C.gray}Last Active      Session UUID                           Workspace             Model                 Calls   Cost${C.reset}`, innerW, C.boxOrange));

    for (const s of o.detailedSessions) {
      const act = padToCellWidth(s.lastActive, 16);
      const uuid = padToCellWidth(s.sessionId, 38);
      const ws = padToCellWidth(s.workspace, 21);
      const mdl = padToCellWidth(s.model, 21);
      const calls = padToCellWidth(String(s.calls), 7);
      const cost = `${C.bold}${C.amber}${formatCost(s.cost).padStart(8)}${C.reset}`;

      const row = `${C.gray}${act}${C.reset}${C.cyan}${uuid}${C.white}${ws}${mdl}${calls}${cost}`;
      lines.push(boxLine(row, innerW, C.boxOrange));
    }

    lines.push(boxBottom(boxW, C.boxOrange));
    return lines;
  }
}
