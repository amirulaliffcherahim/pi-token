# pi-token ⚡ (TokScale on Steroids for Pi)

A high-performance TokScale-inspired quota, limits, and spend telemetry extension for [Pi Coding Agent](https://pi.dev).

## Highlights
- **Tab 1: Usage Limits & Connected Accounts (Default)**
  - TokScale native architecture: Overall System Readiness Card, Inspector Card, and full Accounts Table.
  - Interactive selection: `[↑]` / `[↓]` moves active account in the table and updates the Inspector Card.
  - Normalizes three distinct provider data models:
    - **Windowed Quotas**: Anthropic Claude (5h session, 7d weekly) & Google Antigravity (per-model remaining % and reset countdowns).
    - **Monetary Balances**: DeepSeek real-time USD balance & granted/topped-up credits.
    - **Safety Gates**: SubQ Snap fast gate compliance status.
  - Privacy mode: `[e]` to toggle masked/visible account emails and keys.
- **Tab 2: TokScale 2-Column Overview Dashboard**
  - **Hero Summary**: Period spend ($), total calls, total sessions, % cache hit, burn velocity ($/hr and tokens/min).
  - **Daily Activity**: Cost, calls, and segmented usage bars.
  - **By Activity**: Coding, Debugging, Refactoring, Conversation breakdown with 1-shot completion rates.
  - **Core Tools & Shell Commands**: Live counters for `read`, `edit`, `bash`, `git`, and runtimes.
  - **By Project & Model**: Top workspaces and model spend rankings.
- **Interactive Controls**:
  - `[↑] / [↓]` — Select account in table
  - `[1]` — Usage Limits tab
  - `[2]` — TokScale Overview tab
  - `[t]` — Cycle Period (`Today` -> `7 Days` -> `30 Days` -> `All-Time`)
  - `[s]` — Toggle Scope (`Current Workspace` vs `Global Machine`)
  - `[e]` — Toggle Email Masking
  - `[r]` — Refresh
  - `[q]` / `[Esc]` — Exit

## Commands
- `/token` or `/tokens` — Launch TokScale dashboard (defaults to Usage Limits tab).
- `/token overview` — Open directly to 2-column TokScale analytics.
- `/token global` — Open in global machine scope.
