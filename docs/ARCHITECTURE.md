# AVS-Agents — Arquitectura

Documento actualizado con el estado real de la implementación.

---

## Pipeline de conversación

```
Usuario escribe mensaje
        │
        ▼
┌─────────────────────┐
│   Topic Detector    │  L1 keywords → L2 embeddings → L3 LLM
│   (sin LLM / Ollama │  Resultado: SAME | CHANGED | SUBTOPIC
│    / Qwen 2.5 3B)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Activate Nodes     │  Busca nodos del grafo por label/prefix match
│  (determinístico)   │  "cipo" → activa "cipolletti" como HOT
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Query Planner     │  Llamada A al LLM (Qwen 2.5 3B, temp=0, max=100tk)
│   (Qwen 2.5 3B)    │  Decide: GRAPH_ALL | GRAPH_SEARCH | VECTOR_SEARCH
│                     │          WEB_SEARCH | READY
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│     Executor        │  Ejecuta el plan del Planner
│  (determinístico)   │  GRAPH_ALL: synthesize() + traversal 1 nivel
│                     │  GRAPH_SEARCH: filtro por tipo/keyword
│                     │  VECTOR/WEB: stubs (no implementados aún)
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Context Index     │  Arma el context stack:
│                     │    system prompt (fijo, KV cached)
│                     │    [CONTEXTO VERIFICADO] warm del executor
│                     │    "Entendido." ACK
│                     │    hot layer (sliding window, max 2 pares)
│                     │    mensaje actual del usuario
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   LM Studio         │  Llamada B: streaming con modelo principal
│   (Qwen 3.5 9B)    │  Recibe solo el context stack optimizado
│                     │  Think blocks filtrados del output
└────────┬────────────┘
         │
         ▼
    Respuesta al usuario
         │
         ├──────────────────────────┐
         ▼                          ▼
┌──────────────────┐    ┌─────────────────────┐
│ Entity Extractor │    │ Confirmation Detect  │
│ (Qwen 2.5 3B)   │    │ (pattern matching)   │
│ - entidades      │    │ "¿Lo confirmo?"      │
│ - relaciones     │    └──────────┬──────────┘
│ - facts          │               │
└────────┬─────────┘               ▼
         │                  Pending state
         ▼                  (espera "sí")
┌──────────────────┐
│   Topic Graph    │
│  (NetworkX/JSON) │
│  nodes.json      │
│  edges.json      │
└──────────────────┘
```

---

## Estructura de archivos

```
AVS-Agents/
├── main.py                          # Entry point → TUI
├── pyproject.toml
├── config/
│   ├── settings.py                  # Dataclasses: Settings, LMStudioSettings, etc.
│   ├── settings.toml                # Config principal
│   └── agents/
│       └── default.yaml             # System prompt + temperature
│
├── core/
│   ├── context_index.py             # *** Context stack builder ***
│   ├── context_synthesizer.py       # Renderiza nodos del grafo → texto
│   ├── query_planner.py             # LLM decide qué herramienta usar
│   ├── executor.py                  # Ejecuta el plan del planner
│   ├── pipeline.py                  # Orquestador del turno completo
│   ├── topic_detector.py            # Detección de cambio de topic (3 niveles)
│   ├── event_bus.py                 # Pub/sub para eventos del pipeline
│   ├── events.py                    # Dataclasses de eventos tipados
│   ├── training_capture.py          # Guarda pares de corrección como JSONL
│   └── router.py                    # (legacy) Router determinístico
│
├── memory/
│   ├── graph.py                     # TopicGraph: nodos, aristas, persistencia JSON
│   └── extractor.py                 # ConversationExtractor: entidades + facts del diálogo
│
├── providers/
│   ├── base.py                      # ABC ModelProvider + dataclasses
│   ├── lmstudio.py                  # LM Studio (chat + streaming)
│   ├── ollama.py                    # Ollama (embeddings únicamente)
│   └── model_router.py              # ModelRouter: main + utility providers
│
├── tui/
│   ├── app.py                       # Textual App: layout, eventos, streaming
│   └── widgets/
│       ├── chat_panel.py            # Chat + timeline unificado
│       ├── log_stream.py            # StatsPanel + TopicsDisplay
│       └── trace_panel.py           # (no montado, disponible para debug)
│
├── utils/
│   ├── text.py                      # strip_think_blocks, sanitización
│   └── token_counter.py             # count_tokens (tiktoken)
│
├── data/                            # Runtime, gitignored
│   ├── graph/
│   │   ├── nodes.json               # Nodos del grafo episódico
│   │   └── edges.json               # Aristas con relaciones semánticas
│   ├── topics/                      # .md por topic (compactación)
│   ├── training/
│   │   └── corrections.jsonl        # Pares de entrenamiento
│   └── sessions/
│
└── docs/
    ├── ARCHITECTURE.md              # Este documento
    ├── CONTEXT_ENGINE_DESIGN.md     # Diseño original del Context Index
    └── SESSION_LOG_2026-03-16.md    # Log de la sesión de desarrollo
```

