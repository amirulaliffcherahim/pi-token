export const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",

  // Base colors
  cyan: "\x1b[38;2;100;210;255m",
  green: "\x1b[38;2;74;222;128m",
  amber: "\x1b[38;2;251;191;36m",
  orange: "\x1b[38;2;249;115;22m",
  red: "\x1b[38;2;248;113;113m",
  purple: "\x1b[38;2;192;132;252m",
  magenta: "\x1b[38;2;244;114;182m",
  blue: "\x1b[38;2;96;165;250m",
  gray: "\x1b[38;2;148;163;184m",
  darkGray: "\x1b[38;2;71;85;105m",
  white: "\x1b[38;2;248;250;252m",

  // TokScale custom palette
  brandOrange: "\x1b[38;2;245;158;11m",
  brandGold: "\x1b[38;2;234;179;8m",
  brandCyan: "\x1b[38;2;56;189;248m",
  brandPurple: "\x1b[38;2;168;85;247m",
  brandPink: "\x1b[38;2;236;72;153m",

  // Box borders
  boxOrange: "\x1b[38;2;249;115;22m",
  boxBlue: "\x1b[38;2;59;130;246m",
  boxGreen: "\x1b[38;2;34;197;94m",
  boxPurple: "\x1b[38;2;168;85;247m",
  boxPink: "\x1b[38;2;236;72;153m",
  boxGray: "\x1b[38;2;71;85;105m",
};

/** Render Tokscale-styled gradient horizontal bar (e.g. ▰▰▰▱▱) */
export function renderGradientBar(ratio: number, width: number = 14): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * width);
  const empty = width - filled;

  const filledChars = "█".repeat(filled);
  const emptyChars = "░".repeat(empty);

  // Gradient tint
  let color = C.cyan;
  if (r > 0.85) color = C.red;
  else if (r > 0.65) color = C.orange;
  else if (r > 0.35) color = C.amber;

  return `${color}${filledChars}${C.darkGray}${emptyChars}${C.reset}`;
}

/** Render TokScale segmented bar (blue -> cyan -> yellow -> orange) */
export function renderTokScaleBar(ratio: number, width: number = 10): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.max(1, Math.round(r * width));
  const empty = Math.max(0, width - filled);

  let bar = "";
  for (let i = 0; i < filled; i++) {
    const pos = i / width;
    if (pos < 0.25) bar += `${C.brandCyan}█`;
    else if (pos < 0.5) bar += `${C.cyan}█`;
    else if (pos < 0.75) bar += `${C.brandGold}█`;
    else bar += `${C.brandOrange}█`;
  }
  bar += `${C.darkGray}${"░".repeat(empty)}${C.reset}`;
  return bar;
}

export function formatTokens(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + "B";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

export function formatCost(cost: number): string {
  if (cost >= 1000) return "$" + cost.toFixed(2);
  if (cost >= 100) return "$" + cost.toFixed(2);
  if (cost >= 10) return "$" + cost.toFixed(2);
  if (cost > 0) return "$" + cost.toFixed(3);
  return "$0.00";
}

export function fitWidth(str: string, width: number): string {
  // Strip ANSI to measure visual width
  const clean = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (clean.length > width) {
    return clean.slice(0, width);
  }
  return str + " ".repeat(width - clean.length);
}
