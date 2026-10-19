import { C, visibleLength } from "./theme.ts";

export function boxTop(title: string, width: number, borderColor: string = C.boxBlue): string {
  const label = title ? ` ${title} ` : "";
  const rule = Math.max(0, width - label.length - 2);
  return `${borderColor}┌${C.bold}${C.brandCyan}${label}${C.reset}${borderColor}${"─".repeat(rule)}┐${C.reset}`;
}

export function boxBottom(width: number, borderColor: string = C.boxBlue): string {
  return `${borderColor}└${"─".repeat(Math.max(0, width - 2))}┘${C.reset}`;
}

/** Clip to a visible width while keeping ANSI colour sequences intact. */
export function clipAnsi(text: string, width: number): string {
  if (visibleLength(text) <= width) return text;
  let out = "";
  let visible = 0;
  for (const part of text.split(/([[0-9;]*[a-zA-Z])/)) {
    if (part.startsWith("[")) { out += part; continue; }
    const room = width - 1 - visible;
    if (room <= 0) break;
    out += part.slice(0, room);
    visible += Math.min(part.length, room);
  }
  return `${out}…${C.reset}`;
}

export function boxLine(content: string, innerWidth: number, borderColor: string = C.boxBlue): string {
  const text = clipAnsi(typeof content === "string" ? content : String(content ?? ""), innerWidth);
  const pad = Math.max(0, innerWidth - visibleLength(text));
  return `${borderColor}│${C.reset} ${text}${" ".repeat(pad)} ${borderColor}│${C.reset}`;
}

export function zipLinesSideBySide(left: string[], right: string[], leftW: number, rightW: number, gap = 2): string[] {
  const rows = Math.max(left.length, right.length);
  const spacer = " ".repeat(gap);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push((left[i] ?? " ".repeat(leftW)) + spacer + (right[i] ?? " ".repeat(rightW)));
  }
  return out;
}
