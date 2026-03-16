# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AVS-Agents — Python TUI app (Textual) for managing AI agent teams with a novel Context Index that replaces linear history accumulation with topic-active context and an episodic memory graph.

## Commands

```bash
# Install
pip install -e .

# Run
python main.py

# No test framework configured yet
```

## Architecture

**Entry point:** `main.py` → `tui/app.py` (Textual App)

**Layer dependency order** (each depends on layers above it):

1. **config/** — Frozen dataclasses loaded from `settings.toml` + `.env`. All config flows through `load_settings()`.
2. **providers/** — LLM abstraction. `ModelProvider` ABC with `chat()`, `chat_stream()`, `embed()`. LM Studio handles chat, Ollama handles embeddings only. `ModelRouter` composes both and adds latency-based fallback logic.
3. **core/** — Agent orchestration. `context_index.py` is the most important module — it builds the 3-layer context stack (hot/warm/cold) sent to the LLM each turn. `topic_detector.py` has 3 detection levels (keywords → embeddings → LLM classification). `router.py` makes pre-LLM routing decisions (static/search/memory/ask).
4. **memory/** — Episodic memory graph (NetworkX + JSON persistence). Topic nodes with facts and weighted edges. `graph_worker.py` runs as a background asyncio.Task on a Queue, never blocking the main agent.
5. **rag/** — ChromaDB vector store with topic-based pre-filtering via Ollama embeddings.
6. **skills/** — Agent capabilities with `@skill` decorator pattern.
7. **protocols/** — Inter-agent communication: MCP (Anthropic), A2A (Google), ANP (HTTP/WS).
8. **tui/** — Textual screens and widgets for dashboard, chat, logs, graph explorer.

## Context Index (the core differentiator)

Full design in `docs/CONTEXT_ENGINE_DESIGN.md`. The context stack sent to the LLM each turn:

```
[System Prompt — fixed, KV cached]     ← NEVER modify at runtime
[Topic .md — warm layer]               ← ~200-400 tokens structured facts
[Sub-topics — related child nodes]
[Hot layer — last 3-5 raw messages]
[User message]
```

Three memory layers: **hot** (last N messages verbatim), **warm** (topic .md with extracted facts), **cold** (graph on disk, consulted via traversal on reactivation).

## Architectural invariants

- **Async-only I/O** — never block the event loop. All providers use `AsyncOpenAI`, `ollama.AsyncClient`, `aiofiles`.
- **System prompt is immutable between calls** — LM Studio KV cache depends on identical prefix. Dynamic content goes as separate messages before the user message.
- **Embeddings ≠ chat** — Ollama exclusively for embeddings, LM Studio exclusively for chat. Never mix.
- **graph_worker never blocks the agent** — runs in its own `asyncio.Task`, communicates via `asyncio.Queue`.
- **Extractor is conservative** — only stores explicit facts from messages, never inferences. A hallucination in the graph propagates to all future sessions.
- **No `print()`** — use Rich logger everywhere.
- **No hardcoded values** — everything from `config/settings.toml` or `.env`.

## Config system

`config/settings.py` loads `config/settings.toml` (defaults) merged with `.env` (overrides via env vars). Returns a single frozen `Settings` dataclass. Key env vars: `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL`, `OLLAMA_BASE_URL`, `OLLAMA_EMBED_MODEL`.

## Provider pattern

All providers implement `ModelProvider` ABC from `providers/base.py`. Data types: `ChatMessage`, `ChatResponse`, `StreamChunk`, `EmbedResponse` — all plain dataclasses. `ModelRouter` is the unified entry point for all LLM calls.

## Runtime data

`data/` directory (gitignored) holds: `graph/` (nodes.json, edges.json), `topics/` (.md files per active topic), `sessions/`, `chroma/` (vector DB).
