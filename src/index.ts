import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const handler = async (rawArgs: string, ctx: ExtensionCommandContext) => {
    const { runPulse } = await import("./runner.js");
    await runPulse(pi, rawArgs, ctx);
  };

  pi.registerCommand("limit", {
    description: "TokScale on Steroids: Auto-detects Connected Provider Quotas & Real-Time Burn Dashboard",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = (prefix || "").trim().toLowerCase();
      const options = [
        { value: "plans", label: "plans", description: "Connected provider plans & reset windows" },
        { value: "overview", label: "overview", description: "2-Column TokScale spend & tool activity" },
        { value: "global", label: "global", description: "Open in Global machine scope" },
      ];
      const matches = options.filter((o) => o.value.startsWith(trimmed));
      return matches.length > 0 ? matches : null;
    },
    handler,
  });

  // Also register /limits for muscle memory
  pi.registerCommand("limits", {
    description: "TokScale on Steroids: Auto-detects Connected Provider Quotas & Real-Time Burn Dashboard",
    handler,
  });
}
