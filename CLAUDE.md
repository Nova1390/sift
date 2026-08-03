# Claude Code Project Notes

This repository includes a portable Agent Skill for local session-memory search:

```txt
.agents/skills/sift-memory/SKILL.md
```

Use it when prior Claude Code, Codex, Cursor, or OpenCode chat/session history could help answer a question, recover a decision, debug a regression, or continue project work.

Core commands:

```sh
sift index --json
sift "<query>" --limit 10 --json
sift "<query>" --tool claude --limit 10 --json
sift "<query>" --tool codex --limit 10 --json
sift "<query>" --tool cursor --limit 10 --json
sift "<query>" --tool opencode --limit 10 --json
sift show "<ref>" --json
sift list --limit 10 --json
```

When the global command is unavailable inside this repo, use `node ./bin/sift.js` with the same arguments.

Privacy constraints:

- Keep all `sift` usage local.
- Do not send log contents or index data to remote services.
- Do not write to Claude Code, Codex, Cursor, or OpenCode source logs/databases.
- Follow only relevant result refs with `sift show` when surrounding context is needed.
- Summarize only relevant findings; do not paste large raw logs.
