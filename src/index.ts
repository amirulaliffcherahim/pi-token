import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const handler = async (rawArgs: string, ctx: ExtensionCommandContext) => {
    const { runToken } = await import("./runner.ts");
    await runToken(pi, rawArgs, ctx);
  };

  pi.registerCommand("token", {
    description: "Token on Steroids: Connected Provider Quotas & Real-Time Burn Dashboard",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = (prefix || "").trim().toLowerCase();
      const options = [
        { value: "usage", label: "usage", description: "Connected provider plans & quota windows" },
        { value: "overview", label: "overview", description: "2-Column Token spend & tool activity" },
        { value: "here", label: "here", description: "Show in this terminal instead of a new window" },
        { value: "global", label: "global", description: "Open in Global machine scope" },
      ];
      const matches = options.filter((o) => o.value.startsWith(trimmed));
      return matches.length > 0 ? matches : null;
    },
    handler,
  });

  // Alias /tokens for muscle memory
  pi.registerCommand("tokens", {
    description: "Token on Steroids: Connected Provider Quotas & Real-Time Burn Dashboard",
    handler,
  });
}
