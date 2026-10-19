import type { PlanInfo, TokenScope, TokenSnapshot, TimeFilter, TokenTab } from "../types.ts";
import { boxBottom, boxLine, boxTop, clipAnsi, zipLinesSideBySide } from "./box.ts";
import {
  C,
  formatCost,
  fit,
  formatTokens,
  padToCellWidth,
  renderTokenBar,
  visibleLength,
} from "./theme.ts";
import { renderTable } from "./table.ts";
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
  private readonly onRefresh: (scope: TokenScope, filter: TimeFilter, force?: boolean) => Promise<TokenSnapshot>;
  private readonly onUpdate: () => void;

  constructor(options: {
    snapshot: TokenSnapshot;
    done: () => void;
    getTerminalRows: () => number;
    onRefresh: (scope: TokenScope, filter: TimeFilter, force?: boolean) => Promise<TokenSnapshot>;
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

  public async triggerRefresh(force = false): Promise<void> {
    if (this.isRefreshing) return;
    this.isRefreshing = true;
    this.onUpdate();
    try {
      this.snapshot = await this.onRefresh(this.currentScope, this.currentTimeFilter, force);
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
      this.triggerRefresh(true);
      return;
    }
  }

  public render(width: number): string[] {
    const totalW = Math.max(60, width || 100);
    const termRows = Math.max(16, this.getTerminalRows());

    const headerLines = this.renderTokenHeader(totalW);
    const footerLines = this.renderTokenFooter(totalW);

    let bodyLines: string[] = [];
    switch (this.activeTab) {
      case "usage": bodyLines = this.renderUsageTab(totalW); break;
      case "overview": bodyLines = this.renderOverviewTab(totalW); break;
      case "models": bodyLines = this.renderModelsTab(totalW); break;
      case "daily": bodyLines = this.renderDailyTab(totalW); break;
      case "hourly": bodyLines = this.renderHourlyTab(totalW); break;
      case "sessions": bodyLines = this.renderSessionsTab(totalW); break;
    }

    // Footer is anchored to the bottom row; the body scrolls inside the space between header and footer
    const bodyBudget = Math.max(4, termRows - headerLines.length - footerLines.length);
    const body = bodyLines.map((line) => padToCellWidth(typeof line === "string" ? line : String(line ?? ""), totalW));
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, body.length - bodyBudget)));
    const visible = body.slice(this.scrollOffset, this.scrollOffset + bodyBudget);
    const blank = " ".repeat(totalW);
    while (visible.length < bodyBudget) visible.push(blank);
    const padded = (lines: string[]) => lines.map((line) => padToCellWidth(line, totalW));
    return [...padded(headerLines), ...visible, ...padded(footerLines)];
  }

  /** One-row tab bar (active tab highlighted) plus a rule: saves two rows over a boxed header. */
  private renderTokenHeader(totalW: number): string[] {
    const tabDefs: { id: TokenTab; label: string; num: string }[] = [
      { id: "usage", label: "Usage", num: "1" },
      { id: "overview", label: "Overview", num: "2" },
      { id: "models", label: "Models", num: "3" },
      { id: "daily", label: "Daily", num: "4" },
      { id: "hourly", label: "Hourly", num: "5" },
      { id: "sessions", label: "Sessions", num: "6" },
    ];
    const compact = totalW < 90;
    const tabs = tabDefs
      .map((tab) => {
        const text = compact ? tab.label.slice(0, 5) : tab.label;
        return this.activeTab === tab.id
          ? `${C.bgActive}${C.bold}${C.white} ${tab.num} ${text} ${C.reset}`
          : `${C.darkGray} ${tab.num}${C.reset}${C.gray} ${text} ${C.reset}`;
      })
      .join("");

    const brand = `${C.bold}${C.brandOrange} pi-token ${C.reset}`;
    const scope = this.currentScope === "repo" ? "repo" : "global";
    const right = compact
      ? `${C.amber}${scope}${C.reset} `
      : `${C.purple}${this.currentTimeFilter.label}${C.reset}${C.darkGray} · ${C.reset}${C.amber}${scope}${C.reset} `;
    const gap = Math.max(1, totalW - visibleLength(brand) - visibleLength(tabs) - visibleLength(right));
    const bar = clipAnsi(`${brand}${tabs}${" ".repeat(gap)}${right}`, totalW);
    return [bar, `${C.boxBlue}${"─".repeat(totalW)}${C.reset}`];
  }

  /** Rule + one hint row; totals appear only when they fit. */
  private renderTokenFooter(totalW: number): string[] {
    const o = this.snapshot.overview;
    const key = (k: string) => `${C.cyan}${k}${C.reset}`;
    const hints = totalW < 90
      ? ` ${key("▲▼")} move  ${key("1-6")} tab  ${key("t")} period  ${key("s")} scope  ${key("r")} refresh  ${key("q")} quit`
      : ` ${key("▲▼")} move · ${key("1-6")}/${key("Tab")} tab · ${key("t")} period · ${key("s")} scope · ${key("r")} refresh · ${key("q")} quit`;
    const totals = `${C.amber}${formatCost(o.totalCost)}${C.reset}${C.gray} · ${formatTokens(o.inputTokens + o.outputTokens)} tok · ${o.totalCalls.toLocaleString()} calls ${C.reset}`;
    const fits = visibleLength(hints) + visibleLength(totals) + 2 <= totalW;
    const gap = fits ? totalW - visibleLength(hints) - visibleLength(totals) : 0;
    const line = clipAnsi(`${hints}${" ".repeat(gap)}${fits ? totals : ""}`, totalW);
    return [`${C.boxBlue}${"─".repeat(totalW)}${C.reset}`, line];
  }

  /** 1. Usage tab (see usage-tab.ts) */
  private renderUsageTab(totalW: number): string[] {
    return renderUsageTab(totalW, {
      plans: this.snapshot.plans,
      selectedIndex: this.selectedAccountIndex,
      updatedAt: this.snapshot.timestamp,
      isRefreshing: this.isRefreshing,
      daemon: this.snapshot.daemon,
    });
  }

  /** 2. Tab 2: Token 2-Column Overview Dashboard */
  private renderOverviewTab(totalW: number): string[] {
    const o = this.snapshot.overview;
    const colW = Math.floor((totalW - 2) / 2);
    const innerColW = colW - 4;

    const heroBoxW = totalW;
    const innerHeroW = heroBoxW - 4;
    const heroLines: string[] = [
      boxTop(`Pi-Token ⚡ Overview [ ${o.periodLabel} ]`, heroBoxW, C.boxOrange),
      boxLine(
        `${C.bold}${C.brandGold}${formatCost(o.totalCost)}${C.reset} cost   ${C.bold}${C.white}${o.totalCalls.toLocaleString()}${C.reset} calls   ${C.bold}${C.white}${o.totalSessions}${C.reset} sessions   ${C.bold}${C.green}${o.cacheHitRate}% cache hit${C.reset}   ${C.purple}Burn: $${o.burnVelocityUsdPerHour.toFixed(2)}/hr · ${formatTokens(o.burnVelocityTokensPerMin)} tok/min${C.reset}`,
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
    leftColLines.push(boxLine(`${C.bold}${C.gray}${fit("Date", 5)} ${fit("Spend", 8)} ${"Cost".padStart(7)} ${"Calls".padStart(5)}${C.reset}`, innerColW, C.boxBlue));
    const maxDayCost = Math.max(...o.dailyActivity.map((d) => d.cost), 1);
    for (const d of o.dailyActivity.slice(0, 5)) {
      const bar = renderTokenBar(d.cost / maxDayCost, 8);
      const row = `${d.date.slice(5)} ${bar} ${C.amber}${formatCost(d.cost).padStart(7)}${C.reset} ${C.white}${String(d.calls).padStart(5)}${C.reset}`;
      leftColLines.push(boxLine(row, innerColW, C.boxBlue));
    }
    leftColLines.push(boxBottom(colW, C.boxBlue));

    leftColLines.push(boxTop("By Activity", colW, C.boxPurple));
    leftColLines.push(boxLine(`${C.bold}${C.gray}${fit("", 6)} ${fit("Type", 12)} ${"Cost".padStart(6)} ${"Turns".padStart(5)}  1-Shot${C.reset}`, innerColW, C.boxPurple));
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
    rightColLines.push(boxLine(`${C.bold}${C.gray}${fit("", 6)} ${fit("Project", 20)} ${"Cost".padStart(7)} ${"Sess".padStart(4)}${C.reset}`, innerColW, C.boxGreen));
    const maxProjCost = Math.max(...o.byProject.map((p) => p.cost), 1);
    for (const p of o.byProject.slice(0, 5)) {
      const bar = renderTokenBar(p.cost / maxProjCost, 6);
      const name = p.project.length > 20 ? p.project.slice(0, 19) + "…" : p.project;
      const row = `${bar} ${name.padEnd(20)} ${C.amber}${formatCost(p.cost).padStart(7)}${C.reset} ${String(p.sessions).padStart(4)}`;
      rightColLines.push(boxLine(row, innerColW, C.boxGreen));
    }
    rightColLines.push(boxBottom(colW, C.boxGreen));

    rightColLines.push(boxTop("By Model", colW, C.boxPurple));
    rightColLines.push(boxLine(`${C.bold}${C.gray}${fit("", 6)} ${fit("Model", 20)} ${"Cost".padStart(7)} ${"Calls".padStart(5)}${C.reset}`, innerColW, C.boxPurple));
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
    return [...heroLines, ...gridLines];
  }

  /** 3. Models */
  private renderModelsTab(totalW: number): string[] {
    return renderTable(
      "MODELS",
      [
        { title: "#", width: 2, align: "right", priority: 9, text: (m: any) => String(this.snapshot.overview.detailedModels.indexOf(m) + 1), color: C.darkGray },
        { title: "Model", width: 22, priority: 0, text: (m: any) => m.model, color: C.cyan },
        { title: "Cost", width: 9, align: "right", priority: 1, text: (m: any) => formatCost(m.cost), color: C.amber },
        { title: "Calls", width: 6, align: "right", priority: 2, text: (m: any) => String(m.calls) },
        { title: "Hit%", width: 5, align: "right", priority: 3, text: (m: any) => `${m.cacheHitRate}%`, color: C.green },
        { title: "Provider", width: 10, priority: 4, text: (m: any) => m.provider, color: C.gray },
        { title: "Input", width: 7, align: "right", priority: 5, text: (m: any) => formatTokens(m.inputTokens) },
        { title: "Output", width: 7, align: "right", priority: 6, text: (m: any) => formatTokens(m.outputTokens) },
        { title: "Cached", width: 7, align: "right", priority: 7, text: (m: any) => formatTokens(m.cachedTokens) },
        { title: "Total", width: 7, align: "right", priority: 8, text: (m: any) => formatTokens(m.totalTokens) },
      ],
      this.snapshot.overview.detailedModels,
      totalW,
    );
  }

  /** 4. Daily history */
  private renderDailyTab(totalW: number): string[] {
    const days = this.snapshot.overview.dailyActivity;
    const maxCost = Math.max(...days.map((d) => d.cost), 1);
    return renderTable(
      "DAILY",
      [
        { title: "Date", width: 10, priority: 0, text: (d: any) => d.date },
        { title: "Cost", width: 9, align: "right", priority: 1, text: (d: any) => formatCost(d.cost), color: C.amber },
        { title: "Calls", width: 6, align: "right", priority: 2, text: (d: any) => String(d.calls) },
        { title: "Hit%", width: 5, align: "right", priority: 3, text: (d: any) => `${d.cacheHitRate}%`, color: C.green },
        { title: "Total", width: 7, align: "right", priority: 4, text: (d: any) => formatTokens(d.tokens) },
        { title: "Spend", width: 12, priority: 5, text: (d: any) => "█".repeat(Math.max(d.cost > 0 ? 1 : 0, Math.round((d.cost / maxCost) * 12))), color: C.brandCyan },
        { title: "Input", width: 7, align: "right", priority: 6, text: (d: any) => formatTokens(d.inputTokens) },
        { title: "Output", width: 7, align: "right", priority: 7, text: (d: any) => formatTokens(d.outputTokens) },
      ],
      days,
      totalW,
    );
  }

  /** 5. Hourly profile */
  private renderHourlyTab(totalW: number): string[] {
    const hours = this.snapshot.overview.hourlyActivity;
    const maxCost = Math.max(...hours.map((h) => h.cost), 1);
    return renderTable(
      "HOURLY (UTC)",
      [
        { title: "Hour", width: 5, priority: 0, text: (h: any) => `${h.hour}:00`, color: C.cyan },
        { title: "Cost", width: 9, align: "right", priority: 1, text: (h: any) => formatCost(h.cost), color: C.amber },
        { title: "Calls", width: 6, align: "right", priority: 2, text: (h: any) => String(h.calls) },
        { title: "Burn", width: 24, priority: 3, text: (h: any) => "█".repeat(Math.max(h.cost > 0 ? 1 : 0, Math.round((h.cost / maxCost) * 24))), color: C.brandCyan },
        { title: "Tokens", width: 7, align: "right", priority: 4, text: (h: any) => formatTokens(h.tokens) },
      ],
      hours,
      totalW,
    );
  }

  /** 6. Recent sessions */
  private renderSessionsTab(totalW: number): string[] {
    return renderTable(
      "SESSIONS",
      [
        { title: "Last active", width: 11, priority: 0, text: (s: any) => s.lastActive, color: C.gray },
        { title: "Cost", width: 9, align: "right", priority: 1, text: (s: any) => formatCost(s.cost), color: C.amber },
        { title: "Workspace", width: 22, priority: 2, text: (s: any) => s.workspace },
        { title: "Model", width: 20, priority: 3, text: (s: any) => s.model, color: C.cyan },
        { title: "Calls", width: 6, align: "right", priority: 4, text: (s: any) => String(s.calls) },
        { title: "Session", width: 8, priority: 5, text: (s: any) => s.sessionId.slice(-8), color: C.darkGray },
      ],
      this.snapshot.overview.detailedSessions,
      totalW,
    );
  }
}
