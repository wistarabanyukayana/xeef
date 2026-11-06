// Harness-neutral core: data folder, log, mechanical signals, the judge prompt, and the four modes.
// A harness (see claude.ts) supplies the transcript reader, the model call, and its model ladder.
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import CATALOG from "../catalog.json";

export const DIR = process.env.XEEF_HOME || path.join(os.homedir(), ".xeef");
const PENDING = path.join(DIR, "pending"), STATE = path.join(DIR, "state");
const LOG = path.join(DIR, "log.jsonl"), PROFILE = path.join(DIR, "profile.md");
const TAIL_PROMPTS = 8, CLIP = 700, WINDOW = 6, REVIEW_EVERY = 7 * 86400, REVIEW_MIN_ROWS = 30;

/** A transcript, reduced to what the judge reads. Every harness's reader produces this. */
export type Event =
  | { kind: "user"; text: string } // text the user typed (not tool results, meta, command echoes)
  | { kind: "assistant"; text: string }
  | { kind: "tool"; name: string; path?: string; command?: string; edit: boolean }
  | { kind: "tool_error" }
  | { kind: "model"; model: string; effort: string | null }
  | { kind: "usage_limit" }; // the harness says the usage limit is spent

/** What the judge returns. `to` names a rung and `plugin` a catalog entry; Xeef, not the judge, turns either into a command. */
export type Verdict = { speak: boolean; kind: string; note: string; to: string; plugin: string; reason: string; evidence: string };
/** A catalog entry (see catalog.json). Each harness it supports has a section under its id: `{ id, install }`. */
export type Entry = { name: string; for: string; signals: { files: string[]; prompts: string[] }; conflicts?: string[] };
const section = (e: Entry, h: Harness) => (e as unknown as Record<string, { id: string; install: string } | undefined>)[h.id];
/** A rung on a harness's ladder: `model` is a family name such as "opus"; `effort` is null where the model has none. */
export type Step = { name: string; model: string; effort: string | null };
export type Rung = [string | null, string | null];

export class UsageLimit extends Error {}

/** One entry of a judge list. `harness` is a Harness id; another harness's model is an opt-in fallback. */
export type Judge = { harness: string; model: string };
const label = (j: Judge) => `${j.harness}:${j.model}`;

export interface Harness {
  id: string; // "claude": names the config section, the CLI argument and the judge in the log
  name: string; // "Claude Code": the agent named in the judge's system prompt
  ladder: Step[]; // weakest first
  rule: string; // how to climb the ladder
  place(r: Rung): number | null; // orders any rung against the ladder's steps; null for an unknown model
  command(from: Rung, to: Step): string; // what the user types to move from one rung to another
  judge: string; // default cheap model for the per-turn judge
  reviewer: string; // default stronger model for the weekly review
  read(file: string): { events: Event[]; cwd?: string };
  savedRung(): Rung; // the rung when the transcript does not say
  ask(model: string, system: string, prompt: string, schema: object): { v: Verdict; secs: number; cost?: number };
  review(model: string, task: string, cwd: string): { rc: number | null; out: string }; // an agent that may edit files in cwd
  installed(): string[] | null; // ids of the plugins the user has, in any scope; null when the harness cannot say
}

export const schema = (h: Harness) => ({ type: "object", required: ["speak", "kind", "note", "to", "plugin", "reason", "evidence"], properties: {
  speak: { type: "boolean" },
  kind: { type: "string", enum: ["none", "misread", "struggle", "stakes", "lighter", "plugin"] },
  note: { type: "string" }, to: { type: "string", enum: ["", ...h.ladder.map((s) => s.name)] },
  plugin: { type: "string", enum: ["", ...catalog().map((e) => e.name)] },
  reason: { type: "string" }, evidence: { type: "string" } } });

