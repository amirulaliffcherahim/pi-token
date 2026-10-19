import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PlanInfo, PulseScope, PulseSnapshot, TimeFilter } from "../types.js";
import {
  C,
  fitWidth,
  formatCost,
  formatTokens,
  renderGradientBar,
  renderTokScaleBar,
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
  const vis = visibleWidth(content);
  const pad = Math.max(0, innerWidth - vis);
  return `${borderColor}│${C.reset} ${content}${" ".repeat(pad)} ${borderColor}│${C.reset}`;
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
  private activeTab: "limits" | "overview" = "limits"; // First tab is Limits by default!
  private currentScope: PulseScope = "repo";
  private currentTimeFilter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
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
    initialTab?: "limits" | "overview";
  }) {
    this.snapshot = options.snapshot;
    this.currentScope = options.snapshot.activeScope;
    this.activeTab = options.initialTab || "limits"; // Limits by default
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

    // Tab switching: [1] Limits, [2] Overview / Tokscale
    if (data === "1" || data === "\t") {
      this.activeTab = this.activeTab === "limits" ? "overview" : "limits";
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
    const totalW = Math.max(88, Math.min(width || 100, 140));

    // Top Navigation & Filter Bar
    const navBar = this.renderTopNavBar(totalW);

    let bodyLines: string[] = [];
    if (this.activeTab === "limits") {
      bodyLines = this.renderLimitsTab(totalW);
    } else {
      bodyLines = this.renderTokScaleOverviewTab(totalW);
    }

    // Help Footer Bar
    const footer = this.renderFooter(totalW);

    return [...navBar, "", ...bodyLines, "", footer];
  }

  /** Render top tabs and time selectors */
  private renderTopNavBar(totalW: number): string[] {
    const tab1 = this.activeTab === "limits"
      ? `${C.bold}${C.brandOrange}● 1. USAGE LIMITS & PLANS${C.reset}`
      : `${C.gray}○ 1. Limits${C.reset}`;

    const tab2 = this.activeTab === "overview"
      ? `${C.bold}${C.brandCyan}● 2. TOKSCALE OVERVIEW${C.reset}`
      : `${C.gray}○ 2. Overview${C.reset}`;

    const scopeBadge = this.currentScope === "repo"
      ? `${C.amber}[Workspace Scope: ${C.bold}Current Project${C.reset}${C.amber}]${C.reset}`
      : `${C.cyan}[Scope: ${C.bold}Global Machine${C.reset}${C.cyan}]${C.reset}`;

    const filterBadge = `${C.purple}[t] Period: ${C.bold}${this.currentTimeFilter.label}${C.reset}`;

    const left = `  ${tab1}    ${tab2}`;
    const right = `${scopeBadge}   ${filterBadge}  `;
    const space = Math.max(2, totalW - visibleWidth(left) - visibleWidth(right));

    return [left + " ".repeat(space) + right];
  }

  /** 1. First Tab: Connected Provider Limits & Quotas */
  private renderLimitsTab(totalW: number): string[] {
    const lines: string[] = [];
    const plans = this.snapshot.plans;

    const boxW = totalW - 2;
    const innerW = boxW - 4;

    lines.push(boxTop("CONNECTED PROVIDER LIMITS & QUOTA MONITOR", boxW, C.boxOrange));

    if (plans.length === 0) {
      lines.push(boxLine(`${C.darkGray}No provider credentials found in ~/.pi/agent/auth.json${C.reset}`, innerW, C.boxOrange));
    } else {
      for (const p of plans) {
        lines.push(boxLine(`${C.bold}${C.cyan}${p.name}${C.reset}  ${C.gray}(${p.account})${C.reset} · ${C.amber}${p.planType}${C.reset} · ${p.status === "active" ? `${C.green}● Active` : `${C.amber}● ${p.statusText}`}${C.reset}`, innerW, C.boxOrange));

        // Primary Session window / Used percent
        if (p.primaryLimit) {
          const remPct = Math.max(0, 100 - p.primaryLimit.usedPercent);
          const bar = renderTokScaleBar(remPct / 100, 20);
          const resetStr = p.primaryLimit.resetAt ? ` · resets ${p.primaryLimit.resetAt.toLocaleTimeString()}` : "";
          lines.push(boxLine(`  Primary Window:  ${bar} ${C.white}${remPct.toFixed(1)}% left${C.reset} (${p.primaryLimit.usedPercent}% used)${resetStr}`, innerW, C.boxOrange));
        }

        // Quotas / Models
        if (p.quotaGroups) {
          for (const g of p.quotaGroups) {
            for (const b of g.buckets) {
              const remPct = Math.round(b.remainingFraction * 100);
              const bar = renderTokScaleBar(b.remainingFraction, 16);
              const namePadded = b.name.padEnd(24);
              const resetStr = b.resetTime ? ` · resets in ${b.resetTime.slice(11, 16)}` : "";
              lines.push(boxLine(`    ${C.gray}├─${C.reset} ${namePadded} ${bar} ${C.white}${remPct}% left${C.reset}${resetStr}`, innerW, C.boxOrange));
            }
          }
        }

        // DeepSeek Balance
        if (p.balance) {
          const bal = p.balance;
          lines.push(boxLine(`    ${C.green}💰 Balance:${C.reset}  ${C.bold}$${bal.totalBalance.toFixed(2)} USD${C.reset}  (Granted: $${(bal.grantedBalance || 0).toFixed(2)} · Topped: $${(bal.toppedUpBalance || 0).toFixed(2)})`, innerW, C.boxOrange));
        }

        lines.push(boxLine(`${C.darkGray}${"─".repeat(innerW)}${C.reset}`, innerW, C.boxOrange));
      }
    }

    lines.push(boxBottom(boxW, C.boxOrange));
    return lines;
  }

  /** 2. Second Tab: TokScale on Steroids 2-Column Dashboard */
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
      const name = truncateToWidth(p.project, 20);
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
      const mName = truncateToWidth(m.model, 20);
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
    const keys = `  ${C.amber}[1]${C.reset} Limits   ${C.cyan}[2]${C.reset} TokScale   ${C.purple}[t]${C.reset} Period   ${C.green}[s]${C.reset} Scope   ${C.white}[r]${C.reset} Refresh   ${C.red}[q/Esc]${C.reset} Exit`;
    return [keys];
  }
}
