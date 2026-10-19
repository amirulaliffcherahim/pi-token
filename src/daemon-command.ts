import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon/control.ts";

function describeStatus(): string {
  const status = getDaemonStatus();
  if (!status.isRunning) return "pi-token daemon: inactive (/token-daemon start)";
  const beatSeconds = status.lastHeartbeat ? Math.round((Date.now() - status.lastHeartbeat.getTime()) / 1000) : 0;
  return `pi-token daemon: active · pid ${status.pid} · last beat ${beatSeconds}s ago · ${status.eventsProcessed} events indexed`;
}

/** /token-daemon → status only. start/stop/restart are explicit so nothing runs in the background unasked. */
export function runDaemonCommand(rawArgs: string, ctx: ExtensionCommandContext): void {
  const action = (rawArgs || "").trim().toLowerCase();
  if (action === "stop" || action === "restart") {
    const result = stopDaemon();
    if (!result.ok) return ctx.ui.notify(`pi-token daemon: ${result.message}`, "error");
  }
  if (action === "start" || action === "restart") {
    const result = startDaemon();
    if (!result.ok) return ctx.ui.notify(`pi-token daemon: ${result.message}`, "error");
    return ctx.ui.notify(`pi-token daemon: ${result.message}`, "info");
  }
  if (action === "stop") return ctx.ui.notify("pi-token daemon: stopped", "info");
  ctx.ui.notify(describeStatus(), getDaemonStatus().isRunning ? "info" : "warning");
}
