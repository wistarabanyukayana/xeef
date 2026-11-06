// Runs the shipped plugin/dist/xeef.js against a fake `claude` on PATH. Each test gets its own XEEF_HOME and HOME.
// Set XEEF_TEST_TRANSCRIPT to a real Claude Code transcript that contains a usage-limit note to also run the
// usage-limit cases on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const XEEF = path.join(ROOT, "plugin", "dist", "xeef.js");
const verdict = (v) => JSON.stringify({ structured_output: { speak: false, kind: "none", note: "", to: "", reason: "", evidence: "x", ...v }, total_cost_usd: 0.001 });
const OK = verdict({});
const SPEAK = verdict({ speak: true, kind: "stakes", note: "Suggest more effort.", to: "opus high", reason: "flight code" });

// ---- fixtures ------------------------------------------------------------------------------------

const u = (text) => ({ type: "user", cwd: "/w/proj", message: { role: "user", content: text } });
const a = (text, effort = "medium", model = "claude-opus-5-5") => ({ type: "assistant", requestedModel: model, perTurnEffort: effort, message: { content: [{ type: "text", text }] } });
const edit = (file) => ({ type: "assistant", requestedModel: "claude-opus-5-5", perTurnEffort: "medium", message: { content: [{ type: "tool_use", id: file, name: "Edit", input: { file_path: file } }] } });
const blob = (file) => ({ type: "api-request-blob", message: { role: "user", content: [{ type: "tool_use", id: file, name: "Edit", input: { file_path: file } }] } });
const note = { type: "user", isMeta: true, usageLimitNote: "wrap_up", message: { content: "[Usage limit reached; a short grace allowance remains]" } };
const NORMAL = [u("fix the build"), a("Fixed."), u("now the tests"), a("Done.")];
const GRACE = [...NORMAL, u("one more thing"), note, a("Wrapping up.")];

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xeef-test-"));
  fs.mkdirSync(path.join(home, "bin"));
  const env = { ...process.env, HOME: home, XEEF_HOME: path.join(home, "x"), PATH: `${path.join(home, "bin")}:${process.env.PATH}`,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  delete env.XEEF_INNER;
  const t = {
    home, env, data: env.XEEF_HOME,
    /** Replace `claude` with a shell script; it records its env flag and arguments in $HOME/calls. */
    fake(script) {
      const f = path.join(home, "bin", "claude");
      fs.writeFileSync(f, `#!/bin/sh\necho "$XEEF_INNER $*" >> "${home}/calls"\ncat >/dev/null\n${script}\n`);
      fs.chmodSync(f, 0o755);
    },
    calls: () => (fs.existsSync(path.join(home, "calls")) ? fs.readFileSync(path.join(home, "calls"), "utf8") : ""),
    transcript(rows, name = "t.jsonl") {
      const f = path.join(home, name);
      fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
      return f;
    },
    run(mode, input = {}, extra = {}, args = []) {
      const r = spawnSync(process.execPath, [XEEF, "claude", mode, ...args], { input: JSON.stringify(input), env: { ...env, ...extra }, encoding: "utf8" });
      assert.equal(r.stderr, "", r.stderr);
      return r.stdout;
    },
    judge(file, sid = "s") { return t.run("judge", { session_id: sid, cwd: "/w/proj", transcript_path: file }); },
    rows: () => { const f = path.join(env.XEEF_HOME, "log.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; },
    last: () => t.rows().at(-1),
    config(c) { fs.mkdirSync(env.XEEF_HOME, { recursive: true }); fs.writeFileSync(path.join(env.XEEF_HOME, "config.json"), JSON.stringify(c)); },
  };
  return t;
}

async function until(check, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (check()) return;
  assert.fail("timed out");
}

// ---- the build -----------------------------------------------------------------------------------

test("committed plugin/dist/xeef.js matches a fresh build of src", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "xeef-build-")), "xeef.js");
  const r = spawnSync(path.join(ROOT, "node_modules", ".bin", "esbuild"), ["src/cli.ts", "--bundle", "--platform=node", "--target=node18", `--outfile=${out}`, "--log-level=warning"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(out, "utf8") === fs.readFileSync(XEEF, "utf8"), "plugin/dist/xeef.js is stale: run npm run build");
});

// ---- the five cases of the reference hook's own test --------------------------------------------

