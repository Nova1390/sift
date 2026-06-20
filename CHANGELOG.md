# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows 0.x versioning while it is early.

## [0.1.0] - 2026-06-20

### Added

- Local full-text indexing and search for Claude Code, Codex, and Cursor chat/session history.
- `index`, `search`, and `list` commands.
- `--tool` and `--limit` filters.
- Ranked MiniSearch results with highlighted snippets and local result times.
- Read-only Cursor SQLite parsing with best-effort failure isolation.
- Local index storage under `~/.sift/index.json`.
