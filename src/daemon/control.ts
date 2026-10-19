import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deleteState, getState, setState } from "../data/db.ts";
import type { DaemonStatus } from "../types.ts";

const MAIN_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "main.ts");

/** The daemon beats every 30s; three missed beats means it is gone even if the pid was reused. */
export const HEARTBEAT_STALE_MS = 90_000;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getDaemonStatus(): DaemonStatus {
  const pid = Number(getState("daemon_pid") ?? 0);
  const heartbeat = Number(getState("daemon_heartbeat") ?? 0);
  const alive = pid > 0 && Date.now() - heartbeat < HEARTBEAT_STALE_MS && isProcessAlive(pid);
  if (!alive) return { isRunning: false, eventsProcessed: Number(getState("daemon_events") ?? 0) };

  return {
    isRunning: true,
    pid,
    startedAt: new Date(Number(getState("daemon_started_at") ?? heartbeat)),
    lastHeartbeat: new Date(heartbeat),
    eventsProcessed: Number(getState("daemon_events") ?? 0),
  };
}

/** Detached and hidden: it keeps running after Pi and the dashboard close. Only started on explicit request, never at login. */
export function startDaemon(): { ok: boolean; message: string } {
  const status = getDaemonStatus();
  if (status.isRunning) return { ok: true, message: `already running (pid ${status.pid})` };
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", MAIN_ENTRY], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => {});
    child.unref();
    return { ok: true, message: `started (pid ${child.pid})` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function stopDaemon(): { ok: boolean; message: string } {
  const status = getDaemonStatus();
  if (!status.isRunning || !status.pid) return { ok: true, message: "not running" };
  try {
    process.kill(status.pid, "SIGTERM");
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  // SIGTERM is a hard kill on Windows, so the daemon cannot clean up after itself.
  for (const key of ["daemon_pid", "daemon_heartbeat", "daemon_started_at"]) deleteState(key);
  return { ok: true, message: `stopped (pid ${status.pid})` };
}

export function recordHeartbeat(pid: number, startedAt: number, eventsProcessed: number): void {
  setState("daemon_pid", String(pid));
  setState("daemon_started_at", String(startedAt));
  setState("daemon_heartbeat", String(Date.now()));
  setState("daemon_events", String(eventsProcessed));
}