function usageCases(name, grace, normal) {
  test(`${name}: a usage-limit note in the last turn skips the judge`, () => {
    const t = setup(); t.fake(`echo '${OK}'`);
    t.judge(t.transcript(grace()));
    assert.deepEqual({ event: t.last().event, reason: t.last().reason }, { event: "skipped", reason: "usage limit note in this turn" });
    assert.equal(t.calls(), "", "the judge model was called");
  });
  test(`${name}: a normal turn logs a verdict`, () => {
    const t = setup(); t.fake(`echo '${OK}'`);
    t.judge(t.transcript(normal()));
    assert.equal(t.last().event, "verdict");
    assert.equal(t.last().judge, "claude:haiku");
  });
  test(`${name}: a usage limit on stderr is skipped, not an error`, () => {
    const t = setup(); t.fake(`echo "You've hit your usage limit" >&2; exit 1`);
    t.judge(t.transcript(normal()));
    const r = t.last();
    assert.equal(r.event, "skipped");
    assert.match(r.reason, /rc=1/); assert.match(r.reason, /hit your usage limit/);
  });
  test(`${name}: a usage limit in the JSON result is skipped`, () => {
    const t = setup(); t.fake(`echo '{"is_error":true,"result":"Claude AI usage limit reached|1762300000"}'`);
    t.judge(t.transcript(normal()));
    assert.equal(t.last().event, "skipped"); assert.match(t.last().reason, /usage limit reached/);
  });
  test(`${name}: any other failure logs an error`, () => {
    const t = setup(); t.fake(`echo 'Invalid API key' >&2; exit 1`);
    t.judge(t.transcript(normal()));
    assert.equal(t.last().event, "error");
    assert.match(t.last().error, /rc=1/); assert.match(t.last().error, /Invalid API key/);
  });
}

usageCases("fixture", () => GRACE, () => NORMAL);

