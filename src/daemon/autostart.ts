import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const START_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "start.ts");
const SCRIPT_NAME = "pi-token-daemon.cmd";

/**
 * Per-user Startup folder: no admin, no registry, no scheduled task, visible in Task Manager > Startup apps.
 * PI_TOKEN_STARTUP_DIR lets tests target a temp folder instead of the real one.
 */
function startupDir(): string {
  return process.env.PI_TOKEN_STARTUP_DIR || join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

export function autostartScriptPath(): string {
  return join(startupDir(), SCRIPT_NAME);
}

export function isAutostartEnabled(): boolean {
  return existsSync(autostartScriptPath());
}

export function enableAutostart(): { ok: boolean; message: string } {
  if (process.platform !== "win32" && !process.env.PI_TOKEN_STARTUP_DIR) return { ok: false, message: "autostart is Windows-only" };
  const script = [
    "@echo off",
    "rem pi-token daemon launcher. Remove with: /token-daemon autostart off",
    `"${process.execPath}" --experimental-strip-types --no-warnings "${START_ENTRY}"`,
    "",
  ].join("\r\n");
  try {
    mkdirSync(startupDir(), { recursive: true });
    writeFileSync(autostartScriptPath(), script);
    return { ok: true, message: `enabled (${autostartScriptPath()})` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function disableAutostart(): { ok: boolean; message: string } {
  try {
    rmSync(autostartScriptPath(), { force: true });
    return { ok: true, message: "disabled" };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