---

## Modelos

| Modelo | Rol | Cuándo se usa |
|--------|-----|---------------|
| `unsloth/qwen3.5-9b` (Q4_K_M) | Chat principal | Responder al usuario, streaming |
| `qwen2.5-3b-instruct` | Utility | Planner, extractor, topic detector L3, topic label |
| Ollama embeddings | Embeddings | Topic detector L2 (similitud coseno) |

---

## Grafo episódico

### Nodo
```json
{
  "id": "cipolletti",
  "label": "Cipolletti",
  "type": "lugar",
  "status": "hot|warm|cold",
  "session_count": 35,
  "facts": [
    {"fact": "Sandy vive en Cipolletti", "source": "user", "date": "2026-03-16", "session": "s_..."}
  ]
}
```

### Arista
```json
{
  "source": "sandy",
  "target": "cipolletti",
  "relation": "ubicado_en",
  "weight": 1.0
}
```

### Tipos de entidad
`lugar`, `persona`, `entidad`, `actividad`

### Tipos de relación
`ubicado_en`, `relacionado_con`, `hincha_de`, `dirigido_por`, `ganó_a`, `jugó_contra`, `juega_en`, `pertenece_a`, `parte_de`, `tecnico_de`, `co_mentioned`

### Status lifecycle
```
Inicio de turno: cycle_status()  hot→warm, warm→cold
Activate nodes: _activate_mentioned_nodes()  cold/warm→hot si mencionado
Topic persistence: topic activo siempre queda hot
Fin de turno: upsert_entities()  nodos nuevos/actualizados→hot
```

---

## Context Stack (lo que recibe el LLM)

```
[1] system     System prompt (fijo, KV cached, ~200tk)
[2] user       [CONTEXTO VERIFICADO]\n{warm del grafo}\n[FIN CONTEXTO]
[3] assistant  "Entendido."
[4] user       Mensaje anterior 1 (hot layer)
[5] assistant  Respuesta anterior 1 (hot layer)
[6] user       Mensaje actual del usuario
```

### Budget dinámico
- Target: ~2000tk
- Warm (grafo): siempre entra completo, prioridad máxima
- Hot (historial): lo que sobre, max 2 pares
- Si un turno requiere más (mensaje largo), se usa más
- Siguiente turno vuelve al rango porque el extractor procesó todo al grafo

---

## Eventos del pipeline

Cada paso emite un evento tipado via EventBus. Los eventos aparecen inline en el chat como TimelineSteps.

| Evento | Cuándo |
|--------|--------|
| `MessageReceived` | Usuario envía mensaje |
| `TopicDetectStep` | Resultado de L1/L2/L3 |
| `TopicChanged` | Topic cambió o es nuevo |
| `PlannerDecision` | Planner eligió herramienta |
| `ExecutorResult` | Executor completó búsqueda |
| `ContextBuilt` | Context stack armado |
| `StreamStarted/Completed` | LLM streaming |
| `ExtractionCompleted` | Entidades extraídas |
| `GraphUpdated` | Grafo persistido |
| `ConfirmationPending/Accepted` | Corrección pendiente/confirmada |
| `TrainingSampleSaved` | Par de entrenamiento guardado |

---

## Pendiente de implementar

### Prioridad alta
- [ ] Web search tool (executor._exec_web_search)
- [ ] Vector search via ChromaDB (executor._exec_vector_search)
- [ ] Validación de edges: evitar self-references y relaciones incorrectas
- [ ] Deduplicación automática de nodos (merge de nodos similares)

### Prioridad media
- [ ] Session summarizer al cerrar sesión
- [ ] Graph explorer TUI screen
- [ ] RAG: embedder + vector_store + retriever
- [ ] Skills framework (@skill decorator)

### Prioridad baja
- [ ] Protocolos inter-agente: MCP, A2A, ANP
- [ ] Agent class + Orchestrator + Teams
- [ ] OpenRouter fallback para latencia alta
- [ ] Dashboard TUI screen