export const system = (h: Harness) => `You watch a coding session between a user and an AI assistant (${h.name}) and decide whether the
assistant should tell the user something about how the session is set up. You never talk to the user; your
verdict is handed to the assistant before the user's next prompt. Most of the time the answer is speak=false.

Speak only for one of these, with evidence from the transcript:
- misread: the latest one or two user prompts correct the assistant's reading of the request ("not what I
  meant", repeating themselves, re-explaining), and the assistant's last reply did not already restate or fix
  it. note tells the assistant to restate the request in one sentence before acting; to is "" (the assistant
  writes the restatement itself, you do not).
- struggle: the work is going in circles (same fix retried, errors repeating, the user frustrated) and a
  stronger rung would likely help. to is the next rung up.
- stakes: the work now in progress, or clearly about to start, is expensive when wrong (see the profile and
  the stakes paths) and the session is below the rung the profile asks for. to is the rung the work needs.
- lighter: the session is on a high rung while recent and upcoming work is routine. to is a lower rung that fits it.
- plugin: the prompt lists plugins the work points at, and the work in the last few prompts is the kind one of them
  helps with. plugin names it and reason says what in the work shows the fit; to is "". An offer is cheap: each
  plugin is offered once per user and never again, so the one-in-ten aim below does not apply to it. Stay silent
  only when the listed plugin does not fit the work itself, such as a matched word used in another sense. When no
  plugins are listed, never choose this kind. plugin is "" for every other kind.
Rung order: ${h.ladder.map((s) => s.name).join(" < ")}. ${h.rule}

Apart from plugin offers, aim to speak on fewer than one prompt in ten; an earlier correction the assistant has since handled is not a reason. Do not speak because a session is long, because the user is terse, or because a single tool call failed.
If you spoke recently, speak again only if something new happened. Write note as an instruction to the
assistant (one or two sentences, naming no command: the command is added for you) and reason as a few words
for the user saying why. Empty strings when speak=false.`;

const REVIEW_TASK = `You maintain profile.md in this folder: what a small session judge should know about this user to
decide when to suggest a different model or effort, or a restatement. Read log.jsonl (verdicts, deliveries, and
outcomes: whether the user changed rung after a suggestion) and the current profile.md. Then rewrite profile.md:
keep what the outcomes support, drop or soften what they contradict (suggestions the user ignored), add patterns
you can see. A plugin the log shows was suggested over a week ago with no install outcome is a no: note it. Keep it
under 60 lines, plain statements, no history. Finally write review-note.txt: one sentence
saying what changed and why, for the user. Change no other file.`;

// Friction phrases in the user's prompts, English and Indonesian.
const FRICTION = new RegExp([
  "not what (i|you) (meant|mean|asked|want)", "that'?s not (it|what)", "what do you mean",
  "(i )?(don'?t|do not) understand", "doesn'?t make sense", "makes no sense",
  "still (broken|wrong|not |doesn'?t|fail|the same|happen)", "(you|it) keeps? ",
  "i (already )?(told|said)", "as i said", "wrong again", "again\\?", "why (did|would) you",
  "bukan (itu|begitu|ini|gitu)", "masih (salah|error|gagal|belum|tidak|gak|sama)",
  "(aku|saya) (sudah|udah) (bilang|kasih tahu)", "gak (ngerti|paham)", "tidak (paham|mengerti)",
  "salah lagi", "maksud(ku|nya|mu| saya| aku)?\\b[^.]{0,40}\\?",
].join("|"), "i");

// ---- small helpers -------------------------------------------------------------------------------

/** First n code points, as Python's s[:n] does. */
export const clip = (s: string, n: number) => { const c = Array.from(s); return c.length > n ? c.slice(0, n).join("") : s; };
const longer = (s: string, n: number) => Array.from(s).length > n;

/** Local time like Python's datetime.now().isoformat(timespec="seconds"). */
function now() {
  const d = new Date(), p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function log(row: Record<string, unknown>) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify({ t: now(), ...row }) + "\n");
}

function jread<T>(file: string, dflt: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return dflt; }
}

function jwrite(file: string, v: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v));
}

const expand = (p: string) => (p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p);

/** Python's fnmatch on POSIX: case-sensitive, and * also matches "/". */
export function fnmatch(name: string, pat: string) {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const j = pat.indexOf("]", i + 2);
      if (j < 0) { re += "\\["; continue; }
      let set = pat.slice(i + 1, j).replace(/\\/g, "\\\\");
      if (set[0] === "!") set = "^" + set.slice(1);
      else if (set[0] === "^") set = "\\" + set;
      re += `[${set}]`;
      i = j;
    } else re += c.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s").test(name);
}

const rel = (p: string, cwd: string) => path.relative(cwd, p) || ".";

// ---- config --------------------------------------------------------------------------------------

type Config = { stakes?: { path: string; globs: string[] }[]; catalog?: Entry[] } & Record<string, { judges?: Judge[]; reviewer?: Judge } | undefined>;
const config = (): Config => jread(path.join(DIR, "config.json"), {});

