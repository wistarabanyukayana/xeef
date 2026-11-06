# Xeef spec

Xeef (say "zeef") watches a coding-agent session and, when it matters, tells the agent to suggest something to the user: restate a request it misread, move to a stronger or lighter model, or install a plugin that fits the work. After each turn, a cheap model reads the end of the transcript and a short profile of the user. Its verdict reaches the agent before the user's next prompt. Xeef only suggests. The user decides.

Xeef starts as a port of a personal Claude Code hook (`~/.claude/hooks/session-judge.py` with data in `~/.claude/adaptive/`). That hook is the reference behavior until Xeef matches it.

## Rulings

Each ruling was made by the project owner on 2026-11-06.

- **Public repo, MIT license.** MIT is the shortest common license and companies accept it without review. The project needs no patent grant.
- **TypeScript, built into one JavaScript file that Node 18+ runs.** The judge parses four transcript formats and four hook contracts. Static types catch a misread field at build time instead of in a user's session. opencode plugins must be TypeScript, so one language covers every harness, and the opencode plugin calls the core in-process. Cost: users need `node` on PATH. The Claude Code native installer does not ship Node, so the install guide must say so.
- **Claude Code first.** Codex, agy (Antigravity CLI) and opencode follow, in that order. Codex is closest: it uses the same hook names and JSONL transcripts.
- **Each harness judges with its own cheap model, and users can change it.** Users need no second account.
- **One profile per user, shared across harnesses.** The profile describes how the user works, so it does not depend on a harness or a model. Model ladders differ per harness and live in per-harness data, not in the profile.
- **Falling back to another harness's model is opt-in.** Each harness has an ordered judge list. The default list holds only that harness's own model. A fallback sends one vendor's transcript to another vendor, so the user must turn it on.
- **Plugin suggestions come from a curated catalog in the repo.** See [Plugin suggestions](#plugin-suggestions).
- **Data lives in `~/.xeef`, or in `$XEEF_HOME` when that is set.** It is one dot-folder in the home directory, the same path on every OS, beside `~/.claude` and `~/.codex`. It holds `profile.md`, `log.jsonl`, `config.json`, `state/` and `pending/`. Tests and backtests point `XEEF_HOME` at a scratch folder.
- **Settings live in one optional `~/.xeef/config.json`.** It holds the stakes paths and, per harness, the judge list and the review model. Without the file, built-in defaults apply. Stakes entries keep the shape of the reference's `setup-expectations.json`: a folder glob and the globs inside it where a wrong change is expensive. Xeef does not read `setup-expectations.json`.
- **The repo is public at `github.com/wistarabanyukayana/xeef`.**
- **Xeef installs as a plugin; the repo is its own marketplace.** The plugin is the `plugin/` folder, and the marketplace points at it. The built `plugin/dist/xeef.js` is committed there, so installing runs no build step, and a test checks that the committed file matches the source. The plugin folder holds no `package.json`: Claude Code runs `npm install` on a plugin that has one, which pulled 44 MB of build tools into every install (seen, 2026-11-06). On Claude Code a stranger runs `/plugin marketplace add wistarabanyukayana/xeef` and then `/plugin install xeef@xeef`. Each harness adds its own small manifest beside the shared `plugin/dist/xeef.js` (see the plugin row under [Harness facts](#harness-facts)). A harness whose plugins cannot carry hooks gets a hooks block to paste instead.
- **The data folder keeps its profile history in git.** If `git` is on PATH, the weekly review runs `git init` in the data folder the first time and commits `profile.md` after each rewrite, so `git log -p profile.md` shows every change and `git checkout` undoes one. Without git, the review skips this step and says nothing.
- **Judge lists are objects.** In `config.json`, `{"claude": {"judges": [{"harness": "claude", "model": "haiku"}], "reviewer": {"harness": "claude", "model": "sonnet"}}}`. Xeef tries the judges in order and moves to the next when one fails. An entry for another harness is the opt-in fallback; until that harness is built, Xeef logs it as an error and moves on.
- **The judge picks a rung; Xeef writes the command.** The judge returns a verdict kind, a target rung by name from the harness's ladder (`to`) and a few words of reason. Xeef compares the target with the current rung, drops a verdict that points the wrong way (a `lighter` that goes up, a `struggle` or `stakes` that does not go up), and builds the suggestion line from the ladder data: `/model` when the family changes, `/effort` when the effort changes or the model does (effort is saved per model). This covers stronger and lighter moves of both model and effort. A rung with no recorded effort counts as high (assumption, not checked against Claude Code's default). On the 60-point backtest the judge's agreement with the reference stayed within Haiku's own variation, and it spoke on 5 points instead of 6.
- **Xeef counts each tool call once.** Claude Code transcripts hold `api-request-blob` entries that repeat earlier tool calls and their results. The reference's `struggle-check.py` counted those copies too, which inflated "one file edited N times" and "N failed tool calls" in 145 of 1,272 judge prompts on the owner's transcripts. Xeef reads tool calls only from `user` and `assistant` entries. The backtest reports the prompts this changes apart from the rest, so parity with the reference stays measurable.

## Profile and log

- The profile is plain text. Every judge run puts it into the judge's prompt.
- Every verdict, delivery and outcome goes into an append-only JSONL log. An outcome records whether the user changed model after a suggestion.
- Each verdict records which model produced it. Models judge differently, and the weekly review must tell "this judge speaks too often" apart from "the profile is wrong".
- All judges use the same prompt and the same JSON schema, so their verdicts are comparable.
- Only the weekly review rewrites the profile, and it holds a lock file while it does. Several harnesses append to the log at the same time, which is safe for small appends. Two profile rewrites at once are not safe.
- The weekly review also uses the judge list, with a stronger model than the per-turn judge.

## Plugin suggestions

A catalog entry holds what the plugin is for, the harnesses it supports with an install command for each, and the signals that show the session needs it. Signals are file types or prompt patterns, for example `.css` files or "looks AI generated" for a UI plugin.

The judge has a verdict kind for this. It speaks only when the session shows a need that matches an entry the user does not have installed. Xeef suggests each plugin at most once per user. A "no" goes into the profile so Xeef never asks again. Xeef never installs anything.

The catalog is curated and changes through pull requests. Users can add their own entries. Marketplace listings stay out of the judge's prompt: their descriptions are written by plugin authors, and text in a prompt can steer the judge.

Rulings made by the project owner on 2026-11-06:

- **The catalog is `catalog.json` in the repo, bundled into `plugin/dist/xeef.js`.** An entry holds `name`, `for` (one line on what it helps with), `signals` (`files`: globs matched against file names; `prompts`: case-insensitive regular expressions matched against the user's prompts), optional `conflicts` (names of plugins that do the same job), and one section per harness with the plugin's `id` there and the `install` command. Users add entries under `catalog` in `config.json`. A user entry with the same name replaces the shipped one.
- **Xeef picks the candidates; the judge only decides whether to speak.** An entry is a candidate when a file inside the session's folder, touched in the last two prompts, matches one of its file globs (files elsewhere, such as Claude Code's own memory and plan files, are not signals), or one of the last five prompts matches one of its prompt patterns. Only candidates the user does not have reach the judge's prompt, and Xeef drops a plugin verdict that names anything else. This keeps the prompt short and stops the judge from suggesting a plugin that is not in the catalog.
- **Xeef asks the harness which plugins the user has.** On Claude Code that is `claude plugin list --json` (about 0.8 seconds, in the background judge). A plugin listed in any scope counts as one the user has: the user already knows it and decided where it belongs. An entry is also skipped when the user has a plugin it conflicts with. Xeef calls the list only when an entry matches or an earlier suggestion waits for its outcome.
- **A plugin offer is outside the one-in-ten aim.** The judge's prompt says an offer is cheap because it happens once per user, so the judge offers a listed candidate whenever it fits the work in the last few prompts, and stays silent only when it does not fit, such as a matched word used in another sense. With the stricter first wording the judge offered nothing on 89 real candidate points; with this one it offered on 58 of 81, and the offers read as fitting except for `.md` files outside the project, which the folder rule above now excludes.
- **Each plugin is suggested once per user.** `~/.xeef/state/plugins.json` records each delivered suggestion, and Xeef never suggests that plugin again, whatever the answer. When a later judge run finds the plugin installed, the log records the outcome. The weekly review treats a plugin still missing a week after the suggestion as a no and writes it into the profile.
- **The first entries are plugins the owner uses:** impeccable and frontend-design (UI work, marked as conflicting with each other), rust-analyzer-lsp (Rust), prose and humanizer (writing), and ponytail (over-built code). Install commands for `claude-plugins-official` plugins assume that marketplace is built into Claude Code: the owner's settings never added it, yet it is listed (inferred, not checked on a clean install).

## Harness facts

Checked on 2026-11-06 against Claude Code 2.1.318, Codex 0.166.0, agy 1.5.0 and opencode 2.2.5. Each fact says how it was verified: **live** (ran it and saw the result), **schema** (the JSON schema inside the binary), **docs** (documentation built into the binary) or **seen** (existing transcripts or other plugins).

| Need | Claude Code | Codex | agy | opencode |
|---|---|---|---|---|
| Run after a turn | `Stop` hook; a process it starts with `detached` keeps running after `claude -p` exits (live, 2026-11-06) | `Stop` hook gets `transcript_path`, `model`, `last_assistant_message` (schema) | `Stop` hook gets `transcriptPath`, `modelName`, `terminationReason` (live) | plugin `session.hook("experimental.idle")` gets `sessionID` (live) |
| Inject before the next prompt | `UserPromptSubmit` returns `hookSpecificOutput.additionalContext` | same contract (schema; ponytail's text reaches Codex transcripts this way, seen) | `PreInvocation` returns `injectSteps: [{ephemeralMessage}]` (live) | `session.hook("context")` pushes `{type: "text", text}` into `system` (live) |
| Cheap model call | `claude -p --model haiku --json-schema` | `codex exec -m gpt-6-luna -c model_reasoning_effort=low --output-schema` (live, 6.6 s) | `agy --model gemini-3.8-flash-low --json-schema … -p` returns `structured_output` (live, 11 s) | `ctx.session.generate({sessionID, prompt})` in-process, returns text (live) |
| Stop the judge's own call from running hooks | `--settings '{"disableAllHooks":true}'` | `-c features.hooks=false` (live) | env var reaches every hook (live) | in-process call starts no hooks |
| Transcript | JSONL | JSONL; `turn_context` holds `model` and `effort` | JSONL steps: `USER_INPUT`, `PLANNER_RESPONSE`, `EPHEMERAL_MESSAGE` (live) | SQLite `session_message`, types include `user`, `assistant`, `idle`, `model-switched` (seen); the context hook also passes `messages` (live) |
| Usage-limit signal | transcript entry with `usageLimitNote: "wrap_up"`; a turn the limit cuts off fires `StopFailure` instead of `Stop` | `token_count.rate_limits` with `primary`/`secondary.used_percent` and `rate_limit_reached_type` (seen) | `Stop` with `terminationReason: "ERROR"` and `error` (docs) | assistant message with `finish: "error"` and `error.type` (seen for other errors) |
| Plugin that carries hooks | `.claude-plugin/plugin.json` plus `hooks/hooks.json`; commands find files through `CLAUDE_PLUGIN_ROOT`; `--plugin-dir` loads a plugin for one session (live, 2026-11-06) | `.codex-plugin/plugin.json` with `"hooks": "<file>"`; Codex keeps a trust hash per plugin hook in `config.toml` (seen: ponytail and understand-anything); the binary holds `CLAUDE_PLUGIN_ROOT` and `PLUGIN_ROOT` (seen, 2026-11-06) | `plugin.json` plus `hooks.json` at the plugin root, shaped `{"<name>": {"Stop": [{"command": "…"}]}}`; `agy plugin install <dir>` copies the folder to `~/.gemini/config/plugins/<name>`; the hook runs with that folder as its working directory and gets no plugin-root variable (live, 2026-11-06) | the plugin is a code module; `opencode plugin add` installs it (help text) |
| Model naming | model, effort set apart | model, effort `low` to `ultra` | effort is part of the model ID (`gemini-3.8-flash-low`); also `--effort` | `provider/model#variant` |

### Gotchas

- **agy hooks are synchronous.** A judge that runs inside the hook adds about 8 seconds to every turn. The hook must start the judge in the background and return at once. Do this on every harness so the code path is the same.
- **agy has no prompt-submit event.** `PreInvocation` fires before every model call in a turn, including calls after tool use. Inject only when `invocationNum` is 0.
- **Codex runs only approved hooks.** Codex stores a hash of each approved hook in `~/.codex/config.toml` and skips the rest without a message. Installing Xeef needs a one-time approval in Codex. A changed hook file most likely needs approval again (inferred from the hash design, not tested).
- **Every hook checks `XEEF_INNER` first and exits if it is set.** The judge sets this variable on its own cheap-model call, so the call cannot start Xeef again. On opencode this was tested only with `--standalone`. The background service has its own environment.
- **opencode has two plugin APIs.** Build for the 2.x API (`Plugin.define({id, setup(ctx)})`), which RTK's plugin uses. The 1.x hooks, such as `experimental.chat.system.transform` in ponytail's plugin, are a different API. A plain string pushed into `system` fails schema validation; push `{type: "text", text}`.
- **opencode has no JSON-schema flag.** Parse the JSON out of the reply text.
- **`ctx.generate.text` without a model picks a paid default.** Name the model explicitly.
- **Judge cost differs a lot by harness.** Claude Haiku costs about $0.002 per run. Codex used about 19,000 tokens per call, mostly its own system prompt, against the user's ChatGPT plan. agy used about 10,000. On Codex, consider judging only when the mechanical signals fire.

### Not verified

- A live Codex `Stop` run. The check is blocked until a probe hook is approved in Codex or run with `--dangerously-bypass-hook-trust`.
- Codex's `async` hook field. It exists in the binary but was not run.
- Usage-limit signals on agy and opencode.
- opencode through its background service.
- Which model `ctx.session.generate` uses.
- The slash commands that switch model and effort in Codex, agy and opencode.
- Windows.

- **Xeef will take over the owner's `setup-check.py`, as its own work item** (ruled 2026-11-06). That SessionStart hook compares a folder's plugins with `~/.claude/setup-expectations.json`: plugins wanted on or off, files that should not exist, folder plugins unused in recent sessions, and folders with no entry. It also reminds the agent about stakes work below Opus high. Xeef's plugin offers and `stakes` verdict cover part of this, and both tools keep a copy of the stakes paths. Until that work item lands, the owner keeps both copies in step by hand.

## Open questions
- What the `setup-check.py` takeover keeps: the manifest format, which reports move into the judge and which stay mechanical at session start.

- How Xeef finds which harness CLIs are installed and logged in, so it can offer a fallback. Turning one on is settled: the user adds another harness's entry to the judge list.
- The npm package name. Nothing is published to npm yet; the plugin install does not need it.
