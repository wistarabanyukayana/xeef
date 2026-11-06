"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var fs3 = __toESM(require("node:fs"));

// src/claude.ts
var import_node_child_process2 = require("node:child_process");
var fs2 = __toESM(require("node:fs"));
var os2 = __toESM(require("node:os"));
var path2 = __toESM(require("node:path"));

// src/core.ts
var import_node_child_process = require("node:child_process");
var fs = __toESM(require("node:fs"));
var os = __toESM(require("node:os"));
var path = __toESM(require("node:path"));

// catalog.json
var catalog_default = [
  {
    name: "impeccable",
    for: "UI design work: layout, typography and visual polish that does not look generated",
    signals: {
      files: ["*.css", "*.scss", "*.tsx", "*.jsx", "*.vue", "*.svelte", "*.html"],
      prompts: ["looks? (ai[- ]generated|generic|templat)", "too templat", "(ugly|bland|boring|cluttered) (ui|design|page|layout)"]
    },
    conflicts: ["frontend-design"],
    claude: { id: "impeccable@impeccable", install: "/plugin marketplace add pbakaus/impeccable, then /plugin install impeccable@impeccable" }
  },
  {
    name: "frontend-design",
    for: "bold, distinctive front-end design for landing pages and marketing sites",
    signals: {
      files: ["*.css", "*.scss", "*.tsx", "*.jsx", "*.vue", "*.svelte", "*.html"],
      prompts: ["landing page", "marketing (site|page)", "make it (pop|stand out|beautiful)", "more (bold|striking|distinctive)"]
    },
    conflicts: ["impeccable"],
    claude: { id: "frontend-design@claude-plugins-official", install: "/plugin install frontend-design@claude-plugins-official" }
  },
  {
    name: "rust-analyzer-lsp",
    for: "Rust code: go-to-definition, type and error checks through rust-analyzer (needs rust-analyzer on PATH)",
    signals: { files: ["*.rs", "*/Cargo.toml"], prompts: [] },
    claude: { id: "rust-analyzer-lsp@claude-plugins-official", install: "/plugin install rust-analyzer-lsp@claude-plugins-official" }
  },
  {
    name: "prose",
    for: "clear, plain writing in docs, READMEs, commit messages and chat replies",
    signals: {
      files: ["*.md", "*.mdx", "*.rst"],
      prompts: ["too (wordy|dense)", "too long to read", "plain(er)? (words|english)", "hard to (read|follow)", "(rewrite|clean up) (the )?(docs|readme)"]
    },
    claude: {
      id: "prose@fprochazka-claude-code-plugins",
      install: "/plugin marketplace add fprochazka/claude-code-plugins, then /plugin install prose@fprochazka-claude-code-plugins"
    }
  },
  {
    name: "humanizer",
    for: "rewriting text that sounds AI-written so it reads like a person wrote it",
    signals: {
      files: [],
      prompts: ["(sounds|reads|feels) (like )?(ai|chatgpt|robotic|generated)", "humani[sz]e", "ai[- ](sounding|written|slop)"]
    },
    claude: { id: "humanizer@humanizer", install: "/plugin marketplace add blader/humanizer, then /plugin install humanizer@humanizer" }
  },
  {
    name: "ponytail",
    for: "keeping code minimal: the simplest change that works, no speculative abstractions",
    signals: {
      files: [],
      prompts: ["over-?engineer", "too (complex|complicated|abstract)", "\\bbloat", "(simpler|simplify|less code)", "\\byagni\\b"]
    },
    claude: { id: "ponytail@ponytail", install: "/plugin marketplace add DietrichGebert/ponytail, then /plugin install ponytail@ponytail" }
  }
];

