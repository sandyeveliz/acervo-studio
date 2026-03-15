# Topic Graph Agent — Context Engine Design

Documento de diseño. No es código — es la arquitectura del sistema a construir.

## Visión del Proyecto

Un sistema de agentes conversacionales en Python con TUI (Textual) que implementa un mecanismo de manejo de contexto experimental basado en topics activos y un grafo de memoria episódica, en lugar del modelo clásico de acumulación de historial de mensajes.

El sistema corre 100% local usando LM Studio (Qwen 3.5 9b) para chat y Ollama (Qwen embeddings) para RAG. Soporta además providers remotos como fallback.

El componente central tiene nombre propio: **Context Index** — la capa que vive entre el usuario y el LLM, que gestiona qué información ve el modelo y cuándo. No es un agente, no genera texto, no toma decisiones de negocio. Es un runtime de contexto.

La analogía exacta: es lo que hace un sistema operativo con la RAM. Los programas no gestionan su propia memoria — el OS decide qué está en RAM, qué está en swap, qué se descarta. El Context Index hace lo mismo con la ventana de atención del modelo.

## El Problema que Resuelve

El modelo clásico de contexto acumula todos los mensajes en cada llamada al LLM. El contexto crece linealmente y eventualmente se trunca o comprime sin criterio. Además el mecanismo de atención del transformer procesa todos los tokens en relación a todos los demás — el doble de tokens no es el doble de cómputo, es aproximadamente el cuádruple.

Este proyecto reemplaza ese modelo por uno donde el contexto es siempre pequeño y preciso porque solo contiene el topic activo y su estado actual. El modelo no ve la conversación completa, ve el estado semántico del momento.

## Concepto Central — Topic-Aware Context

### Qué es un Topic

Un topic es la unidad semántica activa de la conversación. No es un mensaje, no es un resumen — es el "tema del que se está hablando ahora". Puede ser "River Plate", "bug en el código", "receta de pasta", etc.

El sistema siempre sabe cuál es el topic activo. Cuando cambia el tema, el topic anterior se cachea y el nuevo se activa.

### El Context Stack en cada llamada al LLM

```
[System Prompt — fijo, cacheado con KV cache de LM Studio]
[Topic activo — estado actual del nodo en el grafo]
[Sub-topics activos — nodos hijos relevantes al momento]
[Últimos 3-5 mensajes — capa caliente, sin procesar]
[Mensaje nuevo del usuario]
```

Eso es todo. El modelo no ve la conversación completa, ve el estado semántico del momento.

### Capas de Memoria

**Capa caliente** — últimos N mensajes completos. Se actualiza turno a turno.

**Capa tibia** — estado del topic activo como nodo del grafo. Hechos extraídos, no diálogo. Se actualiza cuando la capa caliente supera el umbral o cuando cambia el sub-topic.

**Capa fría** — grafo persistido en disco. Se consulta vía traversal cuando un topic conocido vuelve a activarse. No entra en contexto directamente.

## El Grafo de Memoria Episódica

### Principio fundamental

**Un topic nunca se duplica — se enriquece.**

Si Gallardo se menciona 15 veces en 3 meses, hay un solo nodo "Gallardo" en el grafo. Cada conversación agrega aristas y atributos a ese nodo existente.

### Estructura de un Nodo

```json
{
  "id": "gallardo_marcelo",
  "label": "Gallardo",
  "type": "person",
  "created_at": "2026-01-10T14:23:00",
  "last_active": "2026-03-15T10:05:00",
  "session_count": 5,
  "attributes": {
    "rol": "entrenador River Plate",
    "usuario_es_hincha": true
  },
  "facts": [
    {"fact": "no jugaba de esa manera según el usuario", "date": "2026-03-15", "session": "s_042"},
    {"fact": "mencionado en contexto de partido del 15/03", "date": "2026-03-15", "session": "s_042"}
  ],
  "edges": [
    {"target": "river_plate", "relation": "pertenece_a", "weight": 1.0},
    {"target": "partido_20260315", "relation": "referenciado_en", "weight": 0.8},
    {"target": "tactica_433", "relation": "asociado_con", "weight": 0.6}
  ]
}
```

