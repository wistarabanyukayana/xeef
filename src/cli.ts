// xeef <harness> <mode>
//   stop      Stop hook: starts `judge` in the background and returns at once.
//   judge     Reads the transcript tail and the profile, asks the judge list, keeps a verdict worth saying.
//   inject    Prompt-submit hook: hands a pending verdict to the agent.
//   review    Session-start hook: reports the last weekly review; starts the next one when due.
//   review-run  The weekly review itself (started by `review`).
//   backtest DIR N [--dry]  Judges N sampled points from past transcripts in DIR; --dry prints the prompts instead.
import * as fs from "node:fs";
import { claude } from "./claude";
import { backtest, Harness, inject, judge, review, reviewRun, stop } from "./core";

const HARNESSES: Record<string, Harness> = { claude };
const [id, mode, ...rest] = process.argv.slice(2);
const h = HARNESSES[id];

function hookInput() {
  try { return JSON.parse(rest[0] ?? fs.readFileSync(0, "utf8")); } catch { return {}; }
}

function say(event: string, ctx: string | null) {
  if (ctx) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: ctx } }));
}

if (!h || !mode) {
  console.error("usage: xeef claude <stop|judge|inject|review|review-run|backtest DIR N [--dry]>");
  process.exit(2);
}
if (process.env.XEEF_INNER && mode !== "backtest") process.exit(0); // the judge's own model call: never start Xeef again
try {
  if (mode === "stop") stop(h, hookInput());
  else if (mode === "judge") judge(h, hookInput());
  else if (mode === "inject") say("UserPromptSubmit", inject(h, hookInput()));
  else if (mode === "review") say("SessionStart", review(h));
  else if (mode === "review-run") reviewRun(h);
  else if (mode === "backtest") backtest(h, rest[0], Number(rest[1]), rest.includes("--dry"));
  else throw new Error(`unknown mode ${mode}`);
} catch (e) {
  if (mode === "backtest") throw e;
  // a hook never breaks the session; the error goes to the harness's debug log
  console.error(`xeef: ${e instanceof Error ? e.stack : e}`);
}
