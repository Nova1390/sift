# sift

Local-first CLI to index and search your Claude Code, Codex, and Cursor chat history from one place.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg) ![Node >=20](https://img.shields.io/badge/node-%3E%3D20-339933.svg) ![npm](https://img.shields.io/npm/v/@rodabuilds/sift) ![Local-first](https://img.shields.io/badge/local--first-yes-brightgreen.svg) ![Zero network](https://img.shields.io/badge/network-zero-lightgrey.svg)

## The Problem

Claude Code, Codex, and Cursor all store useful coding-assistant history locally, but their built-in search is limited and separated by tool. `sift` builds one local full-text index so you can search across those histories from a single terminal command.

## Features

- Indexes Claude Code JSONL logs under `~/.claude/projects`.
- Indexes Codex JSONL logs under `~/.codex/sessions` and `~/.codex/archived_sessions`.
- Indexes Cursor SQLite `state.vscdb` databases from Cursor user storage, best-effort and read-only.
- Ranked full-text search with highlighted snippets and local result times.
- Filters with `--tool claude|codex|cursor` and `--limit N`.
- 100% local, read-only for source logs/databases, zero network, zero telemetry.
- No cloud dependencies.

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

Add sift to your coding agent (Claude Code, Codex, or Cursor) via the open skills CLI:

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

Filter by tool:

```sh
sift "approval policy" --tool codex
sift "italiano" --tool cursor
```

List recent sessions:

```sh
sift list
```

Example output:

```txt
[cursor · 2026-06-20 11:53] Traced the Cursor composer storage path and confirmed the message payload shape.
/Users/you/Library/Application Support/Cursor/User/globalStorage/state.vscdb#db6394d1-a474-45ae-87b1-1d7c210585e2

[codex · 2026-06-20 10:44] Shipped the local-first Node CLI for searching AI coding-assistant logs...
/Users/you/.codex/sessions/2026/06/20/rollout-2026-06-20T08-46-33-019ee3c7.jsonl
```

## Agent Integrations

This repo includes lightweight local instructions for coding agents:

- Agent Skills-compatible clients: `.agents/skills/sift-memory/SKILL.md`
- Cursor: `.cursor/rules/sift-memory.mdc`
- Claude Code fallback/project notes: `CLAUDE.md`

They teach agents to run `sift index`, `sift "<query>"`, and `sift list` as local shell commands. They do not add network access, telemetry, sync, or writes to source logs.

## How It Works

`sift index` scans the known local storage locations for Claude Code, Codex, and Cursor. Missing directories are skipped gracefully. Repeated runs are incremental: unchanged Claude and Codex files are reused from the local file cache, while Cursor SQLite databases are re-read each time because their WAL files can change without updating the main database timestamp.

Claude Code and Codex JSONL files are parsed line by line. Malformed lines are skipped instead of failing the whole index run. Cursor databases are opened read-only with `better-sqlite3`; locked databases, missing schemas, or unsupported Cursor versions produce warnings and are skipped without breaking Claude/Codex indexing.

Human-readable user and assistant messages are normalized to:

```js
{ id, tool, session, project, role, ts, text }
```

The normalized records are indexed with MiniSearch. The serialized search index and per-file record cache are written to:

```sh
~/.sift/index.json
```

`sift search` loads that local index, runs ranked full-text search with prefix and light fuzzy matching, and prints the best matches with highlighted snippets, local date/time, and the source path.

## Privacy

Privacy is the main constraint.

- Only reads from `~/.claude`, `~/.codex`, and Cursor's local storage.
- Never writes to source logs or Cursor databases.
- Writes only its own index under `~/.sift/`.
- Makes zero network requests.
- Has no telemetry, sync, accounts, or remote services.

## Roadmap

- v2: optional semantic search, still local.

## License

MIT
