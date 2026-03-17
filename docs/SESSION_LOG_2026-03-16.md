# Session Log — 2026-03-16

Sesión completa de desarrollo del proyecto AVS-Agents. Desde cero hasta un pipeline funcional con Context Engine, Query Planner, y TUI unificado.

---

## Fase 1: Setup del proyecto

- Limpieza del proyecto de aprendizaje (`steps/`, `utils/`, `logs/`)
- Creación de la estructura de directorios completa según el brief
- Archivos base: `pyproject.toml`, `.env.example`, `.gitignore`, `settings.toml`
- `docs/CONTEXT_ENGINE_DESIGN.md` con el diseño del Context Index

## Fase 2: TUI básico + Chat con LM Studio

- `tui/app.py` — Textual App con chat panel, stats panel, input
- `tui/widgets/chat_panel.py` — MessageBubble con roles (user/assistant/system)
- `tui/widgets/log_stream.py` — StatsPanel con modelo, tokens, latencia, TTFT
- `tui/widgets/trace_panel.py` — TracePanel con pipeline steps
- `providers/base.py` — interfaz abstracta ModelProvider
- `providers/lmstudio.py` — LM Studio provider con streaming
- `providers/model_router.py` — ModelRouter con provider principal + utility
- Botón Reset (Ctrl+R), Copy chat (Ctrl+Y)

## Fase 3: Topic Detector (3 niveles)

- `core/topic_detector.py` con L1 (keywords), L2 (embeddings Ollama), L3 (LLM clasificador)
- L1: regex patterns en español e inglés para cambio explícito de tema
- L2: similitud coseno con embeddings de Ollama (threshold 0.65)
- L3: prompt mínimo a/b/c para clasificación LLM
- Integrado al pipeline: cada mensaje pasa por detección antes del LLM

## Fase 4: Entity Extractor + Graph

- `memory/extractor.py` — ConversationExtractor que usa el modelo utility (Qwen 2.5 3B)
- `memory/graph.py` — TopicGraph con persistencia JSON (nodes.json, edges.json)
- Problema resuelto: el Qwen 3.5 9B no seguía instrucciones de formato JSON por el `<think>` mode
- Solución: modelo utility separado (Qwen 2.5 3B sin thinking) para extracción
- Facts concretos vs metadatos: "Sandy vive en Cipolletti" en vez de "el usuario menciona..."
- Entity blacklist para evitar nodos basura (hola, usuario, assistant, etc.)
- Relaciones semánticas: ubicado_en, hincha_de, dirigido_por, ganó_a, jugó_contra

## Fase 5: Context Synthesizer + Context Index

- `core/context_synthesizer.py` — renderiza nodos del grafo a texto compacto
- `core/context_index.py` — construye el context stack para el LLM
- Stack structure: system → [CONTEXTO VERIFICADO] → "Entendido." → hot layer → user
- Detección de identidad del usuario via regex en facts del grafo
- Neighbor traversal: 1 nivel de profundidad, max 5 vecinos, ordenados por weight
- Hot/warm/cold status cycling por turno

## Fase 6: Router → Query Planner + Executor

- `core/router.py` — router determinístico original (static/memory/search/ask)
- Reemplazado por `core/query_planner.py` + `core/executor.py`
- Planner usa LLM para decidir: GRAPH_ALL, GRAPH_SEARCH, VECTOR_SEARCH, WEB_SEARCH, READY
- Executor ejecuta con fallback automático
- VECTOR_SEARCH y WEB_SEARCH son stubs por ahora

## Fase 7: Timeline unificado

- TracePanel eliminado como panel separado
- `TimelineStep` widget inline en ChatPanel
- Pipeline steps aparecen intercalados con mensajes como en Claude Code
- Facts filtered y training samples silenciados para no clutterear
- CTX collapsible muestra payload JSON completo con roles

## Fase 8: Sliding Window + Budget dinámico

- Hot layer como sliding window: max 2 pares O budget dinámico de tokens
- Warm (grafo) siempre entra completo — prioridad máxima
- Hot se ajusta al espacio restante (target ~2000tk)
- Pares evicted se envían al extractor antes de descartarse
- Compactación explícita ya no necesaria

## Fase 9: Pending Confirmation + Training Capture

- Sistema de confirmación para correcciones del usuario
- Solo se dispara cuando el usuario CORRIGE algo que el modelo dijo mal
- `core/training_capture.py` — guarda pares corrección/confirmación/rechazo como JSONL
- `data/training/corrections.jsonl` para futuro fine-tuning
- Detección de corrección vs afirmación nueva (preguntas vs statements)

## Problemas resueltos durante la sesión

1. **`<think>` blocks del Qwen 3.5**: modelo pensaba 4000+ tokens y truncaba el JSON → modelo utility separado sin thinking
2. **`.format()` con JSON**: llaves en el prompt del extractor interpretadas como placeholders → doble escape `{{}}`
3. **Template de Jinja en LM Studio**: "No user query found" → estructura system→user→assistant→user
4. **Encoding UTF-8 vs Latin-1**: acentos guardados como bytes Latin-1 → fix de encoding
5. **Entity blacklist**: "Hola!", "user", "provincia" creados como nodos → strip punctuation + blacklist expandida
6. **Topic label en chino**: Qwen 3B mezclaba idiomas → strip non-Latin chars + prompts en español
7. **Confirmation trigger excesivo**: modelo pedía confirmación para todo → solo en correcciones explícitas
8. **Fact en entity equivocada**: fact se guardaba en el topic activo en vez de la entidad mencionada → búsqueda por posición en el mensaje del usuario
9. **Relación juega_en mal usada**: "le ganó a Sarmiento" interpretado como juega_en → nuevas relaciones ganó_a, jugó_contra

## Métricas finales del grafo

- 11 nodos, 12 aristas limpias
- 9 tipos de relación: ubicado_en, relacionado_con, hincha_de, dirigido_por, ganó_a, jugó_contra, juega_en, co_mentioned, pertenece_a
- Facts verificados: solo source: user o user_confirmed
- Modelo principal: unsloth/qwen3.5-9b (Q4_K_M GGUF)
- Modelo utility: qwen2.5-3b-instruct (sin thinking, para extracción y planner)
