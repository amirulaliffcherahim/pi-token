// Tiny launcher used by the Startup-folder script: start the detached daemon, then exit immediately.
import { startDaemon } from "./control.ts";

const result = startDaemon();
if (!result.ok) process.exit(1);
