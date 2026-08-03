---
name: sift-memory
description: Use this skill when an agent needs local historical context from AI coding assistant sessions, prior project conversations, debugging history, implementation decisions, or user asks to search Claude Code, Codex, Cursor, or OpenCode chat history. It teaches agents to use the local-only `sift` CLI for indexed full-text search across these local logs without network calls.
compatibility: Agent Skills-compatible clients including Codex, Claude Code, Cursor-compatible agents, OpenCode, and VS Code/GitHub Copilot agent mode. Requires Node.js 20+ and the local `sift` CLI or this repo's `node ./bin/sift.js`.
---

# Sift Memory

Use `sift` as a local memory search layer for prior AI coding-assistant sessions. It reads only local Claude Code, Codex, Cursor, and OpenCode logs/databases and writes only its own index under `~/.sift/`.

## Command Resolution

Prefer the installed CLI:

```sh
sift --help
```

When working inside the `sift` repository and the global command is unavailable, use:

```sh
node ./bin/sift.js --help
```

Do not use `npx` or any network-based install path. If neither command works, tell the user to install `sift` locally.

## Actions

### sift_index

Refresh the local index before memory-heavy work, after new logs were created, or when search says no index exists:

```sh
sift index --json
```

Use the repo-local fallback when needed:

```sh
node ./bin/sift.js index --json
```

Use a full rebuild only when the user asks, parser/index behavior changed, or results look stale after an incremental run:

```sh
sift index --full --json
```

### sift_search

Search prior local sessions with targeted queries:

```sh
sift "<query>" --limit 10 --json
```

Filter by source when useful:

```sh
sift "<query>" --tool codex --limit 10 --json
sift "<query>" --tool claude --limit 10 --json
sift "<query>" --tool cursor --limit 10 --json
sift "<query>" --tool opencode --limit 10 --json
```

Good queries are concrete: project names, command names, file names, bug symptoms, package names, decisions, or user phrasing. Prefer a few focused searches over one broad search.

### sift_show

Follow a search result ref when the surrounding conversation is needed:

```sh
sift show "<ref>" --json
```

Use `--context N` only when the default two messages before and after are insufficient.

### sift_list

List recent indexed sessions when you need orientation before choosing search terms:

```sh
sift list --limit 10 --json
```

Filter by source when useful:

```sh
sift list --tool codex --limit 10 --json
```

## Workflow

1. Use this skill when local session memory could materially improve the answer.
2. Run `sift index` unless the task is tiny or the index is known to be fresh.
3. Run `sift_search` with 1-3 focused queries and structured JSON output.
4. Follow only the most relevant result refs with `sift_show` when more context is needed.
5. Use the results as private local context. Summarize only the relevant facts needed for the task.
6. Do not paste large raw logs. Do not expose secrets, credentials, tokens, private personal data, or unrelated session contents.

## Privacy

Keep the workflow local and read-only for source logs:

- Do not send `sift` results to remote services.
- Do not add telemetry, sync, embeddings, or network calls.
- Do not write to Claude Code, Codex, Cursor, or OpenCode source logs/databases.
- Treat everything under `~/.sift/` as local private context.
