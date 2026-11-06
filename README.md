# Xeef

Xeef (say "zeef") watches a Claude Code session. After each turn, a cheap model (Claude Haiku by default) reads the end of the transcript and a short profile of how you work. When the session needs it, Xeef tells the agent to suggest something to you before it answers your next prompt:

- restate a request it seems to have misread,
- move to a stronger model or effort when the work goes in circles or the stakes are high,
- step down to a lighter model when the work is routine.

Xeef only suggests. It never changes your model and never blocks a turn. Most turns it says nothing.

Claude Code is supported today. Codex, agy (Antigravity CLI) and opencode will follow.

## Requirements

- Claude Code. Xeef is tested with version 2.1.318 on Linux; Windows is not tested yet.
- Node.js 18 or later on your `PATH`. The Claude Code native installer does not include Node. Check with `node --version`.

## Install

The repository is a Claude Code plugin marketplace. The built hook file is committed, so installing runs no build step.

1. Get the repository: `git clone <repo-url> ~/xeef`.
2. In Claude Code, run `/plugin marketplace add ~/xeef`.
3. Run `/plugin install xeef@xeef`.
4. Start a new Claude Code session. Hooks load when a session starts.

From a shell, steps 2 and 3 are `claude plugin marketplace add ~/xeef` and `claude plugin install xeef@xeef`.

To remove Xeef, run `/plugin uninstall xeef@xeef`. Your data in `~/.xeef` stays until you delete it.

## What happens in a session

- **After each turn** (the `Stop` hook), Xeef starts the judge in the background and returns at once, so the turn does not wait. The judge needs at least two prompts in the session.
- **When you send a prompt** (the `UserPromptSubmit` hook), a pending verdict goes to the agent as extra context. The agent ends its reply with a one-line suggestion, or ignores the verdict if your new prompt makes it irrelevant. A verdict more than two prompts old is dropped.
- **When a session starts** (the `SessionStart` hook), Xeef reports the last weekly review in one line. Once a week, after at least 30 log rows, it starts a new review in the background.

When the usage limit is spent, Xeef skips the judge and logs the skip.

## Cost and privacy

Each judge run sends the last eight prompts of the transcript and your profile to the judge model through your own `claude` CLI and account. Long messages are cut to 700 characters. A Haiku run costs about $0.002. Nothing goes to any other service.

## Your data

Xeef keeps everything in `~/.xeef`. Set `XEEF_HOME` to use another folder.

- `profile.md`: what the judge should know about how you work, in plain text. Write it yourself to start, or let the weekly review write it from the log.
- `log.jsonl`: every verdict, delivery, skip, error and outcome. An outcome records whether you changed model or effort after a suggestion.
- `config.json`: optional settings (see below).
- `pending/` and `state/`: per-session working files.

The weekly review asks a stronger model to rewrite `profile.md` from the log. If `git` is installed, Xeef keeps `~/.xeef` as a git repository and commits `profile.md` after each review. To see what a review changed, run `git -C ~/.xeef log -p profile.md`.

## Settings

`~/.xeef/config.json` is optional. This example marks the folders in one project where a wrong change is expensive, and adds Sonnet as a second judge for when Haiku fails:

```json
{
  "stakes": [
    { "path": "~/code/flight-controller*", "globs": ["src/control/*", "src/link/*"] }
  ],
  "claude": {
    "judges": [
      { "harness": "claude", "model": "haiku" },
      { "harness": "claude", "model": "sonnet" }
    ],
    "reviewer": { "harness": "claude", "model": "sonnet" }
  }
}
```

- `stakes`: `path` is a glob for the project folder. `globs` are relative to that folder, or absolute. In both, `*` also matches `/`. When the last two prompts touch a stakes path, the judge sees that and can suggest a stronger rung.
- `claude.judges`: tried in order. If one fails, Xeef logs the error and tries the next.
- `claude.reviewer`: the model for the weekly review.

## Check it against your own history

`backtest` judges sampled points from your past transcripts and prints each verdict. It reads `~/.xeef/profile.md` and `config.json`, and costs one judge run per point:

```sh
node ~/xeef/dist/xeef.js claude backtest ~/.claude/projects/<project-folder> 20
```

Add `--dry` to print the prompts the judge would see, without calling a model.

## Development

```sh
npm ci
npm test         # typecheck, then the tests against the committed dist/xeef.js
npm run build    # rebuild dist/xeef.js; commit it with the source change
```

The tests use a fake `claude` on `PATH`, so they make no model calls. One test fails while `dist/xeef.js` is older than the source.

To try a change in a real session without installing it, run `claude --plugin-dir ~/xeef`. Set `XEEF_HOME` to a scratch folder to keep the test run out of your log.

The design, the rulings behind it and the harness facts it relies on are in [docs/spec.md](docs/spec.md).

## License

MIT