### Estructura de una Arista

```json
{
  "source": "gallardo_marcelo",
  "target": "partido_20260315",
  "relation": "referenciado_en",
  "weight": 0.8,
  "first_seen": "2026-03-15",
  "last_seen": "2026-03-15",
  "mention_count": 1
}
```

### El Grafo en Disco

El grafo vive en memoria durante la sesión y se persiste al terminar. Formato: JSON con lista de adyacencia. No requiere base de datos de grafos — un archivo JSON es suficiente para miles de nodos. Migración a NetworkX o SQLite es directa si se necesita escalar.

```
data/
  graph/
    nodes.json
    edges.json
  sessions/
    s_042_20260315.md
  topics/
    gallardo_marcelo.md    ← estado compacto del topic para el contexto
    river_plate.md
```

## Detección de Topic Change

El cambio de topic es el punto más crítico. Se detecta en tres niveles en orden de costo:

**Nivel 1 — Keywords explícitas (sin LLM, sin embeddings)**
El usuario dice "cambiando de tema", "ahora sobre X", "otra cosa", etc. Lista de patrones en español e inglés. Si matchea, cambio inmediato.

**Nivel 2 — Similitud de embeddings (Ollama, muy rápido)**
Embedding del nuevo mensaje vs embedding del topic activo. Si similitud coseno < 0.65 (configurable), posible cambio. No definitivo.

**Nivel 3 — Clasificación LLM (solo si Nivel 2 es ambiguo)**
Prompt mínimo: "¿este mensaje es (a) mismo tema, (b) sub-tema, o (c) tema diferente? Responder solo a, b o c." Llamada barata, modelo quantizado.

## Routing Pre-LLM

Antes de cada llamada al LLM el orquestador decide qué información necesita el modelo:

**Conocimiento estático** → responde directo. Sin tool use, sin búsqueda.

**Evento actual / dato cambiante** → web search primero. El resultado entra al contexto como bloque temporal solo para ese turno. Los tokens del resultado sí se suman al contexto.

**Memoria cross-session** → traversal del grafo. Se carga el estado del nodo (compacto). Entra como "contexto recuperado", no como historial.

**Dato no disponible** → el modelo pregunta cortito. "¿De qué issue es?" sin asumir nada.

La decisión la toma el orquestador, no el modelo. El modelo solo ve el resultado.

## Hilo de Fondo — Background Worker

Mientras el agente principal responde, un asyncio.Task separado:

1. Toma topics cacheados de la sesión actual
2. Extrae entidades y hechos con llamada separada al LLM
3. Busca en el grafo si el nodo ya existe
4. Si existe: enriquece con nuevos hechos y aristas
5. Si no existe: crea nodo nuevo
6. Persiste en disco

El agente principal nunca espera al worker. Opera sobre una queue de prioridad.

### Merge de Topics

Cuando dos nodos son el mismo tema visto desde ángulos distintos, el worker los mergea si:

* Similitud de embeddings > 0.85
* Comparten más de 3 aristas hacia los mismos targets
* Fueron activos en sesiones solapadas

El nodo secundario queda como alias. Todos los hechos y aristas se preservan en el principal.

## Model Providers

### Interfaz unificada

Todos los providers exponen:

* `chat(system, messages, stream) -> str`
* `embed(text) -> list[float]`

### Providers

| Provider | Uso | Endpoint |
|----------|-----|----------|
| LM Studio | Chat, summarización, extracción semántica | localhost:1234 |
| Ollama | Embeddings exclusivamente | localhost:11434 |
| OpenRouter | Fallback remoto | api.openrouter.ai |
| Anthropic | Opcional, tareas complejas | api.anthropic.com |

### Router de Models

* Embeddings → siempre Ollama
* Chat → LM Studio primero, fallback a OpenRouter si latencia > threshold
* Datos sensibles → forzar local, nunca remoto
* Summarización → modelo local quantizado

