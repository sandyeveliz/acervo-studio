# Acervo Studio

AI conversation app with episodic memory graph. Uses a single fine-tuned model via LM Studio for both chat and extraction — behavior is determined by the system prompt. Ollama runs embeddings.

The core differentiator is the **Context Index**: each turn builds a fresh context from a persistent knowledge graph instead of accumulating conversation history.

See full design in [`docs/CONTEXT_ENGINE_DESIGN.md`](docs/CONTEXT_ENGINE_DESIGN.md).

## Prerequisites

- **Python 3.11+**
- **Node.js 18+** (for web UI)
- **LM Studio** running on `localhost:1234` with a model loaded
- **Ollama** running on `localhost:11434` with an embedding model

## Setup

```bash
pip install -e .
cp .env.example .env
# Edit .env with your configuration

cd web
npm install
npm run build
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
