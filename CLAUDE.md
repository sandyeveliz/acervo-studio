# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AVS-Agents — Python TUI app (Textual) for AI conversation with episodic memory graph. Uses a single fine-tuned model (acervo-extractor-qwen3.5-9b) in LM Studio for both chat and extraction — behavior is determined by the system prompt. Ollama runs embeddings (qwen3-embedding). The core differentiator is the Context Index: each turn builds a fresh context from a persistent knowledge graph instead of accumulating conversation history.

## Commands

```bash
# Install
pip install -e .

# Run
python main.py    # or: py main.py
```

## Architecture

Full architecture diagram and details in `docs/ARCHITECTURE.md`.

**Entry point:** `main.py` → `tui/app.py` (Textual App)

**Pipeline per turn:**
```
message → topic detector → activate nodes → query planner (LLM) → executor (graph)
→ context index → LLM stream → extractor → graph persist
```

**Key modules:**

1. **config/** — Frozen dataclasses from `settings.toml` + `.env`. `load_settings()` is the single entry point.
2. **providers/** — `ModelRouter` with LM Studio (single fine-tuned model for chat + extraction). Ollama for embeddings only.
3. **core/** — Pipeline orchestration:
   - `pipeline.py` — full turn orchestrator, emits typed events
   - `context_index.py` — builds the context stack with sliding window + dynamic budget
   - `context_synthesizer.py` — renders graph nodes to text (pure template, no LLM)
   - `query_planner.py` — LLM decides what tool to use (GRAPH_ALL/SEARCH/VECTOR/WEB/READY)
   - `executor.py` — executes the planner's decision against the graph
   - `topic_detector.py` — 3 levels: keywords → embeddings → LLM classification
   - `event_bus.py` + `events.py` — pub/sub for pipeline visibility
4. **memory/** — Episodic memory graph with JSON persistence. `extractor.py` extracts entities, relations, and facts from conversation turns. Only stores explicit user statements, never inferences.
5. **tui/** — Unified timeline chat (messages + pipeline steps inline), stats sidebar.

## Context Stack (what the LLM receives)

```
[system]     Fixed prompt (KV cached)
[user]       [CONTEXTO VERIFICADO] warm context from graph [FIN CONTEXTO]
[assistant]  "Entendido."
[user/asst]  Hot layer: max 2 recent turn pairs (sliding window)
[user]       Current user message
```

Warm context (graph) always enters fully — priority over hot layer. Budget target ~2000tk. The graph IS the memory; conversation history is temporary.

## Architectural invariants

- **System prompt is immutable** — KV cache depends on identical prefix. Dynamic content is a separate user message.
- **Embeddings ≠ chat** — Ollama for embeddings, LM Studio for chat. Never mix.
- **Extractor is conservative** — only stores explicit facts, never inferences. Hallucinations in the graph propagate forever.
- **No `print()`** — events flow through EventBus to TUI widgets.
- **No hardcoded values** — everything from `config/settings.toml` or `.env`.
- **Graph nodes are the source of truth** — if it's not in the graph, the model says "No tengo información verificada."
- **One model, prompt-driven behavior** — acervo-extractor-qwen3.5-9b handles both chat and extraction. The system prompt determines output format (JSON for S1/S1.5, natural language for chat). A separate extractor model can be configured in `.acervo/config.toml` if needed.

## Config

`config/settings.py` loads `config/settings.toml` merged with `.env`. Returns frozen `Settings` dataclass. Key sections: `[lmstudio]`, `[lmstudio_utility]`, `[ollama]`, `[context]`, `[graph]`, `[pricing]`.

## Runtime data

`data/` directory (gitignored): `graph/` (nodes.json, edges.json), `topics/` (.md per topic), `training/` (corrections.jsonl), `sessions/`.
