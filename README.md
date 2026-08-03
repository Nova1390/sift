# sift

Local-first CLI to index and search your Claude Code, Codex, Cursor, and OpenCode chat history from one place.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg) ![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg) ![npm](https://img.shields.io/npm/v/@rodabuilds/sift) ![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen.svg) ![Zero network](https://img.shields.io/badge/network-zero-lightgrey.svg)

## The Problem

Claude Code, Codex, Cursor, and OpenCode all store useful coding-assistant history locally, but their built-in search is limited and separated by tool. `sift` builds one local full-text index so you can search across those histories from a single terminal command.

## Features

- Indexes Claude Code JSONL logs under `~/.claude/projects`.
- Indexes Codex JSONL logs under `~/.codex/sessions` and `~/.codex/archived_sessions`.
- Indexes Cursor SQLite `state.vscdb` databases from Cursor user storage, best-effort and read-only.
- Indexes the current OpenCode SQLite database under `${XDG_DATA_HOME:-~/.local/share}/opencode/opencode.db`, or `%LOCALAPPDATA%/opencode/opencode.db` on Windows, best-effort and read-only.
- Ranked full-text search with highlighted snippets and local result times.
- Stable result references with surrounding conversation context through `sift show`.
- Structured JSON output for coding agents and shell automation.
- Local diagnostics with `sift doctor`.
- Filters with `--tool claude|codex|cursor|opencode` and `--limit N`.
- 100% local, read-only for source logs/databases, zero network, zero telemetry.
- No cloud dependencies.
- Private, atomically written local index on POSIX systems.

## Install

Install from npm:

```sh
npm install -g @rodabuilds/sift
sift index
sift "your query"
```

Or install from source:

```sh
git clone https://github.com/roccodaffuso/sift.git
cd sift
npm install
npm link
```

Then run:

```sh
sift --help
```

Without linking:

```sh
node ./bin/sift.js --help
```

### Install as an agent skill

Add sift to your coding agent (Claude Code, Codex, Cursor, or OpenCode) via the open skills CLI:

```sh
npx skills add roccodaffuso/sift
```

This installs the `sift-memory` skill so your agent can search your past sessions on its own, fully local.

## Usage

Build or rebuild the local index:

```sh
sift index
```

Force a full rebuild when parser behavior changes:

```sh
sift index --full
```

Search everything:

```sh
sift "recipe import bug"
```

Use JSON output from an agent or script:

```sh
sift "recipe import bug" --json
```

Filter by tool:

```sh
sift "approval policy" --tool codex
sift "italiano" --tool cursor
sift "local model" --tool opencode
```

List recent sessions:

```sh
sift list
```

Show the matched message with two messages before and after it:

```sh
sift show a13f09c2e4ab:17
sift show a13f09c2e4ab:17 --context 4 --json
```

Inspect source and index health:

```sh
sift doctor
```

Example output:

```txt
[cursor · 2026-06-20 11:53] Traced the Cursor composer storage path and confirmed the message payload shape.
/Users/you/Library/Application Support/Cursor/User/globalStorage/state.vscdb#composer-1 · ref a13f09c2e4ab:17

[codex · 2026-06-20 10:44] Shipped the local-first Node CLI for searching AI coding-assistant logs...
/Users/you/.codex/sessions/2026/06/20/rollout-2026-06-20T08-46-33-019ee3c7.jsonl · ref 84d1c90a21bf:42
```

## Agent Integrations

This repo includes lightweight local instructions for coding agents:

- Agent Skills-compatible clients, including Codex, Claude Code, and OpenCode: `.agents/skills/sift-memory/SKILL.md`
- Cursor: `.cursor/rules/sift-memory.mdc`
- Claude Code fallback/project notes: `CLAUDE.md`

They teach agents to refresh the index, search with structured JSON, and follow a result reference with `sift show <ref> --json`. They do not add network access, telemetry, sync, or writes to source logs.

## How It Works

`sift index` scans the known local storage locations for Claude Code, Codex, Cursor, and OpenCode. Missing directories are skipped gracefully. Repeated runs are incremental: unchanged Claude and Codex files retain their cached records and MiniSearch documents, while changed or deleted files update only their own documents. Cursor and OpenCode SQLite databases are re-read each time because their WAL files can change without updating the main database timestamp.

Claude Code and Codex JSONL files are parsed line by line. Malformed lines are skipped instead of failing the whole index run. Cursor and OpenCode databases are opened read-only with the optional `better-sqlite3` integration; locked databases, missing schemas, unsupported versions, or an unavailable native module produce warnings and are skipped without breaking the other sources. OpenCode indexing includes only visible user and assistant text, never reasoning, tool output, account, credential, or token data.

Human-readable user and assistant messages are normalized to:

```js
{ id, tool, session, project, role, ts, text }
```

The normalized records are indexed with MiniSearch. The compact search manifest is written to `~/.sift/index.json`; full normalized records live once in private per-source shards under:

```sh
~/.sift/cache/
```

`sift search` loads the MiniSearch manifest, runs ranked full-text search with prefix and light fuzzy matching, then reads only the shards needed for the final results. It prints highlighted snippets, local date/time, source path, and a short ref accepted by `sift show`.

Existing version 3 indexes remain searchable. Running `sift index` once migrates them to the sharded version 4 format.

## Privacy

Privacy is the main constraint.

- Only reads from `~/.claude`, `~/.codex`, Cursor's local storage, and the OpenCode data directory.
- Never writes to source logs, Cursor databases, or OpenCode databases.
- Writes only its own index under `~/.sift/`.
- Uses private directory/file permissions on POSIX and replaces the index atomically.
- Makes zero network requests.
- Has no telemetry, sync, accounts, or remote services.

## Roadmap

- v2: optional semantic search, still local.

## License

MIT