/** The shipped catalog plus the user's own entries; a user entry replaces a shipped one of the same name. */
export function catalog(): Entry[] {
  const mine = config().catalog || [], names = new Set(mine.map((e) => e.name));
  return [...(CATALOG as Entry[]).filter((e) => !names.has(e.name)), ...mine];
}

export function stakesGlobs(cwd: string): string[] {
  return (config().stakes || []).filter((r) => fnmatch(cwd, expand(r.path)))
    .flatMap((r) => r.globs.map((g) => (g.startsWith("/") || g.startsWith("~") ? expand(g) : path.join(cwd, g))));
}

const own = (h: Harness) => (config()[h.id] || {}) as { judges?: Judge[]; reviewer?: Judge };
const judgesOf = (h: Harness): Judge[] => own(h).judges || [{ harness: h.id, model: h.judge }];
const reviewerOf = (h: Harness): Judge => own(h).reviewer || { harness: h.id, model: h.reviewer };

/** Ask one judge. ponytail: only this harness can answer; the cross-harness fallback comes with the second harness. */
function ask(h: Harness, j: Judge, prompt: string) {
  if (j.harness !== h.id) throw new Error(`judge harness "${j.harness}" is not built yet`);
  return h.ask(j.model, system(h), prompt, schema(h));
}

// ---- signals and prompt --------------------------------------------------------------------------

const prompts = (ev: Event[]) => ev.filter((e) => e.kind === "user").length;

type Turn = { text: string | null; errors: number; edits: string[]; paths: string[] };

/** Mechanical signals over the last WINDOW prompts, the stakes paths touched, and the latest rung. */
export function signals(ev: Event[], prompt: string, globs: string[]) {
  const turns: Turn[] = [];
  let cur: Turn = { text: null, errors: 0, edits: [], paths: [] };
  let rung: Rung = [null, null];
  for (const e of ev) {
    if (e.kind === "user") { turns.push(cur); cur = { text: e.text, errors: 0, edits: [], paths: [] }; }
    else if (e.kind === "model") rung = [e.model, e.effort];
    else if (e.kind === "tool_error") cur.errors++;
    else if (e.kind === "tool" && e.path) { cur.paths.push(e.path); if (e.edit) cur.edits.push(e.path); }
  }
  turns.push(cur);
  const recent = turns.filter((t) => t.text !== null).slice(-(WINDOW - 1));
  const texts = [...recent.map((t) => t.text as string), prompt];
  const friction = texts.filter((x) => FRICTION.test(x)).length;
  const interrupts = texts.filter((x) => x.trim() === "[Request interrupted by user]").length;
  const errors = recent.reduce((a, t) => a + t.errors, 0);
  const edits = recent.flatMap((t) => t.edits);
  const rework = Math.max(0, ...[...new Set(edits)].map((p) => edits.filter((x) => x === p).length));
  const found: string[] = [];
  if (friction) found.push(`${friction} of the last ${texts.length} prompts push back on the answer`);
  if (interrupts) found.push(`${interrupts} interrupt(s)`);
  if (errors >= 6) found.push(`${errors} failed tool calls`);
  if (rework >= 6) found.push(`one file edited ${rework} times`);
  const touched = recent.slice(-2).flatMap((t) => t.paths);
  const stakes = [...new Set(globs.filter((g) => touched.some((p) => fnmatch(p, g))))].sort();
  return { found, stakes, rung, touched, texts: texts.filter(Boolean) };
}

/** The tail of the session as plain text. */
function tail(ev: Event[]) {
  const lines: [string, string][] = [];
  for (const e of ev) {
    if (e.kind === "user") lines.push(["USER", e.text]);
    else if (e.kind === "assistant" && e.text.trim()) lines.push(["ASSISTANT", e.text]);
    else if (e.kind === "tool") lines.push(["TOOL", `${e.name} ${e.path || clip(e.command || "", 120)}`]);
  }
  const starts = lines.flatMap(([who], i) => (who === "USER" ? [i] : []));
  const from = starts.length >= TAIL_PROMPTS ? starts[starts.length - TAIL_PROMPTS] : 0;
  return lines.slice(from).map(([who, s]) => `${who}: ${clip(s, CLIP)}${longer(s, CLIP) ? "…" : ""}`).join("\n");
}

