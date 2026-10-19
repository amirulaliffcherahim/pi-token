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
  gray: "\x1b[38;2;176;190;210m",
  darkGray: "\x1b[38;2;110;125;150m",
  white: "\x1b[38;2;248;250;252m",

  // Token custom palette
  brandOrange: "\x1b[38;2;245;158;11m",
  brandGold: "\x1b[38;2;234;179;8m",
  brandCyan: "\x1b[38;2;56;189;248m",
  brandPurple: "\x1b[38;2;168;85;247m",
  brandPink: "\x1b[38;2;236;72;153m",

  // One quiet border colour for every box: colour is reserved for data, not chrome
  boxOrange: "[38;2;100;116;139m",
  boxBlue: "[38;2;100;116;139m",
  boxGreen: "[38;2;100;116;139m",
  boxPurple: "[38;2;100;116;139m",
  boxPink: "[38;2;100;116;139m",
  boxGray: "[38;2;71;85;105m",

  // Surfaces
  bgActive: "[48;2;30;64;110m",
  bgSelected: "[48;2;30;41;59m",
};

/** Render Token segmented bar (blue -> cyan -> yellow -> orange) */
export function renderTokenBar(ratio: number, width: number = 10): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.max(0, Math.round(r * width));
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

/** Robust visible width measurement without ANSI escape sequences */
export function visibleLength(str: unknown): number {
  if (typeof str !== "string") return 0;
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length;
}

export function padToCellWidth(str: string, width: number): string {
  const vis = visibleLength(str);
  if (vis >= width) return str;
  return str + " ".repeat(width - vis);
}

/** Plain-text fit: truncate with ellipsis or pad. Call BEFORE adding colour codes. */
export function fit(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length > width) return width > 1 ? text.slice(0, width - 1) + "…" : text.slice(0, width);
  return text + " ".repeat(width - text.length);
}

/** Health colour for a remaining fraction: green > 50%, amber 25-50%, red < 25%. */
export function healthColor(remainingFraction: number): string {
  if (remainingFraction > 0.5) return C.green;
  if (remainingFraction > 0.25) return C.amber;
  return C.red;
}

/** Quota bar: colour follows health (not position); empty track stays visible. */
export function renderQuotaBar(remainingFraction: number, width: number = 12): string {
  const r = Math.max(0, Math.min(1, remainingFraction));
  const filled = Math.round(r * width);
  return `${healthColor(r)}${"█".repeat(filled)}${C.darkGray}${"░".repeat(width - filled)}${C.reset}`;
}

/** "2h 15m" / "3d 4h" / "now" from an ISO timestamp; "—" when absent. */
export function formatReset(iso?: string | Date): string {
  if (!iso) return "—";
  const ts = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  const mins = Math.round((ts - Date.now()) / 60_000);
  if (mins <= 0) return "now";
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