const REAL = process.env.XEEF_TEST_TRANSCRIPT;
if (REAL) {
  // Cut the real transcript as the reference test did: through the first usage-limit note, and just before
  // the typed prompt of the turn that holds it.
  const rows = fs.readFileSync(REAL, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const n = rows.findIndex((e) => e.usageLimitNote);
  const isPrompt = (e) => e.type === "user" && !e.isMeta && typeof e.message?.content === "string" && !e.message.content.startsWith("<");
  const p = rows.slice(0, n).findLastIndex(isPrompt);
  usageCases("real transcript", () => rows.slice(0, n + 1), () => rows.slice(0, p));
}

// ---- judge -------------------------------------------------------------------------------------

test("the judge's own call runs with XEEF_INNER, no hooks and no tools", () => {
  const t = setup(); t.fake(`echo '${OK}'`);
  t.judge(t.transcript(NORMAL));
  const c = t.calls();
  assert.match(c, /^1 -p --model haiku /);
  assert.match(c, /--settings \{"disableAllHooks":true\}/);
  assert.match(c, /--tools {2}--settings/); // --tools ""
  assert.deepEqual(t.last().rung, ["claude-opus-5-5", "medium"]);
});

test("fewer than two prompts: no judge, no log", () => {
  const t = setup(); t.fake(`echo '${OK}'`);
  t.judge(t.transcript([u("hi"), a("Hello.")]));
  assert.equal(t.rows().length, 0);
});

test("a failed judge falls through to the next one in the list", () => {
  const t = setup();
  t.fake(`case "$*" in *"--model haiku"*) echo 'boom' >&2; exit 1;; esac; echo '${OK}'`);
  t.config({ claude: { judges: [{ harness: "claude", model: "haiku" }, { harness: "claude", model: "sonnet" }] } });
  t.judge(t.transcript(NORMAL));
  assert.deepEqual(t.rows().map((r) => [r.event, r.judge]), [["error", "claude:haiku"], ["verdict", "claude:sonnet"]]);
});

test("a judge for a harness that is not built yet logs an error and moves on", () => {
  const t = setup(); t.fake(`echo '${OK}'`);
  t.config({ claude: { judges: [{ harness: "codex", model: "gpt-6-luna" }, { harness: "claude", model: "haiku" }] } });
  t.judge(t.transcript(NORMAL));
  assert.match(t.rows()[0].error, /"codex" is not built yet/);
  assert.equal(t.last().event, "verdict");
});

// ---- stop, inject, outcome -----------------------------------------------------------------------

test("the Stop hook returns at once and judges in the background", async () => {
  const t = setup(); t.fake(`sleep 2; echo '${OK}'`);
  const t0 = Date.now();
  t.run("stop", { session_id: "s", cwd: "/w/proj", transcript_path: t.transcript(NORMAL) });
  assert.ok(Date.now() - t0 < 1500, `stop took ${Date.now() - t0} ms`);
  assert.equal(t.rows().length, 0);
  await until(() => t.last()?.event === "verdict");
});

test("XEEF_INNER turns every hook into a no-op", () => {
  const t = setup(); t.fake(`echo '${SPEAK}'`);
  const f = t.transcript(NORMAL);
  for (const mode of ["stop", "judge", "inject", "review"]) t.run(mode, { session_id: "s", transcript_path: f }, { XEEF_INNER: "1" });
  assert.equal(fs.existsSync(t.data), false);
});

test("a verdict that speaks is delivered once, then its outcome is logged", () => {
  const t = setup(); t.fake(`echo '${SPEAK}'`);
  const f = t.transcript(NORMAL);
  t.judge(f);
  assert.ok(fs.existsSync(path.join(t.data, "pending", "s.json")));
  const out = JSON.parse(t.run("inject", { session_id: "s", transcript_path: f }));
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /^Session judge \(the user's own hook, Xeef, .*Suggest more effort\. .*"This one is worth \/effort high: flight code\."/);
  assert.equal(t.last().event, "delivered");
  assert.equal(t.run("inject", { session_id: "s", transcript_path: f }), "", "delivered twice");
  // The user switched to high effort; the next judge run logs that the suggestion was taken.
  t.fake(`echo '${OK}'`);
  t.judge(t.transcript([...NORMAL, u("go on"), a("Going.", "high")]));
  const outcome = t.rows().find((r) => r.event === "outcome");
  assert.deepEqual([outcome.before, outcome.after, outcome.changed], [["claude-opus-5-5", "medium"], ["claude-opus-5-5", "high"], true]);
  assert.match(t.judge(t.transcript([...NORMAL, u("go on"), a("Going.", "high"), u("more"), a("Ok.", "high")])), /^$/);
  assert.equal(t.rows().filter((r) => r.event === "outcome").length, 1, "outcome logged twice");
});

test("a verdict judged more than two prompts ago is dropped", () => {
  const t = setup();
  fs.mkdirSync(path.join(t.data, "pending"), { recursive: true });
  fs.writeFileSync(path.join(t.data, "pending", "s.json"), JSON.stringify({ speak: true, kind: "lighter", note: "n", line: "", evidence: "", prompt_n: 1, rung: ["x", null] }));
  const f = t.transcript([u("1"), a("a"), u("2"), a("b"), u("3"), a("c"), u("4")]);
  assert.equal(t.run("inject", { session_id: "s", transcript_path: f }), "");
  assert.equal(fs.existsSync(path.join(t.data, "pending", "s.json")), false);
});

// ---- the rung the judge picks becomes a command Xeef writes ----------------------------------

const RUNGS = [
  // [current model, effort, kind, judge's rung, expected line or null when dropped]
  ["claude-opus-5-5", "medium", "stakes", "opus high", "This one is worth /effort high: flight code."],
  ["claude-sonnet-5-5", "high", "struggle", "opus medium", "This might go better with /model opus then /effort medium: flight code."],
  ["claude-opus-5-5", "xhigh", "struggle", "fable", "This might go better with /model claude-fable-5-1: flight code."],
  ["claude-opus-5-5", "high", "lighter", "opus medium", "This looks routine enough for /effort medium: flight code."],
  ["claude-opus-5-5", "high", "lighter", "sonnet high", "This looks routine enough for /model sonnet then /effort high: flight code."],
  ["claude-opus-5-5", "medium", "lighter", "opus high", null], // lighter that points up
  ["claude-opus-5-5", "high", "stakes", "opus high", null], // already there
  ["claude-opus-5-5", "high", "stakes", "", null], // no rung
];
for (const [model, effort, kind, to, line] of RUNGS) {
  test(`${kind} from ${model} ${effort} to "${to}" ${line ? "suggests a command" : "is dropped"}`, () => {
    const t = setup(); t.fake(`echo '${verdict({ speak: true, kind, note: "n", to, reason: "flight code." })}'`);
    t.judge(t.transcript([u("1"), a("a", effort, model), u("2"), a("b", effort, model)]));
    const r = t.last();
    assert.equal(r.event, "verdict");
    assert.equal(r.line, line ?? "");
    assert.equal(!!r.dropped, !line);
    assert.equal(fs.existsSync(path.join(t.data, "pending", "s.json")), !!line);
  });
}

test("a restatement carries no command, even when the judge sends a stray quote pair", () => {
  const t = setup(); t.fake(`echo '${verdict({ speak: true, kind: "misread", note: "Restate the request first.", to: "opus high", reason: '""' })}'`);
  const f = t.transcript(NORMAL);
  t.judge(f);
  const ctx = JSON.parse(t.run("inject", { session_id: "s", transcript_path: f })).hookSpecificOutput.additionalContext;
  assert.match(ctx, /Restate the request first\. If it plainly does not fit/);
  assert.doesNotMatch(ctx, /end your reply/);
});

test("a blank reason leaves just the command", () => {
  const t = setup(); t.fake(`echo '${verdict({ speak: true, kind: "stakes", note: "n", to: "opus high", reason: '""' })}'`);
  t.judge(t.transcript(NORMAL));
  assert.equal(t.last().line, "This one is worth /effort high.");
});

// ---- signals and prompt ------------------------------------------------------------------------

function dryPrompt(t, rows) {
  const dir = path.join(t.home, "projects"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "aaaaaaaa.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n"));
  const out = t.run("backtest", {}, {}, [dir, "1000", "--dry"]).trim().split("\n").map((l) => JSON.parse(l));
  return out.sort((x, y) => y.at - x.at)[0].prompt; // the latest point
}

const five = (...middle) => [u("1"), a("a"), u("2"), a("b"), u("3"), a("c"), u("4"), ...middle, u("5")];

test("stakes paths from config.json reach the prompt", () => {
  const t = setup();
  t.config({ stakes: [{ path: "/w/*", globs: ["core/*"] }] });
  const p = dryPrompt(t, five(edit("/w/proj/core/link.rs")));
  assert.match(p, /\nStakes paths here: core\/\*\n/);
  assert.match(p, /\nStakes paths touched in the last two prompts: core\/\*\n/);
  assert.match(p, /\nTOOL: Edit \/w\/proj\/core\/link\.rs$/);
});

test("tool calls copied into api-request-blob entries are not counted", () => {
  const t = setup();
  const f = "/w/proj/a.rs";
  assert.match(dryPrompt(t, five(...Array(6).fill(edit(f)))), /Mechanical signals: one file edited 6 times/);
  assert.match(dryPrompt(t, five(edit(f), edit(f), edit(f), blob(f), blob(f), blob(f))), /Mechanical signals: none/);
});

test("friction phrases in English and Indonesian count as pushback", () => {
  const t = setup();
  const p = dryPrompt(t, [u("1"), a("a"), u("that's not what I meant"), a("b"), u("masih salah"), a("c"), u("4"), u("5")]);
  assert.match(p, /Mechanical signals: 2 of the last 5 prompts push back on the answer/);
});

// ---- weekly review -----------------------------------------------------------------------------

test("the session-start hook reports the last review once", () => {
  const t = setup();
  fs.mkdirSync(t.data, { recursive: true });
  fs.writeFileSync(path.join(t.data, "review-note.txt"), "Dropped the step-down rule.\n");
  const out = JSON.parse(t.run("review"));
  assert.match(out.hookSpecificOutput.additionalContext, /^Session judge weekly review: Dropped the step-down rule\. \(profile: /);
  assert.equal(t.run("review"), "");
});

test("a due review runs in the background, rewrites the profile and commits it", async () => {
  const t = setup();
  t.fake(`echo "- new rule" > profile.md; echo "Added a rule." > review-note.txt; echo done`);
  fs.mkdirSync(t.data, { recursive: true });
  fs.writeFileSync(path.join(t.data, "log.jsonl"), '{"event":"verdict"}\n'.repeat(30));
  t.run("review");
  await until(() => t.last()?.event === "review");
  assert.match(t.calls(), /^1 -p --model sonnet --no-session-persistence --tools Read,Write,Edit --permission-mode acceptEdits /);
  assert.equal(fs.readFileSync(path.join(t.data, "profile.md"), "utf8"), "- new rule\n");
  const git = spawnSync("git", ["log", "--oneline", "--", "profile.md"], { cwd: t.data, encoding: "utf8" });
  assert.match(git.stdout, /weekly review/);
  t.run("review"); // not due again for a week
  assert.equal(t.calls().match(/^1 -p /gm).length, 1);
});

test("a held lock stops a second review", () => {
  const t = setup(); t.fake("echo done");
  fs.mkdirSync(t.data, { recursive: true });
  fs.writeFileSync(path.join(t.data, "review.lock"), "1");
  t.run("review-run");
  assert.equal(t.calls(), "");
});

// ---- plugin suggestions --------------------------------------------------------------------------

/** A fake `claude` that lists the given plugin ids and answers every judge call with the verdict. */
const pluginFake = (t, ids, v) => t.fake(`case "$*" in "plugin list --json") echo '${JSON.stringify(ids.map((id) => ({ id })))}'; exit 0;; esac\necho '${verdict(v)}'`);
const at = (t, text) => ({ ...u(text), cwd: t.home });
const IMPECCABLE = { speak: true, kind: "plugin", plugin: "impeccable", note: "Offer the plugin.", reason: "the header restyle is UI work" };

function cssSession(t) {
  return t.transcript([at(t, "restyle the header"), a("On it."), edit(path.join(t.home, "src", "app.css")), at(t, "now the footer"), a("Done.")]);
}
const judgeHere = (t, f) => t.run("judge", { session_id: "s", cwd: t.home, transcript_path: f });

test("an edited .css file makes impeccable a candidate, offered once with its install command", () => {
  const t = setup(); pluginFake(t, ["ponytail@ponytail"], IMPECCABLE);
  const f = cssSession(t);
  judgeHere(t, f);
  assert.equal(t.last().line, "This work could use the impeccable plugin (UI design work: layout, typography and visual polish that does not look generated): "
    + "the header restyle is UI work. To add it: /plugin marketplace add pbakaus/impeccable, then /plugin install impeccable@impeccable.");
  assert.match(t.run("inject", { session_id: "s", transcript_path: f }), /end your reply with one line: \\"This work could use the impeccable plugin/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(t.data, "state", "plugins.json"), "utf8")).impeccable);
  judgeHere(t, f); // offered already: no longer a candidate, so the same verdict is dropped
  assert.match(t.last().dropped, /"impeccable" is not a candidate/);
  assert.equal(fs.existsSync(path.join(t.data, "pending", "s.json")), false);
});

test("a plugin the user has, or one that conflicts with it, is not a candidate", () => {
  for (const ids of [["impeccable@impeccable"], ["frontend-design@claude-plugins-official"]]) {
    const t = setup(); pluginFake(t, ids, IMPECCABLE);
    judgeHere(t, cssSession(t));
    assert.match(t.last().dropped, /not a candidate/, ids[0]);
  }
});

test("a plugin installed after the offer logs the outcome once", () => {
  const t = setup(); pluginFake(t, ["impeccable@impeccable"], {});
  fs.mkdirSync(path.join(t.data, "state"), { recursive: true });
  fs.writeFileSync(path.join(t.data, "state", "plugins.json"), JSON.stringify({ impeccable: { at: new Date().toISOString(), sid: "old" } }));
  const f = t.transcript([at(t, "1"), a("a"), at(t, "2"), a("b")]);
  judgeHere(t, f); judgeHere(t, f);
  assert.deepEqual(t.rows().filter((r) => r.event === "outcome").map((r) => [r.kind, r.plugin, r.changed]), [["plugin", "impeccable", true]]);
});

test("a prompt pattern puts the plugin in the judge's prompt; a user entry replaces the shipped one", () => {
  const t = setup(); pluginFake(t, [], {});
  const rows = [at(t, "1"), a("a"), at(t, "2"), a("b"), at(t, "this is over-engineered"), a("c"), at(t, "4"), at(t, "5")];
  assert.match(dryPrompt(t, rows), /\nPlugins the work points at, which the user does not have:\n- ponytail: keeping code minimal: .* \(a prompt said "this is over-engineered"\)\n/);
  t.config({ catalog: [{ name: "ponytail", for: "my own words", signals: { files: [], prompts: ["over-?engineer"] }, claude: { id: "ponytail@ponytail", install: "x" } }] });
  assert.match(dryPrompt(t, rows), /\n- ponytail: my own words \(a prompt said/);
});

test("without a matching entry the prompt has no plugin section and the plugin list is not read", () => {
  const t = setup(); pluginFake(t, [], {});
  assert.doesNotMatch(dryPrompt(t, [at(t, "1"), a("a"), at(t, "2"), a("b"), at(t, "3"), a("c"), at(t, "4"), at(t, "5")]), /Plugins the work/);
  assert.doesNotMatch(t.calls(), /plugin list/);
});

test("a matching file outside the session's folder is not a signal", () => {
  const t = setup(); pluginFake(t, [], {});
  const p = dryPrompt(t, [at(t, "1"), a("a"), at(t, "2"), a("b"), at(t, "3"), a("c"), at(t, "4"), edit("/elsewhere/.claude/plans/plan.md"), at(t, "5")]);
  assert.doesNotMatch(p, /Plugins the work/);
});