type State = { spoke_at?: number; kind?: string; delivered_rung?: Rung; outcome_logged?: boolean };
type Offered = Record<string, { at: string; sid: string; installed?: boolean }>;
const OFFERED = path.join(STATE, "plugins.json");
export type Candidate = Entry & { install: string; why: string };

const matches = (re: string, s: string) => { try { return new RegExp(re, "i").test(s); } catch { return false; } };

/** Catalog entries the recent work points at that the user neither has nor was offered. With `record`, also logs
 * earlier offers that the user has since installed. */
function candidates(h: Harness, cwd: string, sid: string, touched: string[], texts: string[], record: boolean): Candidate[] {
  const offered = jread<Offered>(OFFERED, {});
  const hits: Candidate[] = [];
  for (const e of catalog()) {
    const s = section(e, h);
    if (!s || offered[e.name]) continue;
    // only the project's own files: Claude Code's memory and plan files under ~/.claude are .md too
    const file = touched.find((p) => !rel(p, cwd).startsWith("..") && e.signals.files.some((g) => fnmatch(path.basename(p), g) || fnmatch(p, g)));
    const said = texts.find((t) => e.signals.prompts.some((re) => matches(re, t)));
    if (file || said) hits.push({ ...e, install: s.install, why: file ? `the session touched ${rel(file, cwd)}` : `a prompt said "${clip(said!.trim(), 80)}"` });
  }
  // an offer still not installed after a week is a no, which the weekly review records; stop checking it
  const waiting = record ? Object.keys(offered).filter((n) => offered[n].installed === undefined
    && Date.now() - new Date(offered[n].at).getTime() < REVIEW_EVERY * 1000) : [];
  if (!hits.length && !waiting.length) return [];
  const have = h.installed();
  if (!have) return [];
  const names = new Set(have.map((id) => id.split("@")[0]));
  const has = (e: Entry) => names.has(e.name) || have.includes(section(e, h)?.id ?? "");
  const later = waiting.filter((n) => names.has(n));
  if (later.length) {
    for (const n of later) {
      log({ event: "outcome", sid, kind: "plugin", plugin: n, changed: true });
      offered[n].installed = true;
    }
    jwrite(OFFERED, offered);
  }
  return hits.filter((e) => !has(e) && !(e.conflicts || []).some((c) => names.has(c)));
}

export function judgePrompt(h: Harness, ev: Event[], cwd: string, sid: string, record = false) {
  const n = prompts(ev);
  const globs = stakesGlobs(cwd);
  let { found, stakes, rung, touched, texts } = signals(ev, "", globs);
  const cands = candidates(h, cwd, sid, touched, texts, record);
  if (!rung[0]) rung = h.savedRung();
  const st = jread<State>(path.join(STATE, `${sid}.json`), {});
  const spoke = st.spoke_at !== undefined ? `You last spoke ${n - st.spoke_at} prompt(s) ago: ${st.kind}.` : "You have not spoken yet.";
  const profile = fs.existsSync(PROFILE) ? fs.readFileSync(PROFILE, "utf8") : "(none)";
  const prompt = `Profile of this user (maintained from past outcomes):\n${profile}\n\n`
    + `Folder: ${cwd}\nStakes paths here: ${globs.map((g) => rel(g, cwd)).join(", ") || "none declared"}\n`
    + `Stakes paths touched in the last two prompts: ${stakes.map((s) => rel(s, cwd)).join(", ") || "none"}\n`
    + `Current rung: ${rung[0] ?? "unknown"} at ${rung[1] || "default"} effort\n`
    + `Mechanical signals: ${found.join("; ") || "none"}\n${spoke}\n`
    + (cands.length ? `Plugins the work points at, which the user does not have:\n${cands.map((c) => `- ${c.name}: ${c.for} (${c.why})`).join("\n")}\n` : "")
    + `\n`
    + `Transcript tail (prompt ${n} is the latest):\n${tail(ev)}`;
  return { n, rung, st, prompt, cands };
}

