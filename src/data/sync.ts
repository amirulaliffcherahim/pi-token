import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { getDb } from "./db.ts";

function getSessionsDir(): string {
  return path.join(os.homedir(), ".pi", "agent", "sessions");
}

function calculateMessageCost(
  modelId: string,
  provider: string,
  inp: number,
  out: number,
  cRead: number,
  cWrite: number,
) {
  const m = (modelId || "").toLowerCase();
  let inP = 3.0, outP = 15.0, crP = 0.3, cwP = 3.75; // default sonnet

  if (m.includes("opus")) {
    inP = 15.0; outP = 75.0; crP = 1.5; cwP = 18.75;
  } else if (m.includes("haiku")) {
    inP = 0.8; outP = 4.0; crP = 0.08; cwP = 1.0;
  } else if (m.includes("deepseek")) {
    inP = 0.27; outP = 1.10; crP = 0.07; cwP = 0.27;
  } else if (m.includes("flash")) {
    inP = 0.15; outP = 0.60; crP = 0.0375; cwP = 0.15;
  }

  const cIn = (inp / 1_000_000) * inP;
  const cOut = (out / 1_000_000) * outP;
  const cCR = (cRead / 1_000_000) * crP;
  const cCW = (cWrite / 1_000_000) * cwP;
  const cTotal = cIn + cOut + cCR + cCW;
  const cSavings = (cRead / 1_000_000) * (inP - crP);

  return { cIn, cOut, cCR, cCW, cTotal, cSavings: Math.max(0, cSavings) };
}

export async function syncSessionsIncremental(): Promise<number> {
  const sessionsDir = getSessionsDir();
  if (!fs.existsSync(sessionsDir)) return 0;

  const db = getDb();
  let totalIndexed = 0;

  const getFileStmt = db.prepare("SELECT mtime, size FROM files WHERE path = ?");
  const upsertFileStmt = db.prepare(
    "INSERT OR REPLACE INTO files (path, mtime, size, entries_indexed) VALUES (?, ?, ?, ?)"
  );
  const insertMsgStmt = db.prepare(`
    INSERT OR IGNORE INTO messages (
      entry_id, session_id, session_path, workspace, timestamp,
      model_id, provider, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens,
      total_tokens, cost_input, cost_output, cost_cache_read,
      cost_cache_write, cost_total, cache_savings
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const workspaceDirs = fs.readdirSync(sessionsDir, { withFileTypes: true });

  for (const wDir of workspaceDirs) {
    if (!wDir.isDirectory()) continue;
    const fullDirPath = path.join(sessionsDir, wDir.name);

    let jsonlFiles: string[] = [];
    try {
      jsonlFiles = fs.readdirSync(fullDirPath).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }

    for (const f of jsonlFiles) {
      const fullPath = path.join(fullDirPath, f);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(fullPath);
      } catch {
        continue;
      }

      const cached = getFileStmt.get(fullPath) as { mtime: number; size: number } | undefined;
      if (cached && cached.mtime === Math.floor(stats.mtimeMs) && cached.size === stats.size) {
        continue; // Already fresh
      }

      const fileStream = fs.createReadStream(fullPath);
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let countInFile = 0;
      let lineIndex = 0;

      for await (const line of rl) {
        lineIndex++;
        if (!line || !line.trim()) continue;

        let record: any;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }

        if (record.type === "message" || record.role === "assistant" || record.usage) {
          const usage = record.usage || record.message?.usage;
          if (!usage) continue;

          const entryId = record.id || `${f}-${lineIndex}`;
          const sessionId = f.replace(".jsonl", "");
          const workspace = record.workspace || wDir.name.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
          const ts = record.timestamp || stats.mtimeMs;
          const modelId = record.model || record.modelId || "unknown";
          let provider = "OpenAI";
          if (modelId.includes("claude") || modelId.includes("opus") || modelId.includes("sonnet")) provider = "Anthropic";
          else if (modelId.includes("gemini") || modelId.includes("flash") || modelId.includes("argon")) provider = "Google";
          else if (modelId.includes("deepseek")) provider = "DeepSeek";

          const inp = usage.input || usage.input_tokens || 0;
          const out = usage.output || usage.output_tokens || 0;
          const cr = usage.cacheRead || usage.cache_read_input_tokens || 0;
          const cw = usage.cacheWrite || usage.cache_creation_input_tokens || 0;
          const tot = usage.totalTokens || (inp + out + cr + cw);

          const costs = calculateMessageCost(modelId, provider, inp, out, cr, cw);

          insertMsgStmt.run(
            entryId,
            sessionId,
            fullPath,
            workspace,
            Math.floor(ts),
            modelId,
            provider,
            inp,
            out,
            cr,
            cw,
            0,
            tot,
            costs.cIn,
            costs.cOut,
            costs.cCR,
            costs.cCW,
            costs.cTotal,
            costs.cSavings
          );
          countInFile++;
        }
      }

      upsertFileStmt.run(fullPath, Math.floor(stats.mtimeMs), stats.size, countInFile);
      totalIndexed += countInFile;
    }
  }

  return totalIndexed;
}
