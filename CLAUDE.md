# Claude Code Project Notes

This repository includes a portable Agent Skill for local session-memory search:

```txt
.agents/skills/sift-memory/SKILL.md
```

Use it when prior Claude Code, Codex, or Cursor chat/session history could help answer a question, recover a decision, debug a regression, or continue project work.

Core commands:

```sh
sift index
sift "<query>" --limit 10
sift "<query>" --tool claude --limit 10
sift "<query>" --tool codex --limit 10
sift "<query>" --tool cursor --limit 10
sift list --limit 10
```

When the global command is unavailable inside this repo, use `node ./bin/sift.js` with the same arguments.

Privacy constraints:

- Keep all `sift` usage local.
- Do not send log contents or index data to remote services.
- Do not write to Claude Code, Codex, or Cursor source logs/databases.
- Summarize only relevant findings; do not paste large raw logs.
