# sift

`sift` is a local-first CLI for indexing and searching AI coding assistant chat/session logs from one place.

Claude Code and Codex both store useful history on disk, but their built-in search is limited and siloed. `sift` builds one local full-text index over both tools so you can find past decisions, commands, debugging sessions, and notes without leaving your terminal.

## Status

v1 is intentionally small and shippable:

- Claude Code JSONL logs under `~/.claude/projects/<project>/*.jsonl`
- Codex JSONL logs under `~/.codex/sessions/**/*.jsonl`
- Codex archived logs under `~/.codex/archived_sessions/*.jsonl`
- Commands: `index`, `search`, and `list`
- Ranked full-text search with snippets

Out of scope for v1: GUI/web app, semantic search, embeddings, Cursor support, sync, telemetry, or any network calls.

## Install

```sh
npm install
npm link
```

Then run:

```sh
sift --help
```

You can also run without linking:

```sh
node ./bin/sift.js --help
```

## Usage

Build or rebuild the index:

```sh
sift index
```

Search both tools:

```sh
sift search "recipe import bug"
```

The query can also be the first argument:

```sh
sift "Graphify memory journal"
```

Filter by tool and limit results:

```sh
sift search "approval policy" --tool codex --limit 5
sift search "hooks" --tool claude
```

List recent sessions:

```sh
sift list
sift list --tool codex --limit 20
```

## How It Works

`sift index` scans the known local Claude Code and Codex log directories. Missing directories are skipped gracefully.

Each JSONL line is parsed independently, so malformed lines do not crash the whole run. `sift` extracts human-readable user and assistant text, normalizes it to:

```js
{ id, tool, session, project, role, ts, text }
```

Then it builds a MiniSearch index over `text` and stores both the serialized index and normalized records at:

```sh
~/.sift/index.json
```

`sift search` loads that local index, runs ranked full-text search with prefix and light fuzzy matching, and prints the best matches with one-line snippets and source JSONL paths.

## Privacy

`sift` is 100% local and read-only with respect to your assistant logs.

- It only reads logs from `~/.claude` and `~/.codex`.
- It never writes to source logs.
- It only writes its own index under `~/.sift/`.
- It makes zero network requests.
- It has no telemetry, sync, or remote services.

## Roadmap

- v1.1: Cursor support
- v2: optional semantic search
