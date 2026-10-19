import { boxBottom, boxLine, boxTop } from "./box.ts";
import { C, fit } from "./theme.ts";

export interface TableColumn<Row> {
  title: string;
  width: number;
  align?: "left" | "right";
  /** Lower number = kept longer when the window is narrow. */
  priority: number;
  /** Plain text for the cell (colour is applied per column, so width maths stay exact). */
  text: (row: Row) => string;
  color?: string;
}

const GAP = 1;

function alignCell(text: string, width: number, align: "left" | "right"): string {
  const clipped = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
  return align === "right" ? clipped.padStart(width) : clipped.padEnd(width);
}

/** Drop the least important columns until the row fits, so headers and cells always line up. */
function selectColumns<Row>(columns: TableColumn<Row>[], innerWidth: number): TableColumn<Row>[] {
  const kept = [...columns];
  const rowWidth = () => kept.reduce((sum, column) => sum + column.width + GAP, 0) - GAP;
  while (kept.length > 1 && rowWidth() > innerWidth) {
    const dropIndex = kept.reduce((worst, column, index) => (column.priority > kept[worst].priority ? index : worst), 0);
    kept.splice(dropIndex, 1);
  }
  return kept;
}

export function renderTable<Row>(
  title: string,
  columns: TableColumn<Row>[],
  rows: Row[],
  width: number,
  emptyMessage = "No data for this period.",
): string[] {
  const inner = width - 4;
  const shown = selectColumns(columns, inner);
  const header = shown.map((c) => alignCell(c.title, c.width, c.align ?? "left")).join(" ".repeat(GAP));
  const lines = [boxTop(title, width), boxLine(`${C.bold}${C.gray}${header}${C.reset}`, inner)];

  if (rows.length === 0) lines.push(boxLine(`${C.darkGray}${emptyMessage}${C.reset}`, inner));
  for (const row of rows) {
    const cells = shown.map((c) => `${c.color ?? C.white}${alignCell(c.text(row), c.width, c.align ?? "left")}${C.reset}`);
    lines.push(boxLine(cells.join(" ".repeat(GAP)), inner));
  }
  lines.push(boxBottom(width));
  return lines;
}

export { fit };
