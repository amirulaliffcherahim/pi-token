// Background observer. Started by `/token-daemon start`; runs detached with no window.
//   node --experimental-strip-types src/daemon/main.ts
// Every tick: index new session lines into token.db, refresh provider quotas, write a heartbeat.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, getDb } from "../data/db.ts";
import { fetchAllPlans } from "../data/plans.ts";
import { loadCachedPlans, mergeWithPrevious, savePlans } from "../data/plan-store.ts";
import { syncSessionsIncremental } from "../data/sync.ts";
import { getDaemonStatus, recordHeartbeat } from "./control.ts";

const TICK_MS = 30_000;
const PLAN_REFRESH_MS = 60_000;
const LOG_MAX_BYTES = 256 * 1024;

const logPath = join(getDataDir(), "daemon.log");

/** Hidden process has no console, so errors go to a size-capped file. Messages carry no tokens (identities are masked upstream). */
function log(message: string): void {
  try {
    mkdirSync(getDataDir(), { recursive: true });
    if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) renameSync(logPath, `${logPath}.old`);
    appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging must never take the daemon down
  }
}

async function main(): Promise<void> {
  getDb();
  const existing = getDaemonStatus();
  if (existing.isRunning && existing.pid !== process.pid) {
    log(`exit: another daemon is already running (pid ${existing.pid})`);
    return;
  }

  const startedAt = Date.now();
  let eventsProcessed = 0;
  let lastPlanRefresh = 0;
  log(`start pid ${process.pid}`);

  const tick = async () => {
    try {
      eventsProcessed += await syncSessionsIncremental();
      if (Date.now() - lastPlanRefresh >= PLAN_REFRESH_MS) {
        const previous = loadCachedPlans(Number.MAX_SAFE_INTEGER) ?? [];
        savePlans(mergeWithPrevious(await fetchAllPlans(), previous));
        lastPlanRefresh = Date.now();
      }
    } catch (error) {
      log(`tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    recordHeartbeat(process.pid, startedAt, eventsProcessed);
  };

  process.on("uncaughtException", (error) => log(`uncaught: ${error.message}`));
  process.on("unhandledRejection", (reason) => log(`unhandled: ${String(reason)}`));

  await tick();
  setInterval(() => void tick(), TICK_MS);
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
