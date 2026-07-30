# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows 0.x versioning while it is early.

## [0.2.2] - 2026-07-30

### Added

- Parser, storage, privacy, and package metadata tests using the Node.js test runner.
- Continuous integration on Node.js 20, 22, and 24.

### Changed

- Cursor's `better-sqlite3` integration is now optional so Claude and Codex remain usable when the native module is unavailable.
- Session counts are calculated from unique normalized session identifiers.
- npm repository metadata now points to `roccodaffuso/sift`.

### Fixed

- The local index is written atomically with private directory and file permissions on POSIX systems.
- Corrupt or incompatible indexes now produce a friendly rebuild instruction.

## [0.2.1] - 2026-06-22

### Added

- Automated GitHub Release creation on version tag pushes.

### Changed

- README example output polish with neutral wording and English snippets.

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
