import type { PlanInfo, TokenScope, TokenSnapshot, TimeFilter, TokenTab } from "../types.ts";
import { boxBottom, boxLine, boxTop, clipAnsi, zipLinesSideBySide } from "./box.ts";
import {
  C,
  formatCost,
  formatTokens,
  padToCellWidth,
  renderTokenBar,
  visibleLength,
} from "./theme.ts";
import { renderUsageTab } from "./usage-tab.ts";

export class TokenView {
  private activeTab: TokenTab = "usage"; // Usage tab by default for live plan status!
  private currentScope: TokenScope = "repo";
  private currentTimeFilter: TimeFilter = { mode: "7d", dayOffset: 0, label: "7 Days" };
  private selectedAccountIndex: number = 0;
  private scrollOffset: number = 0;
  private snapshot: TokenSnapshot;
  private isRefreshing = false;
  private readonly done: () => void;
  private readonly getTerminalRows: () => number;
  private readonly onRefresh: (scope: TokenScope, filter: TimeFilter) => Promise<TokenSnapshot>;
  private readonly onUpdate: () => void;

  constructor(options: {
    snapshot: TokenSnapshot;
    done: () => void;
    getTerminalRows: () => number;
    onRefresh: (scope: TokenScope, filter: TimeFilter) => Promise<TokenSnapshot>;
    initialTab?: TokenTab;
    /** Host repaint hook: refresh finishes asynchronously, after handleInput has returned. */
    onUpdate?: () => void;
  }) {
    this.snapshot = options.snapshot;
    this.currentScope = options.snapshot.activeScope;
    this.activeTab = options.initialTab || "usage";
    this.done = options.done;
    this.getTerminalRows = options.getTerminalRows;
    this.onRefresh = options.onRefresh;
    this.onUpdate = options.onUpdate ?? (() => {});
  }

  public invalidate(): void {}

  public async triggerRefresh(): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    this.onUpdate();
    try {
      this.snapshot = await this.onRefresh(this.currentScope, this.currentTimeFilter);
    } catch {
      // keep last good snapshot on failure; the Updated timestamp stays stale
    } finally {
      this.isRefreshing = false;
      this.onUpdate();
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
      const tabs: TokenTab[] = ["usage", "overview", "models", "daily", "hourly", "sessions"];
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

    // 1. Top Header (Authentic Token Header Bar with Pi-Token branding)
    const headerLines = this.renderTokenHeader(totalW);

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

    // 3. Bottom Footer (Token Footer Bar)
    const footerLines = this.renderTokenFooter(totalW);

    // Footer is anchored to the bottom row: body is padded or clipped to fit between header and footer
    const bodyBudget = Math.max(4, termRows - headerLines.length - footerLines.length);
    const body = bodyLines.map((l) => (typeof l === "string" ? l : String(l ?? "")));
    const fitted = body.length > bodyBudget ? body.slice(0, bodyBudget) : [...body, ...new Array(bodyBudget - body.length).fill("")];
    return [...headerLines, ...fitted, ...footerLines];
  }