const HEAD: Record<string, string> = { struggle: "This might go better with", stakes: "This one is worth", lighter: "This looks routine enough for" };
const blank = (s: string | undefined) => /^[\s"'`\u2018\u2019\u201c\u201d.]*$/.test(s ?? "");

/** The line the agent ends its reply with, built from the judge's rung, or why the verdict is dropped. */
export function settle(h: Harness, v: Verdict, rung: Rung, cands: Candidate[]): { line: string; dropped?: string } {
  const why = blank(v.reason) ? "" : `: ${v.reason.trim().replace(/[.\s]+$/, "")}`;
  if (v.speak && v.kind === "plugin") {
    const c = cands.find((x) => x.name === v.plugin);
    if (!c) return { line: "", dropped: `plugin "${v.plugin}" is not a candidate for this session` };
    return { line: `This work could use the ${c.name} plugin (${c.for})${why}. To add it: ${c.install}.` };
  }
  if (!v.speak || !HEAD[v.kind]) return { line: "" }; // none and misread carry no command
  const to = h.ladder.find((s) => s.name === v.to);
  const cur = h.place(rung), next = to && h.place([to.model, to.effort]);
  if (!to || next == null) return { line: "", dropped: `no rung "${v.to}" on the ladder` };
  if (cur === null) return { line: "", dropped: `current rung ${rung.join(" ")} is not on the ladder` };
  if (v.kind === "lighter" ? next >= cur : next <= cur) return { line: "", dropped: `${v.kind}: ${to.name} points the wrong way` };
  return { line: `${HEAD[v.kind]} ${h.command(rung, to)}${why}.` };
}

// ---- modes ---------------------------------------------------------------------------------------

type HookInput = { session_id?: string; transcript_path?: string; cwd?: string };

/** Stop hook: start the judge in the background and return at once. */
export function stop(h: Harness, inp: HookInput) {
  const args = [process.argv[1], h.id, "judge", JSON.stringify(inp)];
  fs.mkdirSync(DIR, { recursive: true });
  spawn(process.execPath, args, { cwd: DIR, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** The judge itself: read the transcript tail, ask the judge list in order, keep a verdict worth saying. */
export function judge(h: Harness, inp: HookInput) {
  const sid = inp.session_id || "x", cwd = inp.cwd || process.cwd();
  const { events: ev } = h.read(inp.transcript_path || "");
  if (prompts(ev) < 2) return;
  const { n, rung, st, prompt, cands } = judgePrompt(h, ev, cwd, sid, true);
  if (st.delivered_rung && !st.outcome_logged) { // did the user take the last suggestion?
    const changed = JSON.stringify(st.delivered_rung) !== JSON.stringify(rung);
    log({ event: "outcome", sid, kind: st.kind, before: st.delivered_rung, after: rung, changed });
    jwrite(path.join(STATE, `${sid}.json`), { ...st, outcome_logged: true });
  }
  let last = 0;
  ev.forEach((e, i) => { if (e.kind === "user") last = i; });
  if (ev.slice(last).some((e) => e.kind === "usage_limit")) {
    log({ event: "skipped", sid, reason: "usage limit note in this turn" });
    return;
  }
  for (const j of judgesOf(h)) {
    let r;
    try {
      r = ask(h, j, prompt);
    } catch (e) { // never break the session over the judge; try the next judge
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof UsageLimit) log({ event: "skipped", sid, judge: label(j), reason: `usage limit: ${msg}`.slice(0, 300) });
      else log({ event: "error", sid, judge: label(j), error: String(e).slice(0, 300) });
      continue;
    }
    const { v, secs, cost } = r;
    const s = settle(h, v, rung, cands);
    log({ event: "verdict", sid, cwd, prompt_n: n, rung, judge: label(j), secs, cost, ...v, ...s });
    if (v.speak && v.kind !== "none" && !s.dropped) jwrite(path.join(PENDING, `${sid}.json`), { ...v, ...s, prompt_n: n, rung });
    return;
  }
}

/** Prompt-submit hook: hand a pending verdict to the agent. Returns the context text, or null. */
export function inject(h: Harness, inp: HookInput): string | null {
  const sid = inp.session_id || "x";
  const file = path.join(PENDING, `${sid}.json`);
  const v = jread<(Verdict & { line: string; prompt_n: number; rung: Rung }) | null>(file, null);
  if (!v) return null;
  fs.rmSync(file, { force: true });
  const n = prompts(h.read(inp.transcript_path || "").events);
  if (n - v.prompt_n > 2) return null; // judged too long ago to still apply
  jwrite(path.join(STATE, `${sid}.json`), { spoke_at: n, kind: v.kind, delivered_rung: v.rung });
  log({ event: "delivered", sid, kind: v.kind, line: v.line });
  if (v.kind === "plugin" && v.plugin) { // offered once per user, whatever the answer
    const offered = jread<Offered>(OFFERED, {});
    jwrite(OFFERED, { ...offered, [v.plugin]: { at: now(), sid } });
  }
  let ctx = `Session judge (the user's own hook, Xeef, which reviewed the last exchanges with a small model): ${v.note}`;
  if (v.line) ctx += ` If you agree after reading the user's new prompt, end your reply with one line: "${v.line}"`;
  return ctx + " If it plainly does not fit the new prompt, ignore it.";
}

/** Session-start hook: report the last review, and start a new one in the background once a week. */
export function review(h: Harness): string | null {
  fs.mkdirSync(DIR, { recursive: true });
  const note = path.join(DIR, "review-note.txt");
  let out: string | null = null;
  if (fs.existsSync(note)) {
    out = `Session judge weekly review: ${fs.readFileSync(note, "utf8").trim()} (profile: ${PROFILE}, `
      + "history in its git log). Mention this to the user in one line in your first reply.";
    fs.rmSync(note);
  }
  const last = jread<{ t?: number }>(path.join(DIR, "last-review.json"), {}).t || 0;
  const rows = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).length : 0;
  if (Date.now() / 1000 - last > REVIEW_EVERY && rows >= REVIEW_MIN_ROWS) {
    jwrite(path.join(DIR, "last-review.json"), { t: Date.now() / 1000 });
    spawn(process.execPath, [process.argv[1], h.id, "review-run"], { cwd: DIR, detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  return out;
}

/** The weekly review: a stronger model rewrites profile.md; git keeps the old versions. */
export function reviewRun(h: Harness) {
  const lock = path.join(DIR, "review.lock");
  try { // two rewrites at once are not safe; a lock older than an hour is left over from a crash
    if (Date.now() - fs.statSync(lock).mtimeMs < 3600_000) return;
    fs.rmSync(lock);
  } catch { /* no lock */ }
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); } catch { return; }
  try {
    const j = reviewerOf(h);
    if (j.harness !== h.id) throw new Error(`review harness "${j.harness}" is not built yet`);
    const r = h.review(j.model, REVIEW_TASK, DIR);
    log({ event: "review", judge: label(j), rc: r.rc, out: r.out.slice(-300) });
    const git = (...a: string[]) => spawnSync("git", a, { cwd: DIR, stdio: "ignore" });
    if (!git("--version").error && fs.existsSync(PROFILE)) {
      git("init", "-q");
      git("add", "profile.md");
      git("commit", "-qm", `weekly review ${now()}`);
    }
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** Judge k sampled points from past sessions (at least 4 prompts in) and print what each judge said. */
export function backtest(h: Harness, folder: string, k: number, dry: boolean) {
  let seed = 7; // mulberry32, so a rerun samples the same points
  const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const points: { file: string; ev: Event[]; i: number; at: number; cwd: string }[] = [];
  for (const name of fs.readdirSync(folder).filter((f) => f.endsWith(".jsonl")).sort()) {
    const { events: ev, cwd } = h.read(path.join(folder, name));
    const idx = ev.flatMap((e, i) => (e.kind === "user" ? [i] : []));
    idx.slice(4).forEach((i, j) => points.push({ file: name, ev, i, at: j + 4, cwd: cwd || "/" }));
  }
  for (let i = points.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [points[i], points[j]] = [points[j], points[i]]; }
  const sample = points.slice(0, Math.min(k, points.length));
  let spoke = 0;
  for (const p of sample) {
    const { prompt, rung, cands } = judgePrompt(h, p.ev.slice(0, p.i), p.cwd, "backtest");
    const head = { session: p.file.slice(0, 8), at: p.at, next_prompt: clip((p.ev[p.i] as { text: string }).text, 100) };
    if (dry) { console.log(JSON.stringify({ ...head, prompt })); continue; }
    const j = judgesOf(h)[0];
    try {
      const { v, secs, cost } = ask(h, j, prompt);
      spoke += Number(v.speak);
      console.log(JSON.stringify({ ...head, judge: label(j), secs, cost, rung, speak: v.speak, kind: v.kind, to: v.to, plugin: v.plugin, ...settle(h, v, rung, cands), evidence: v.evidence }));
    } catch (e) {
      console.log(JSON.stringify({ ...head, error: String(e).slice(0, 300) }));
    }
  }
  if (!dry) console.log(`spoke on ${spoke} of ${sample.length}`);
}
