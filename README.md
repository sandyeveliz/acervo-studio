# AVS-Agents

Aplicación Python con TUI (Textual) para crear y gestionar equipos de agentes de IA que corren en background.

Los agentes usan LM Studio (Qwen 3.5 9b) como LLM local, Ollama (Qwen embeddings) para RAG, y se comunican entre sí via A2A y ANP.

## Diferencial

El **Context Index** — un runtime de contexto propio que reemplaza el modelo clásico de acumulación de historial por un sistema de topics activos y grafo de memoria episódica. El contexto que recibe el modelo es siempre pequeño, preciso y relevante.

Ver diseño completo en [`docs/CONTEXT_ENGINE_DESIGN.md`](docs/CONTEXT_ENGINE_DESIGN.md).

## Prerequisitos

- **Python 3.11+**
- **LM Studio** corriendo en `localhost:1234` con un modelo cargado
- **Ollama** corriendo en `localhost:11434` con modelo de embeddings

## Setup

```bash
pip install -e .
cp .env.example .env
```

## Uso

```bash
python main.py
```
