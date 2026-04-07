# Changelog

## v0.5.0 (2026-04-07)

### New Features

- **Document Notes** — Chat model can create/update .md files via `write_file` tool. Notes are saved to the workspace and indexed into the knowledge graph via the Acervo proxy's `/acervo/documents` endpoint.
- **Skills system** — Install skills from GitHub repos (`obra/superpowers`, etc.) or create custom ones. Skills are stored per-project in `.acervo/skills/` and selected per-request via embedding similarity in the Acervo pipeline.
- **Agents per-project** — Agent configurations now stored in `.acervo/agents/` per project, with global `default.yaml` as fallback.
- **Error recovery in chat** — Pipeline errors display as styled error messages with a "Retry" button that re-sends the last user message.
- **Proxy health check** — On startup and before each turn, Studio checks if the Acervo proxy is reachable. Fails fast with a clear message instead of hanging on TCP timeout.
- **Chat history per-project** — Conversation history now persists per-project in `.acervo/history.json`, surviving project switches and restarts.
- **Trace persistence per-project** — Pipeline trace events stored in `.acervo/trace.jsonl` per project, restored on reconnect with proper turn grouping.

### UI Changes

- **Sidebar reordered** — Projects and Agents moved to main section; Graph moved under ACERVO section; new Skills page added.
- **Skills page** — List/create/delete skills with collapsible groups by source repo. Install from GitHub dialog with repo browsing and multi-select.
- **Proper modals** — Agent and skill creation use styled dialogs instead of browser `prompt()`.

### Bug Fixes

- **TOML description escaping** — Descriptions with quotes no longer corrupt `config.toml`. Added `_toml_escape()` helper and regex fallback for already-corrupted files.
- **Missing `import sys`** — Fixed missing import in `rest_routes.py`.
- **Error path consolidation** — Pipeline errors now emit `PipelineError` via EventBus (instead of direct WebSocket message that was silently dropped), ensuring they appear in traces, telemetry, and chat.

### Code Cleanup

- **Removed dead code** — Deleted `core/router.py`, `core/query_planner.py`, `core/context_index.py`, `core/executor.py`, `core/topic_detector.py` (all replaced by Acervo proxy).
- **Removed empty directories** — `protocols/`, `skills/`, `rag/` (placeholder packages with no code).
- **Extracted shared config** — `_load_agent_config()` moved from duplicated definitions in `session.py` + `rest_routes.py` to shared `config/agents.py`.
- **Cleaned unused imports** — Removed `yaml`, `load_all_prompts` from `session.py`.
- **Updated pyproject.toml** — Cleaned package list, bumped version to 0.5.0.

### System Prompt

- Updated `default.yaml` with Document Notes guidance: when to write, when to suggest, when not to, filename conventions, and read-before-update workflow.

## v0.4.0 (2026-03-18)

- Multi-project support, pipeline trace viewer, session export, config editor.
