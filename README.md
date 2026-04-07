# Acervo Studio

Web UI for [Acervo](https://github.com/sandyeveliz/acervo) — the semantic compression layer for AI agents.

Acervo Studio provides a visual interface for managing projects, chatting with context-aware AI, inspecting the knowledge graph, and monitoring pipeline performance.

## Features

- **Multi-project support** — Switch between projects, each with its own knowledge graph, chat history, and configuration
- **Chat with context injection** — Every message is enriched with relevant context from the graph via Acervo's S1/S2/S3 pipeline
- **Document Notes** — The chat model can create and update persistent .md files that get indexed into the knowledge graph
- **Skills system** — Install skills from GitHub repos (skills.sh compatible) or create custom ones. Skills are selected per-request via embedding similarity and injected into the LLM context
- **Agents** — Per-project agent configurations with custom system prompts and temperature
- **Pipeline trace viewer** — Inspect S1 (intent/entity extraction), S2 (node activation), S3 (context assembly) per turn with full debug data
- **Error recovery** — Pipeline errors show in chat with a retry button
- **Graph viewer** — Visualize entities, relations, and facts in the knowledge graph
- **Telemetry dashboard** — Per-turn metrics, latency profiling, GPU/VRAM snapshots, training data annotations
- **Project management** — Initialize, index, curate, and synthesize projects from the UI
- **MCP tool support** — Web search (Brave) and file operations via MCP, with management UI
- **Project config editor** — Read/write `.acervo/config.toml` from the Settings tab
- **Session export** — Copy, Markdown, or JSON export of chat sessions

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for web UI)
- **[Ollama](https://ollama.ai/)** running on `localhost:11434` with:
  - `acervo-extractor-v3-Q4_K_M` (fine-tuned extraction model)
  - `qwen3-embedding` (embeddings)
  - A chat model (e.g., `gemma4:e4b`)

## Setup

```bash
pip install -e .

cd web
npm install
```

## Usage

```bash
# Start everything with the Acervo CLI (recommended)
acervo up --dev

# Or start individually:
python server.py          # Backend on :8000
cd web && npm run dev     # Frontend on :5173
```

Open `http://localhost:5173` in your browser.

## Architecture

- **Backend**: FastAPI (`api/`) — WebSocket chat, REST routes for projects, graph, skills, agents, telemetry
- **Frontend**: React 19 + TypeScript (`web/`) — Vite, Tailwind, shadcn/ui, Recharts, Sigma.js
- **Core**: Pipeline orchestration (`core/`) — event bus, telemetry, file tools, turn logging
- **Providers**: LLM routing (`providers/`) — LM Studio/Ollama chat, Ollama embeddings, MCP client
- **Config**: Frozen dataclasses from `settings.toml` + `.env` (`config/`)

### Per-project data

Each project stores its data in `.acervo/`:
```
project/
  .acervo/
    config.toml          # Project configuration
    data/graph/          # Knowledge graph (nodes.json, edges.json)
    skills/*.yaml        # Installed and custom skills
    agents/*.yaml        # Agent configurations
    notes/*.md           # Document notes created by the chat model
    history.json         # Chat history
    telemetry.jsonl      # Per-turn metrics
    trace.jsonl          # Pipeline events
    annotations.jsonl    # Training data annotations
```

## Related

- **[Acervo](https://github.com/sandyeveliz/acervo)** — The core library (knowledge graph, context proxy, extraction pipeline)
- **[acervo-extractor-v3](https://huggingface.co/SandyVeliz/acervo-extractor-qwen3.5-9b)** — Fine-tuned extraction model

## License

Apache 2.0
