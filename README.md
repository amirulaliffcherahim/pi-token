# pi-limit ⚡ (TokScale on Steroids for Pi)

A high-performance TokScale-inspired limit, quota, and spend telemetry extension for [Pi Coding Agent](https://pi.dev).

## Highlights
- **Auto-Detect Accounts & Providers**: Automatically inspects `~/.pi/agent/auth.json` to monitor:
  - **Anthropic Claude**: Pro / Team session & 7-day rate-limit windows (`/api/oauth/usage`).
  - **Google Antigravity (agy)**: Model quota percentages (Opus 5.5, Sonnet, Gemini 3.8 Flash, Gemini Thinking) & tier availability.
  - **DeepSeek**: Real-time USD balance & topped-up credit balance (`/user/balance`).
  - **SubQ Gate**: SubQ Snap safety/compliance fast gate status.
  - **OpenAI / Codex**: API status & tokens.
- **TokScale 2-Column Dashboard**:
  - **Hero Summary**: Period spend ($), total calls, total sessions, cache hit rate (%), burn velocity ($/hr and tokens/min).
  - **Daily Activity**: Cost, calls, and segmented usage bars.
  - **By Activity**: Coding, Debugging, Refactoring, Conversation breakdown with 1-shot completion rates.
  - **Core Tools & Shell Commands**: Live counters for `read`, `edit`, `bash`, `git`, and runtimes.
  - **By Project & Model**: Top workspaces and model spend rankings.
- **Interactive TUI**:
  - `[1]` Usage Limits & Quota Tab (Default)
  - `[2]` TokScale 2-Column Overview Tab
  - `[t]` Cycle Time Period (`Today` -> `7 Days` -> `30 Days` -> `All-Time`)
  - `[s]` Toggle Scope (`Current Workspace` vs `Global Machine`)
  - `[r]` Refresh
  - `[q]` / `[Esc]` Exit

## Commands
- `/limit` or `/limits` — Launch dashboard (defaults to Limits tab).
- `/limit overview` — Open directly to TokScale 2-column view.
- `/limit global` — Open in global scope.
