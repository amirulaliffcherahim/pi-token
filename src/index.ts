import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("token", {
    description: "pi-token: provider quotas, credit and spend dashboard (opens in its own window)",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = (prefix || "").trim().toLowerCase();
      const options = [
        { value: "usage", label: "usage", description: "Connected provider plans & quota windows" },
        { value: "overview", label: "overview", description: "Spend & tool activity" },
        { value: "here", label: "here", description: "Show in this terminal instead of a new window" },
        { value: "global", label: "global", description: "Open in Global machine scope" },
      ];
      const matches = options.filter((option) => option.value.startsWith(trimmed));
      return matches.length > 0 ? matches : null;
    },
    handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
      const { runToken } = await import("./runner.ts");
      await runToken(pi, rawArgs, ctx);
    },
  });

  pi.registerCommand("token-daemon", {
    description: "pi-token background observer: status (active/inactive). Also: start | stop | restart | autostart-on|autostart-off",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = (prefix || "").trim().toLowerCase();
      const options = ["start", "stop", "restart", "autostart", "autostart-on", "autostart-off"].map((value) => ({ value, label: value, description: `${value} the observer` }));
      const matches = options.filter((option) => option.value.startsWith(trimmed));
      return matches.length > 0 ? matches : null;
    },
    handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
      const { runDaemonCommand } = await import("./daemon-command.ts");
      runDaemonCommand(rawArgs, ctx);
    },
  });
}
