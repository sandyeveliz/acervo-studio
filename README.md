# Acervo Studio

Web UI for [Acervo](https://github.com/sandyeveliz/acervo) — the semantic compression layer for AI agents.

Acervo Studio provides a visual interface for managing projects, chatting with context-aware AI, inspecting the knowledge graph, and monitoring pipeline performance.

## Features

- **Multi-project support** — Switch between projects, each with its own knowledge graph and configuration
- **Chat with context injection** — Every message is enriched with relevant context from the graph via Acervo's prepare/process pipeline
- **Pipeline trace viewer** — Inspect S1 (intent detection), S2 (node activation), and S3 (context assembly) per turn
- **Graph viewer** — Visualize entities, relations, and facts in the knowledge graph
- **Project management** — Initialize, index, curate, and synthesize projects from the UI
- **Indexation dashboard** — File status, operation timestamps, chunk inspection
- **Project config editor** — Read/write `.acervo/config.toml` from the Settings tab
- **Session export** — Copy, Markdown, or JSON export of chat sessions

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for web UI)
- **[LM Studio](https://lmstudio.ai/)** running on `localhost:1234` with `acervo-extractor-qwen3.5-9b` loaded
- **[Ollama](https://ollama.ai/)** running on `localhost:11434` with `qwen3-embedding`

## Setup

```bash
pip install -e .

cd web
npm install
```

## Usage

```bash
# Start the backend
python server.py

# Start the web UI (development)
cd web
npm run dev
```

Open `http://localhost:5173` in your browser.

Or use `acervo up --dev` from any Acervo project to start everything (Ollama, proxy, Studio backend, and web UI) in one terminal.

## Architecture

- **Backend**: FastAPI (`api/`) — REST routes for projects, graph, pipeline, and config management
- **Frontend**: React + TypeScript (`web/`) — Vite, Tailwind, shadcn/ui components
- **Core**: Pipeline orchestration (`core/`) — wraps Acervo library for multi-project support
- **Providers**: LLM routing (`providers/`) — LM Studio for chat/extraction, Ollama for embeddings

## Related

- **[Acervo](https://github.com/sandyeveliz/acervo)** — The core library (knowledge graph, context proxy, extraction pipeline)
- **[acervo-extractor-qwen3.5-9b](https://huggingface.co/SandyVeliz/acervo-extractor-qwen3.5-9b)** — Fine-tuned extraction model

## License

Apache 2.0