  /** Authentic Token Header Bar: "┌ pi-token ───────────── [Tabs] ──────────── GitHub ┐" */
  private renderTokenHeader(totalW: number): string[] {
    const tabDefs: { id: TokenTab; label: string; num: string }[] = [
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

  /** Authentic Token Footer Bar: Sorts, navigation shortcuts & totals */
  private renderTokenFooter(totalW: number): string[] {
    const o = this.snapshot.overview;
    const topBorder = `${C.boxBlue}├${"─".repeat(Math.max(0, totalW - 2))}┤${C.reset}`;

    const leftNav = `  ${C.cyan}▲/▼${C.reset} select · ${C.cyan}1..6${C.reset} tab · ${C.cyan}[Tab]${C.reset} cycle · ${C.cyan}[t]${C.reset} period · ${C.cyan}[s]${C.reset} scope · ${C.cyan}[r]${C.reset} refresh · ${C.red}[q]${C.reset} quit`;
    const rightTotals = `${C.amber}${formatCost(o.totalCost)}${C.reset} · ${formatTokens(o.inputTokens + o.outputTokens)} tok · ${o.totalCalls.toLocaleString()} calls  `;
    // Narrow terminals: keep the key hints, drop the totals instead of overflowing the frame
    const fitsTotals = visibleLength(leftNav) + visibleLength(rightTotals) + 4 <= totalW;
    const rightPart = fitsTotals ? rightTotals : "";
    const pad1 = Math.max(0, totalW - visibleLength(leftNav) - visibleLength(rightPart) - 2);
    const line1 = clipAnsi(`${C.boxBlue}│${C.reset}${leftNav}${" ".repeat(pad1)}${rightPart}`, totalW - 1) + `${C.boxBlue}│${C.reset}`;

    const bottomBorder = `${C.boxBlue}└${"─".repeat(Math.max(0, totalW - 2))}┘${C.reset}`;
    return [topBorder, line1, bottomBorder];
  }

  /** 1. Usage tab (see usage-tab.ts) */
  private renderUsageTab(totalW: number): string[] {
    return renderUsageTab(totalW, {
      plans: this.snapshot.plans,
      selectedIndex: this.selectedAccountIndex,
      updatedAt: this.snapshot.timestamp,
      isRefreshing: this.isRefreshing,
    });
  }

  /** 2. Tab 2: Token 2-Column Overview Dashboard */
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
      const bar = renderTokenBar(d.cost / maxDayCost, 8);
      const row = `${d.date.slice(5)} ${bar} ${C.amber}${formatCost(d.cost).padStart(7)}${C.reset} ${C.white}${String(d.calls).padStart(5)}${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxBlue));
    }
    leftColLines.push(boxBottom(colW, C.boxBlue));

    leftColLines.push(boxTop("By Activity", colW, C.boxPurple));
    leftColLines.push(boxLine(`${C.gray}Type              Cost  Turns  1-Shot${C.reset}`, innerColW, C.boxPurple));
    for (const a of o.byActivity) {
      const bar = renderTokenBar(a.turns / (o.totalCalls || 1), 6);
      const row = `${bar} ${C.cyan}${a.name.padEnd(12)}${C.reset} ${C.amber}${formatCost(a.cost).padStart(6)}${C.reset} ${String(a.turns).padStart(5)}  ${a.pct > 0 ? `${C.green}${a.pct}%${C.reset}` : `${C.darkGray}-${C.reset}`}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    leftColLines.push(boxBottom(colW, C.boxPurple));

    leftColLines.push(boxTop("Core Tools", colW, C.boxPink));
    for (const t of o.coreTools) {
      const bar = renderTokenBar(t.calls / (o.totalCalls || 1), 8);
      const row = `${bar} ${C.white}${t.name.padEnd(14)}${C.reset} ${C.brandCyan}${String(t.calls).padStart(6)} calls${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxPink));
    }
    leftColLines.push(boxBottom(colW, C.boxPink));

    const rightColLines: string[] = [];
    rightColLines.push(boxTop("By Project", colW, C.boxGreen));
    rightColLines.push(boxLine(`${C.gray}Workspace / Repo                Cost   Sess${C.reset}`, innerColW, C.boxGreen));
    const maxProjCost = Math.max(...o.byProject.map((p) => p.cost), 1);
    for (const p of o.byProject.slice(0, 5)) {
      const bar = renderTokenBar(p.cost / maxProjCost, 6);
      const name = p.project.length > 20 ? p.project.slice(0, 19) + "…" : p.project;
      const row = `${bar} ${name.padEnd(20)} ${C.amber}${formatCost(p.cost).padStart(7)}${C.reset} ${String(p.sessions).padStart(4)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxGreen));
    }
    rightColLines.push(boxBottom(colW, C.boxGreen));

    rightColLines.push(boxTop("By Model", colW, C.boxPurple));
    rightColLines.push(boxLine(`${C.gray}Model Identifier                Cost  Calls${C.reset}`, innerColW, C.boxPurple));
    const maxModCost = Math.max(...o.byModel.map((m) => m.cost), 1);
    for (const m of o.byModel.slice(0, 5)) {
      const bar = renderTokenBar(m.cost / maxModCost, 6);
      const mName = m.model.length > 20 ? m.model.slice(0, 19) + "…" : m.model;
      const row = `${bar} ${C.cyan}${mName.padEnd(20)}${C.reset} ${C.amber}${formatCost(m.cost).padStart(7)}${C.reset} ${String(m.calls).padStart(5)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxPurple));
    }
    rightColLines.push(boxBottom(colW, C.boxPurple));

    rightColLines.push(boxTop("Shell Commands & Runtimes", colW, C.boxOrange));
    for (const s of o.shellCommands) {
      const bar = renderTokenBar(s.calls / (o.totalCalls || 1), 8);
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
      const bar = renderTokenBar(d.cost / maxCost, 14);

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
      const bar = renderTokenBar(h.cost / maxCost, 24);

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
