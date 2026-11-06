// Claude Code: transcript reader, judge call, and model ladder.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Event, Harness, Rung, UsageLimit, Verdict } from "./core";

type Block = { type?: string; text?: string; name?: string; is_error?: boolean; input?: { file_path?: string; command?: unknown } };
type Entry = { type?: string; isMeta?: boolean; cwd?: string; requestedModel?: string; perTurnEffort?: string; effort?: string;
  usageLimitNote?: string; message?: { content?: unknown } };

const SKIP = ["<command-", "<local-command", "<system-reminder", "<task-notification", "<bash-", "This session is being continued"];
const EDITS = ["Edit", "Write", "MultiEdit"];
const NO_HOOKS = JSON.stringify({ disableAllHooks: true });
const ALIASES: Record<string, string> = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" };

/** The text the user typed, or null for tool results, meta and command echoes. */
function typed(e: Entry): string | null {
  if (e.type !== "user" || e.isMeta) return null;
  let c = e.message?.content;
  if (Array.isArray(c)) {
    const blocks = c.filter((b): b is Block => !!b && typeof b === "object");
    if (blocks.some((b) => b.type === "tool_result")) return null;
    c = blocks.map((b) => b.text ?? "").join(" ");
  }
  if (typeof c !== "string" || SKIP.some((s) => c.trimStart().startsWith(s))) return null;
  return c;
}

function read(file: string) {
  const events: Event[] = [];
  let cwd: string | undefined;
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { return { events }; }
  for (const line of text.split("\n")) {
    let e: Entry;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== "object") continue;
    cwd ||= e.cwd;
    const t = typed(e);
    if (t !== null) { events.push({ kind: "user", text: t }); continue; }
    if (e.usageLimitNote) events.push({ kind: "usage_limit" }); // Claude Code's grace notice: the limit is spent
    if (e.requestedModel) events.push({ kind: "model", model: e.requestedModel, effort: e.perTurnEffort || e.effort || null });
    // Only real turns: other entry types, such as api-request-blob, repeat earlier tool calls and results.
    const c = e.type === "user" || e.type === "assistant" ? e.message?.content : null;
    for (const b of Array.isArray(c) ? (c as Block[]) : []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_result" && b.is_error) events.push({ kind: "tool_error" });
      else if (b.type === "text" && e.type === "assistant" && typeof b.text === "string") events.push({ kind: "assistant", text: b.text });
      else if (b.type === "tool_use") {
        const inp = b.input || {};
        events.push({ kind: "tool", name: String(b.name), path: inp.file_path || undefined,
          command: typeof inp.command === "string" ? inp.command : undefined, edit: EDITS.includes(String(b.name)) });
      }
    }
  }
  return { events, cwd };
}

/** The model and effort saved in ~/.claude/settings.json. */
function savedRung(): Rung {
  let s: { model?: string; effortLevel?: string; modelSettings?: Record<string, { effortLevel?: string }> };
  try { s = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8")); } catch { return [null, null]; }
  const m = s.model || "opus", full = ALIASES[m] || m;
  return [full, s.modelSettings?.[full]?.effortLevel || s.effortLevel || null];
}

const inner = { ...process.env, XEEF_INNER: "1" };

function ask(model: string, system: string, prompt: string, schema: object) {
  const t0 = Date.now();
  const r = spawnSync("claude", ["-p", "--model", model, "--no-session-persistence", "--tools", "", "--settings", NO_HOOKS,
    "--system-prompt", system, "--output-format", "json", "--json-schema", JSON.stringify(schema)],
  { input: prompt, encoding: "utf8", timeout: 90_000, env: inner, maxBuffer: 16 << 20 });
  if (r.error) throw new Error(`claude: ${r.error.message}`);
  let out: { is_error?: boolean; result?: string; structured_output?: Verdict; total_cost_usd?: number };
  try { out = JSON.parse(r.stdout); } catch { out = { is_error: true, result: r.stdout }; }
  if (r.status || out.is_error) {
    const msg = `rc=${r.status} ${out.result || ""} ${r.stderr}`.trim().slice(-300);
    // ponytail: keyword match on the CLI's error text; a usage failure worded without "limit" logs as error
    throw new (msg.toLowerCase().includes("limit") ? UsageLimit : Error)(msg);
  }
  const v = out.structured_output ?? JSON.parse(out.result || "{}");
  return { v, secs: Math.round((Date.now() - t0) / 100) / 10, cost: out.total_cost_usd };
}

function review(model: string, task: string, cwd: string) {
  const r = spawnSync("claude", ["-p", "--model", model, "--no-session-persistence", "--tools", "Read,Write,Edit",
    "--permission-mode", "acceptEdits", "--settings", NO_HOOKS, task], { cwd, encoding: "utf8", timeout: 900_000, env: inner });
  return { rc: r.status, out: r.stdout || r.error?.message || "" };
}

export const claude: Harness = {
  id: "claude",
  name: "Claude Code",
  ladder: ["haiku", "sonnet low", "sonnet medium", "sonnet high", "opus low", "opus medium", "opus high", "opus xhigh", "fable"],
  rule: "Anthropic's rule: if effort was lowered, restore it first; otherwise go one tier up.",
  commands: "/effort <level>, /model <name>",
  judge: "haiku",
  reviewer: "sonnet",
  read, savedRung, ask, review,
};