// src/core.ts
var DIR = process.env.XEEF_HOME || path.join(os.homedir(), ".xeef");
var PENDING = path.join(DIR, "pending");
var STATE = path.join(DIR, "state");
var LOG = path.join(DIR, "log.jsonl");
var PROFILE = path.join(DIR, "profile.md");
var TAIL_PROMPTS = 8;
var CLIP = 700;
var WINDOW = 6;
var REVIEW_EVERY = 7 * 86400;
var REVIEW_MIN_ROWS = 30;
var section = (e, h2) => e[h2.id];
var UsageLimit = class extends Error {
};
var label = (j) => `${j.harness}:${j.model}`;
var schema = (h2) => ({ type: "object", required: ["speak", "kind", "note", "to", "plugin", "reason", "evidence"], properties: {
  speak: { type: "boolean" },
  kind: { type: "string", enum: ["none", "misread", "struggle", "stakes", "lighter", "plugin"] },
  note: { type: "string" },
  to: { type: "string", enum: ["", ...h2.ladder.map((s) => s.name)] },
  plugin: { type: "string", enum: ["", ...catalog().map((e) => e.name)] },
  reason: { type: "string" },
  evidence: { type: "string" }
} });
var system = (h2) => `You watch a coding session between a user and an AI assistant (${h2.name}) and decide whether the
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
Rung order: ${h2.ladder.map((s) => s.name).join(" < ")}. ${h2.rule}

Apart from plugin offers, aim to speak on fewer than one prompt in ten; an earlier correction the assistant has since handled is not a reason. Do not speak because a session is long, because the user is terse, or because a single tool call failed.
If you spoke recently, speak again only if something new happened. Write note as an instruction to the
assistant (one or two sentences, naming no command: the command is added for you) and reason as a few words
for the user saying why. Empty strings when speak=false.`;
var REVIEW_TASK = `You maintain profile.md in this folder: what a small session judge should know about this user to
decide when to suggest a different model or effort, or a restatement. Read log.jsonl (verdicts, deliveries, and
outcomes: whether the user changed rung after a suggestion) and the current profile.md. Then rewrite profile.md:
keep what the outcomes support, drop or soften what they contradict (suggestions the user ignored), add patterns
you can see. A plugin the log shows was suggested over a week ago with no install outcome is a no: note it. Keep it
under 60 lines, plain statements, no history. Finally write review-note.txt: one sentence
saying what changed and why, for the user. Change no other file.`;
var FRICTION = new RegExp([
  "not what (i|you) (meant|mean|asked|want)",
  "that'?s not (it|what)",
  "what do you mean",
  "(i )?(don'?t|do not) understand",
  "doesn'?t make sense",
  "makes no sense",
  "still (broken|wrong|not |doesn'?t|fail|the same|happen)",
  "(you|it) keeps? ",
  "i (already )?(told|said)",
  "as i said",
  "wrong again",
  "again\\?",
  "why (did|would) you",
  "bukan (itu|begitu|ini|gitu)",
  "masih (salah|error|gagal|belum|tidak|gak|sama)",
  "(aku|saya) (sudah|udah) (bilang|kasih tahu)",
  "gak (ngerti|paham)",
  "tidak (paham|mengerti)",
  "salah lagi",
  "maksud(ku|nya|mu| saya| aku)?\\b[^.]{0,40}\\?"
].join("|"), "i");
var clip = (s, n) => {
  const c = Array.from(s);
  return c.length > n ? c.slice(0, n).join("") : s;
};
var longer = (s, n) => Array.from(s).length > n;
function now() {
  const d = /* @__PURE__ */ new Date(), p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(row) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify({ t: now(), ...row }) + "\n");
}
function jread(file, dflt) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return dflt;
  }
}
function jwrite(file, v) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(v));
}
var expand = (p) => p === "~" || p.startsWith("~/") ? os.homedir() + p.slice(1) : p;
function fnmatch(name, pat) {
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else if (c === "[") {
      const j = pat.indexOf("]", i + 2);
      if (j < 0) {
        re += "\\[";
        continue;
      }
      let set = pat.slice(i + 1, j).replace(/\\/g, "\\\\");
      if (set[0] === "!") set = "^" + set.slice(1);
      else if (set[0] === "^") set = "\\" + set;
      re += `[${set}]`;
      i = j;
    } else re += c.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "s").test(name);
}
var rel = (p, cwd) => path.relative(cwd, p) || ".";
var config = () => jread(path.join(DIR, "config.json"), {});
function catalog() {
  const mine = config().catalog || [], names = new Set(mine.map((e) => e.name));
  return [...catalog_default.filter((e) => !names.has(e.name)), ...mine];
}
function stakesGlobs(cwd) {
  return (config().stakes || []).filter((r) => fnmatch(cwd, expand(r.path))).flatMap((r) => r.globs.map((g) => g.startsWith("/") || g.startsWith("~") ? expand(g) : path.join(cwd, g)));
}
var own = (h2) => config()[h2.id] || {};
var judgesOf = (h2) => own(h2).judges || [{ harness: h2.id, model: h2.judge }];
var reviewerOf = (h2) => own(h2).reviewer || { harness: h2.id, model: h2.reviewer };
function ask(h2, j, prompt) {
  if (j.harness !== h2.id) throw new Error(`judge harness "${j.harness}" is not built yet`);
  return h2.ask(j.model, system(h2), prompt, schema(h2));
}
var prompts = (ev) => ev.filter((e) => e.kind === "user").length;
function signals(ev, prompt, globs) {
  const turns = [];
  let cur = { text: null, errors: 0, edits: [], paths: [] };
  let rung = [null, null];
  for (const e of ev) {
    if (e.kind === "user") {
      turns.push(cur);
      cur = { text: e.text, errors: 0, edits: [], paths: [] };
    } else if (e.kind === "model") rung = [e.model, e.effort];
    else if (e.kind === "tool_error") cur.errors++;
    else if (e.kind === "tool" && e.path) {
      cur.paths.push(e.path);
      if (e.edit) cur.edits.push(e.path);
    }
  }
  turns.push(cur);
  const recent = turns.filter((t) => t.text !== null).slice(-(WINDOW - 1));
  const texts = [...recent.map((t) => t.text), prompt];
  const friction = texts.filter((x) => FRICTION.test(x)).length;
  const interrupts = texts.filter((x) => x.trim() === "[Request interrupted by user]").length;
  const errors = recent.reduce((a, t) => a + t.errors, 0);
  const edits = recent.flatMap((t) => t.edits);
  const rework = Math.max(0, ...[...new Set(edits)].map((p) => edits.filter((x) => x === p).length));
  const found = [];
  if (friction) found.push(`${friction} of the last ${texts.length} prompts push back on the answer`);
  if (interrupts) found.push(`${interrupts} interrupt(s)`);
  if (errors >= 6) found.push(`${errors} failed tool calls`);
  if (rework >= 6) found.push(`one file edited ${rework} times`);
  const touched = recent.slice(-2).flatMap((t) => t.paths);
  const stakes = [...new Set(globs.filter((g) => touched.some((p) => fnmatch(p, g))))].sort();
  return { found, stakes, rung, touched, texts: texts.filter(Boolean) };
}
function tail(ev) {
  const lines = [];
  for (const e of ev) {
    if (e.kind === "user") lines.push(["USER", e.text]);
    else if (e.kind === "assistant" && e.text.trim()) lines.push(["ASSISTANT", e.text]);
    else if (e.kind === "tool") lines.push(["TOOL", `${e.name} ${e.path || clip(e.command || "", 120)}`]);
  }
  const starts = lines.flatMap(([who], i) => who === "USER" ? [i] : []);
  const from = starts.length >= TAIL_PROMPTS ? starts[starts.length - TAIL_PROMPTS] : 0;
  return lines.slice(from).map(([who, s]) => `${who}: ${clip(s, CLIP)}${longer(s, CLIP) ? "\u2026" : ""}`).join("\n");
}
var OFFERED = path.join(STATE, "plugins.json");
var matches = (re, s) => {
  try {
    return new RegExp(re, "i").test(s);
  } catch {
    return false;
  }
};
function candidates(h2, cwd, sid, touched, texts, record) {
  const offered = jread(OFFERED, {});
  const hits = [];
  for (const e of catalog()) {
    const s = section(e, h2);
    if (!s || offered[e.name]) continue;
    const file = touched.find((p) => !rel(p, cwd).startsWith("..") && e.signals.files.some((g) => fnmatch(path.basename(p), g) || fnmatch(p, g)));
    const said = texts.find((t) => e.signals.prompts.some((re) => matches(re, t)));
    if (file || said) hits.push({ ...e, install: s.install, why: file ? `the session touched ${rel(file, cwd)}` : `a prompt said "${clip(said.trim(), 80)}"` });
  }
  const waiting = record ? Object.keys(offered).filter((n) => offered[n].installed === void 0 && Date.now() - new Date(offered[n].at).getTime() < REVIEW_EVERY * 1e3) : [];
  if (!hits.length && !waiting.length) return [];
  const have = h2.installed();
  if (!have) return [];
  const names = new Set(have.map((id2) => id2.split("@")[0]));
  const has = (e) => names.has(e.name) || have.includes(section(e, h2)?.id ?? "");
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
function judgePrompt(h2, ev, cwd, sid, record = false) {
  const n = prompts(ev);
  const globs = stakesGlobs(cwd);
  let { found, stakes, rung, touched, texts } = signals(ev, "", globs);
  const cands = candidates(h2, cwd, sid, touched, texts, record);
  if (!rung[0]) rung = h2.savedRung();
  const st = jread(path.join(STATE, `${sid}.json`), {});
  const spoke = st.spoke_at !== void 0 ? `You last spoke ${n - st.spoke_at} prompt(s) ago: ${st.kind}.` : "You have not spoken yet.";
  const profile = fs.existsSync(PROFILE) ? fs.readFileSync(PROFILE, "utf8") : "(none)";
  const prompt = `Profile of this user (maintained from past outcomes):
${profile}

Folder: ${cwd}
Stakes paths here: ${globs.map((g) => rel(g, cwd)).join(", ") || "none declared"}
Stakes paths touched in the last two prompts: ${stakes.map((s) => rel(s, cwd)).join(", ") || "none"}
Current rung: ${rung[0] ?? "unknown"} at ${rung[1] || "default"} effort
Mechanical signals: ${found.join("; ") || "none"}
${spoke}
` + (cands.length ? `Plugins the work points at, which the user does not have:
${cands.map((c) => `- ${c.name}: ${c.for} (${c.why})`).join("\n")}
` : "") + `
Transcript tail (prompt ${n} is the latest):
${tail(ev)}`;
  return { n, rung, st, prompt, cands };
}
var HEAD = { struggle: "This might go better with", stakes: "This one is worth", lighter: "This looks routine enough for" };
var blank = (s) => /^[\s"'`\u2018\u2019\u201c\u201d.]*$/.test(s ?? "");
function settle(h2, v, rung, cands) {
  const why = blank(v.reason) ? "" : `: ${v.reason.trim().replace(/[.\s]+$/, "")}`;
  if (v.speak && v.kind === "plugin") {
    const c = cands.find((x) => x.name === v.plugin);
    if (!c) return { line: "", dropped: `plugin "${v.plugin}" is not a candidate for this session` };
    return { line: `This work could use the ${c.name} plugin (${c.for})${why}. To add it: ${c.install}.` };
  }
  if (!v.speak || !HEAD[v.kind]) return { line: "" };
  const to = h2.ladder.find((s) => s.name === v.to);
  const cur = h2.place(rung), next = to && h2.place([to.model, to.effort]);
  if (!to || next == null) return { line: "", dropped: `no rung "${v.to}" on the ladder` };
  if (cur === null) return { line: "", dropped: `current rung ${rung.join(" ")} is not on the ladder` };
  if (v.kind === "lighter" ? next >= cur : next <= cur) return { line: "", dropped: `${v.kind}: ${to.name} points the wrong way` };
  return { line: `${HEAD[v.kind]} ${h2.command(rung, to)}${why}.` };
}
function stop(h2, inp) {
  const args = [process.argv[1], h2.id, "judge", JSON.stringify(inp)];
  fs.mkdirSync(DIR, { recursive: true });
  (0, import_node_child_process.spawn)(process.execPath, args, { cwd: DIR, detached: true, stdio: "ignore", windowsHide: true }).unref();
}
function judge(h2, inp) {
  const sid = inp.session_id || "x", cwd = inp.cwd || process.cwd();
  const { events: ev } = h2.read(inp.transcript_path || "");
  if (prompts(ev) < 2) return;
  const { n, rung, st, prompt, cands } = judgePrompt(h2, ev, cwd, sid, true);
  if (st.delivered_rung && !st.outcome_logged) {
    const changed = JSON.stringify(st.delivered_rung) !== JSON.stringify(rung);
    log({ event: "outcome", sid, kind: st.kind, before: st.delivered_rung, after: rung, changed });
    jwrite(path.join(STATE, `${sid}.json`), { ...st, outcome_logged: true });
  }
  let last = 0;
  ev.forEach((e, i) => {
    if (e.kind === "user") last = i;
  });
  if (ev.slice(last).some((e) => e.kind === "usage_limit")) {
    log({ event: "skipped", sid, reason: "usage limit note in this turn" });
    return;
  }
  for (const j of judgesOf(h2)) {
    let r;
    try {
      r = ask(h2, j, prompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof UsageLimit) log({ event: "skipped", sid, judge: label(j), reason: `usage limit: ${msg}`.slice(0, 300) });
      else log({ event: "error", sid, judge: label(j), error: String(e).slice(0, 300) });
      continue;
    }
    const { v, secs, cost } = r;
    const s = settle(h2, v, rung, cands);
    log({ event: "verdict", sid, cwd, prompt_n: n, rung, judge: label(j), secs, cost, ...v, ...s });
    if (v.speak && v.kind !== "none" && !s.dropped) jwrite(path.join(PENDING, `${sid}.json`), { ...v, ...s, prompt_n: n, rung });
    return;
  }
}
function inject(h2, inp) {
  const sid = inp.session_id || "x";
  const file = path.join(PENDING, `${sid}.json`);
  const v = jread(file, null);
  if (!v) return null;
  fs.rmSync(file, { force: true });
  const n = prompts(h2.read(inp.transcript_path || "").events);
  if (n - v.prompt_n > 2) return null;
  jwrite(path.join(STATE, `${sid}.json`), { spoke_at: n, kind: v.kind, delivered_rung: v.rung });
  log({ event: "delivered", sid, kind: v.kind, line: v.line });
  if (v.kind === "plugin" && v.plugin) {
    const offered = jread(OFFERED, {});
    jwrite(OFFERED, { ...offered, [v.plugin]: { at: now(), sid } });
  }
  let ctx = `Session judge (the user's own hook, Xeef, which reviewed the last exchanges with a small model): ${v.note}`;
  if (v.line) ctx += ` If you agree after reading the user's new prompt, end your reply with one line: "${v.line}"`;
  return ctx + " If it plainly does not fit the new prompt, ignore it.";
}
function review(h2) {
  fs.mkdirSync(DIR, { recursive: true });
  const note = path.join(DIR, "review-note.txt");
  let out = null;
  if (fs.existsSync(note)) {
    out = `Session judge weekly review: ${fs.readFileSync(note, "utf8").trim()} (profile: ${PROFILE}, history in its git log). Mention this to the user in one line in your first reply.`;
    fs.rmSync(note);
  }
  const last = jread(path.join(DIR, "last-review.json"), {}).t || 0;
  const rows = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean).length : 0;
  if (Date.now() / 1e3 - last > REVIEW_EVERY && rows >= REVIEW_MIN_ROWS) {
    jwrite(path.join(DIR, "last-review.json"), { t: Date.now() / 1e3 });
    (0, import_node_child_process.spawn)(process.execPath, [process.argv[1], h2.id, "review-run"], { cwd: DIR, detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  return out;
}
function reviewRun(h2) {
  const lock = path.join(DIR, "review.lock");
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < 36e5) return;
    fs.rmSync(lock);
  } catch {
  }
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    return;
  }
  try {
    const j = reviewerOf(h2);
    if (j.harness !== h2.id) throw new Error(`review harness "${j.harness}" is not built yet`);
    const r = h2.review(j.model, REVIEW_TASK, DIR);
    log({ event: "review", judge: label(j), rc: r.rc, out: r.out.slice(-300) });
    const git = (...a) => (0, import_node_child_process.spawnSync)("git", a, { cwd: DIR, stdio: "ignore" });
    if (!git("--version").error && fs.existsSync(PROFILE)) {
      git("init", "-q");
      git("add", "profile.md");
      git("commit", "-qm", `weekly review ${now()}`);
    }
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
function backtest(h2, folder, k, dry) {
  let seed = 7;
  const rand = () => {
    seed = seed + 1831565813 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const points = [];
  for (const name of fs.readdirSync(folder).filter((f) => f.endsWith(".jsonl")).sort()) {
    const { events: ev, cwd } = h2.read(path.join(folder, name));
    const idx = ev.flatMap((e, i) => e.kind === "user" ? [i] : []);
    idx.slice(4).forEach((i, j) => points.push({ file: name, ev, i, at: j + 4, cwd: cwd || "/" }));
  }
  for (let i = points.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  const sample = points.slice(0, Math.min(k, points.length));
  let spoke = 0;
  for (const p of sample) {
    const { prompt, rung, cands } = judgePrompt(h2, p.ev.slice(0, p.i), p.cwd, "backtest");
    const head = { session: p.file.slice(0, 8), at: p.at, next_prompt: clip(p.ev[p.i].text, 100) };
    if (dry) {
      console.log(JSON.stringify({ ...head, prompt }));
      continue;
    }
    const j = judgesOf(h2)[0];
    try {
      const { v, secs, cost } = ask(h2, j, prompt);
      spoke += Number(v.speak);
      console.log(JSON.stringify({ ...head, judge: label(j), secs, cost, rung, speak: v.speak, kind: v.kind, to: v.to, plugin: v.plugin, ...settle(h2, v, rung, cands), evidence: v.evidence }));
    } catch (e) {
      console.log(JSON.stringify({ ...head, error: String(e).slice(0, 300) }));
    }
  }
  if (!dry) console.log(`spoke on ${spoke} of ${sample.length}`);
}

// src/claude.ts
var SKIP = ["<command-", "<local-command", "<system-reminder", "<task-notification", "<bash-", "This session is being continued"];
var EDITS = ["Edit", "Write", "MultiEdit"];
var NO_HOOKS = JSON.stringify({ disableAllHooks: true });
var ALIASES = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" };
var FAMILIES = ["haiku", "sonnet", "opus", "fable"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var ARG = { haiku: "haiku", sonnet: "sonnet", opus: "opus", fable: "claude-fable-5-1" };
var step = (name) => {
  const [model, effort = null] = name.split(" ");
  return { name, model, effort };
};
var family = (model) => FAMILIES.find((f) => (model || "").includes(f));
var hasEffort = (f) => f === "sonnet" || f === "opus";
var effortOf = (e) => e || "high";
function place([model, effort]) {
  const f = family(model);
  if (!f) return null;
  return FAMILIES.indexOf(f) * 10 + (hasEffort(f) ? EFFORTS.indexOf(effortOf(effort)) + 1 : 0);
}
function command(from, to) {
  const same = family(from[0]) === to.model, out = [];
  if (!same) out.push(`/model ${ARG[to.model]}`);
  if (to.effort && (!same || to.effort !== effortOf(from[1]))) out.push(`/effort ${to.effort}`);
  return out.join(" then ");
}
function typed(e) {
  if (e.type !== "user" || e.isMeta) return null;
  let c = e.message?.content;
  if (Array.isArray(c)) {
    const blocks = c.filter((b) => !!b && typeof b === "object");
    if (blocks.some((b) => b.type === "tool_result")) return null;
    c = blocks.map((b) => b.text ?? "").join(" ");
  }
  if (typeof c !== "string" || SKIP.some((s) => c.trimStart().startsWith(s))) return null;
  return c;
}
function read(file) {
  const events = [];
  let cwd;
  let text = "";
  try {
    text = fs2.readFileSync(file, "utf8");
  } catch {
    return { events };
  }
  for (const line of text.split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object") continue;
    cwd ||= e.cwd;
    const t = typed(e);
    if (t !== null) {
      events.push({ kind: "user", text: t });
      continue;
    }
    if (e.usageLimitNote) events.push({ kind: "usage_limit" });
    if (e.requestedModel) events.push({ kind: "model", model: e.requestedModel, effort: e.perTurnEffort || e.effort || null });
    const c = e.type === "user" || e.type === "assistant" ? e.message?.content : null;
    for (const b of Array.isArray(c) ? c : []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_result" && b.is_error) events.push({ kind: "tool_error" });
      else if (b.type === "text" && e.type === "assistant" && typeof b.text === "string") events.push({ kind: "assistant", text: b.text });
      else if (b.type === "tool_use") {
        const inp = b.input || {};
        events.push({
          kind: "tool",
          name: String(b.name),
          path: inp.file_path || void 0,
          command: typeof inp.command === "string" ? inp.command : void 0,
          edit: EDITS.includes(String(b.name))
        });
      }
    }
  }
  return { events, cwd };
}
function savedRung() {
  let s;
  try {
    s = JSON.parse(fs2.readFileSync(path2.join(os2.homedir(), ".claude", "settings.json"), "utf8"));
  } catch {
    return [null, null];
  }
  const m = s.model || "opus", full = ALIASES[m] || m;
  return [full, s.modelSettings?.[full]?.effortLevel || s.effortLevel || null];
}
var inner = { ...process.env, XEEF_INNER: "1" };
function ask2(model, system2, prompt, schema2) {
  const t0 = Date.now();
  const r = (0, import_node_child_process2.spawnSync)(
    "claude",
    [
      "-p",
      "--model",
      model,
      "--no-session-persistence",
      "--tools",
      "",
      "--settings",
      NO_HOOKS,
      "--system-prompt",
      system2,
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema2)
    ],
    { input: prompt, encoding: "utf8", timeout: 9e4, env: inner, maxBuffer: 16 << 20 }
  );
  if (r.error) throw new Error(`claude: ${r.error.message}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = { is_error: true, result: r.stdout };
  }
  if (r.status || out.is_error) {
    const msg = `rc=${r.status} ${out.result || ""} ${r.stderr}`.trim().slice(-300);
    throw new (msg.toLowerCase().includes("limit") ? UsageLimit : Error)(msg);
  }
  const v = out.structured_output ?? JSON.parse(out.result || "{}");
  return { v, secs: Math.round((Date.now() - t0) / 100) / 10, cost: out.total_cost_usd };
}
function review2(model, task, cwd) {
  const r = (0, import_node_child_process2.spawnSync)("claude", [
    "-p",
    "--model",
    model,
    "--no-session-persistence",
    "--tools",
    "Read,Write,Edit",
    "--permission-mode",
    "acceptEdits",
    "--settings",
    NO_HOOKS,
    task
  ], { cwd, encoding: "utf8", timeout: 9e5, env: inner });
  return { rc: r.status, out: r.stdout || r.error?.message || "" };
}
function installed() {
  const r = (0, import_node_child_process2.spawnSync)("claude", ["plugin", "list", "--json"], { cwd: os2.homedir(), encoding: "utf8", timeout: 15e3, env: inner });
  try {
    return JSON.parse(r.stdout).map((p) => p.id);
  } catch {
    return null;
  }
}
var claude = {
  id: "claude",
  name: "Claude Code",
  ladder: ["haiku", "sonnet low", "sonnet medium", "sonnet high", "opus low", "opus medium", "opus high", "opus xhigh", "fable"].map(step),
  rule: "Anthropic's rule: if effort was lowered, restore it first; otherwise go one tier up.",
  place,
  command,
  judge: "haiku",
  reviewer: "sonnet",
  read,
  savedRung,
  ask: ask2,
  review: review2,
  installed
};

// src/cli.ts
var HARNESSES = { claude };
var [id, mode, ...rest] = process.argv.slice(2);
var h = HARNESSES[id];
function hookInput() {
  try {
    return JSON.parse(rest[0] ?? fs3.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}
function say(event, ctx) {
  if (ctx) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: ctx } }));
}
if (!h || !mode) {
  console.error("usage: xeef claude <stop|judge|inject|review|review-run|backtest DIR N [--dry]>");
  process.exit(2);
}
if (process.env.XEEF_INNER && mode !== "backtest") process.exit(0);
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
  console.error(`xeef: ${e instanceof Error ? e.stack : e}`);
}