### KV Cache

El system prompt debe ser idéntico entre llamadas. El contenido dinámico (topic activo, contexto recuperado) va como mensajes separados, nunca concatenado al system prompt.

## Archivos Markdown de Topics

Cada topic activo tiene un .md que es su estado compacto para el contexto:

```markdown
# Gallardo, Marcelo

**Tipo:** persona
**Última actividad:** 2026-03-15
**Sesiones:** 5

## Hechos conocidos
- Es entrenador de River Plate
- El usuario es hincha de River
- Según el usuario, no jugaba de esa manera [2026-03-15]

## Contexto del partido 15/03
- River ganó 2-0
- Topic cacheado, no activo

## Sub-topics relacionados
- Táctica 4-3-3 (peso: 0.6)
- Partido 2026-03-15 (cacheado)
```

El LLM lo lee directamente sin parsing. ~200-400 tokens por topic.

## TUI — Textual

**Dashboard** — estado en tiempo real: agentes activos, topic activo, capas caliente/tibia.
**Agent Manager** — crear/editar/pausar agentes con system prompt y skills.
**Graph Explorer** — visualización del grafo, búsqueda por nodo, ver hechos.
**RAG Manager** — documentos indexados, estado del vector store.
**Logs** — stream de llamadas al LLM con tokens, latencia, provider, topic activo.

## Estructura del Proyecto Final

```
topic_graph_agent/
├── main.py
├── pyproject.toml
├── tui/
│   ├── app.py
│   ├── screens/
│   └── widgets/
├── core/
│   ├── orchestrator.py
│   ├── agent.py
│   ├── context_index.py           ← el Context Index, núcleo del sistema
│   ├── topic_detector.py
│   ├── router.py
│   └── message_bus.py
├── memory/
│   ├── graph.py
│   ├── graph_worker.py
│   ├── topic_node.py
│   ├── extractor.py
│   └── session_summarizer.py
├── providers/
│   ├── base.py
│   ├── lmstudio.py
│   ├── ollama.py
│   ├── openrouter.py
│   └── model_router.py
├── rag/
├── skills/
├── protocols/
└── config/
```

## Orden de Implementación

1. **Providers** — LM Studio y Ollama primero
2. **Topic Detector** — los 3 niveles de detección
3. **Context Index** — el context stack con las 3 capas
4. **Topic Graph** — nodos, aristas, traversal, persistencia
5. **Graph Worker** — background asyncio worker
6. **Router** — routing pre-LLM
7. **Agent** — clase base integrando todo
8. **TUI** — Textual app
9. **Skills + Protocols** — MCP, A2A, ANP

## Configuración (settings.toml)

```toml
[lmstudio]
base_url = "http://localhost:1234/v1"
model = "qwen2.5-9b-instruct"
context_window = 32000
kv_cache = true

[ollama]
base_url = "http://localhost:11434"
embed_model = "qwen2.5:7b"

[context]
hot_layer_max_messages = 5
warm_layer_max_tokens = 800
topic_change_embed_threshold = 0.65
compaction_trigger_tokens = 2000

[graph]
persist_path = "data/graph"
topics_path = "data/topics"
sessions_path = "data/sessions"
merge_similarity_threshold = 0.85

[routing]
max_local_latency_ms = 3000
sensitive_data_local_only = true
```

## Notas Críticas de Implementación

* `context_index.py` es el módulo más importante. Todo el valor del sistema está ahí.
* System prompt inmutable entre llamadas — el KV cache depende de esto.
* El `graph_worker` nunca bloquea al agente principal.
* Los archivos `.md` de topics son la interfaz entre el grafo y el LLM — solo markdown, sin JSON.
* El extractor semántico es conservador: solo hechos explícitos, nunca inferencias. Las alucinaciones en el grafo se propagan a todas las sesiones futuras.
* Embeddings (Ollama) y chat (LM Studio) son completamente separados. Nunca intercambiarlos.
