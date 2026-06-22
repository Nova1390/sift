# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows 0.x versioning while it is early.

## [0.2.0] - 2026-06-20

### Added

- Incremental indexing with a per-file cache keyed by `mtimeMs` and `size`.
- `sift index --full` for forced rebuilds when parser or index behavior changes.

### Changed

- Compact index payload version 3 with a single source of truth for records in `fileCache`.
- Faster index loading with `MiniSearch.loadJS`.
- Search and list result headers now show local date and time.

### Fixed

- Cursor bubble role parsing for numeric `type` values: `1` maps to `user`, `2` maps to `assistant`.

## [0.1.0] - 2026-06-20

### Added

- Local full-text indexing and search for Claude Code, Codex, and Cursor chat/session history.
- `index`, `search`, and `list` commands.
- `--tool` and `--limit` filters.
- Ranked MiniSearch results with highlighted snippets and local result times.
- Read-only Cursor SQLite parsing with best-effort failure isolation.
- Local index storage under `~/.sift/index.json`.
