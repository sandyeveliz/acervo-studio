# Changelog

## v0.6.0 (2026-04-09)

### Interactive Graph Editor

The Graph page is now a full interactive knowledge graph editor, connected to the new Acervo REST API (`/acervo/graph/*`).

#### Visualization

- **Node size by degree** — Nodes are sized proportionally to their connection count (6–24px) instead of fact count.
- **Edge labels always visible** — Lowered render threshold so relation labels display at all zoom levels; edge labels rendered with dedicated font/color settings.
- **Type and layer filters** — Dropdown filters in the toolbar to show only nodes of a specific type or layer.
- **Merge mode highlight** — When marking a node for merge, it renders with an amber highlight and a banner prompts to select the second node.

#### Curation

- **Right-click context menu** — Right-click any node (Edit / Delete / Mark for merge) or edge (Edit relation / Delete) directly on the canvas.
- **Inline node editing** — Edit label, type, layer, and description directly in the detail panel via `PATCH /acervo/graph/nodes/{id}`.
- **Edge editing** — Change an edge's relation type via a dialog, using `PATCH /acervo/graph/edges/{id}`.
- **Two-step merge flow** — Mark first node from context menu → banner appears → click second node → confirmation → `POST /acervo/graph/merge`.
- **Create node dialog** — Manual node creation with label, type, layer, description, and initial facts.

#### New Panels (bottom tabs)

- **Validation Panel** — Shows the type-mapping validation log from `GET /acervo/graph/validation-log`. Each entry can be approved, corrected (with inline form for corrected type/relation), or discarded via dedicated backend endpoints. Pending count badge on the tab. Stateless in Studio — all actions persist on backend.
- **Orphans Panel** — Lists nodes with no connections from `GET /acervo/graph/orphans`. Quick connect (inline search + relation picker) or delete per orphan. Simple word-overlap similarity suggestions ("Merge with X?" chips).
- **Stats Panel** — Recharts-powered dashboard: type distribution donut, relation distribution horizontal bar, summary cards (nodes/edges/orphans), and cumulative growth timeline.
- **Backend unavailability states** — Validation and Orphans panels show "backend endpoint not connected yet" instead of empty content when endpoints are not available.

#### API Migration

- All graph endpoints migrated from `/graph/*` to `/acervo/graph/*`.
- `GraphEdge` now carries an `id` field; delete and patch operations use edge IDs.
- `GraphStats` updated to new shape: `types_distribution`, `relations_distribution`, `orphan_count`.
- New API methods: `updateEdge`, `getOrphans`, `getValidationLog`, `approveValidation`, `correctValidation`, `discardValidation`, `exportTraining`.
- Merge endpoint updated to `{ source_id, target_id }` (removed alias parameter).

#### Training Data Export

- **Export Training button** in toolbar calls `POST /acervo/graph/export/training` and downloads a JSONL file. Format is compatible with `generate_s1_training.py` in acervo-models (conversation context + expected JSON output).

#### Real-time Updates

- `useWebSocket` now dispatches an `acervo:graph-updated` DOM CustomEvent when `conversation_indexed` events arrive.
- New `useGraphEvents` hook in GraphPage listens for this event and triggers a graph reload.
- Auto-refresh is skipped while the user is in edit mode to prevent data loss.
- Manual refresh button in toolbar as fallback.

#### Toolbar Enhancements

- Replaced old stats badges with dedicated StatsBar and StatsPanel.
- Added: type filter dropdown, layer filter dropdown, Create Node button, Refresh button, Export Training button.

### Projects Page

- **Clear Acervo Data button** — New danger zone action on the project detail page. Deletes the knowledge graph, topics, sessions, and all indexed data for the active project via `DELETE /plugins/acervo/data`. Requires confirmation dialog.

### Files Added

- `GraphContextMenu.tsx` — Floating right-click menu for canvas nodes/edges
- `CreateNodeDialog.tsx` — Dialog for manual node creation
- `EditEdgeDialog.tsx` — Dialog for editing edge relation
- `ValidationPanel.tsx` — Validation log viewer with approve/correct/discard
- `OrphansPanel.tsx` — Orphan node manager with connect/delete/similarity
- `StatsPanel.tsx` — Recharts charts (type donut, relation bar, growth timeline)
- `useGraphEvents.ts` — Hook for real-time graph update events

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
