# Agent Learning Path

Proyecto de aprendizaje paso a paso para entender el loop de un agente LLM, desde la conexión más básica hasta tener agentes completos con historial, tools y concurrencia.

## Objetivo

Aprender a construir un sistema de agentes que llamen a LM Studio, de lo más simple a lo más complejo. Este proyecto es el **paso previo** al Context Engine documentado en [`docs/CONTEXT_ENGINE_DESIGN.md`](docs/CONTEXT_ENGINE_DESIGN.md).

## Prerequisitos

- **Python 3.11+**
- **LM Studio** corriendo en `localhost:1234` con un modelo cargado (ej: Qwen 2.5 9b Instruct)
- Instalar dependencias:

```bash
cd agent_learning
pip install -e .
# o directamente:
pip install openai tiktoken python-dotenv rich anyio aiofiles
```

- Copiar `.env.example` a `.env` y ajustar si es necesario:

```bash
cp .env.example .env
```

## Steps

Cada step es un script standalone. Correr en orden desde el directorio `agent_learning/`:

### Step 01 — Hello LM Studio
```bash
python steps/step_01_hello_lmstudio.py
```
Conexión básica a LM Studio. Un mensaje, una respuesta, ver tokens usados y latencia.
**Aprendés:** cómo funciona el SDK de OpenAI contra un servidor local.

### Step 02 — Historial
```bash
python steps/step_02_history.py
```
Loop de conversación con historial acumulativo. Muestra cómo crece el contexto turno a turno.
**Aprendés:** cómo el contexto se acumula y por qué importa gestionarlo.

### Step 03 — Streaming
```bash
python steps/step_03_streaming.py
```
Lo mismo que step 02 pero con `stream=True`. La respuesta aparece token por token.
**Aprendés:** streaming, TTFT (time to first token), tokens por segundo.

### Step 04 — Tool Use
```bash
python steps/step_04_tool_use.py
```
Dos tools simples (fecha actual y leer archivo). El modelo decide cuándo usarlos.
**Aprendés:** function calling, cómo los resultados de tools se suman al contexto.

### Step 05 — Agent Class
```bash
python steps/step_05_agent_class.py
```
Clase `Agent` reutilizable con system prompt, historial, tools con decorador y logging.
**Aprendés:** cómo encapsular el loop del agente en una abstracción limpia.

### Step 06 — Dos Agentes en Paralelo
```bash
python steps/step_06_two_agents.py
```
Dos conversaciones simultáneas con asyncio. Un agente simula al usuario, otro responde.
**Aprendés:** concurrencia con agentes, asyncio, coordinación multi-agente.

## Estructura

```
agent_learning/
├── steps/          ← scripts de aprendizaje (step_01 a step_06)
├── utils/          ← logger y token counter compartidos
├── logs/           ← logs generados en runtime (no commiteados)
├── docs/           ← documento de diseño del Context Engine
├── pyproject.toml
├── .env.example
└── README.md
```

## Logs

Cada step genera logs en `logs/` con formato JSON lines. Cada entrada incluye:
- Timestamp
- Tokens usados (prompt, completion, total)
- Latencia
- Preview de la respuesta
- Tool calls si los hubo

## Siguiente paso

Una vez completados los 6 steps, el destino final es el **Context Engine** (Topic Graph Agent) documentado en [`docs/CONTEXT_ENGINE_DESIGN.md`](docs/CONTEXT_ENGINE_DESIGN.md). Ese sistema reemplaza el modelo clásico de acumulación de historial por uno basado en topics activos y un grafo de memoria episódica.
