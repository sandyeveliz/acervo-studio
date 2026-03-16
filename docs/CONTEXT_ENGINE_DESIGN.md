# Context Index — Diseño

El Context Index es la capa entre el usuario y el LLM que decide qué información
ve el modelo en cada turno. No genera texto, no toma decisiones de negocio.
Es un runtime de contexto — la analogía exacta es un sistema operativo gestionando RAM.

## El problema que resuelve

El modelo clásico acumula todos los mensajes en cada llamada. El contexto crece
linealmente y el mecanismo de atención del transformer procesa todos los tokens
contra todos — el doble de tokens es aproximadamente el cuádruple de cómputo.

El Context Index mantiene el contexto siempre pequeño y preciso. El modelo
siempre recibe solo lo que necesita para responder ahora.

## El Context Stack

Cada llamada al LLM recibe exactamente esto, en este orden:

```
[System Prompt — fijo, cacheado con KV cache]
[Topic activo — archivo .md del nodo activo en el grafo]
[Sub-topics activos — nodos hijos relevantes]
[Capa caliente — últimos 3-5 mensajes completos]
[Mensaje nuevo del usuario]
```

## Las 3 capas de memoria

**Capa caliente** — últimos N mensajes completos en texto plano.
Se actualiza cada turno. Es lo que acaba de pasar sin procesar.

**Capa tibia** — estado del topic activo como archivo .md.
Hechos extraídos y estructurados, no diálogo. Se actualiza cuando:
- La capa caliente supera el umbral de tokens
- Cambia el topic o sub-topic activo

**Capa fría** — grafo de topics persistido en disco.
No entra al contexto directamente. Se consulta via traversal cuando
un topic conocido se vuelve a activar. Es la memoria de largo plazo.

## El Grafo de Memoria Episódica

**Principio fundamental: un topic nunca se duplica, se enriquece.**

Si "Gallardo" se menciona 15 veces en 3 meses, hay un solo nodo en el grafo.
Cada conversación agrega aristas y atributos al nodo existente.

### Estructura de nodo

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
    {
      "fact": "según el usuario no jugaba de esa manera",
      "date": "2026-03-15",
      "session": "s_042"
    }
  ],
  "edges": [
    {"target": "river_plate", "relation": "pertenece_a", "weight": 1.0},
    {"target": "partido_20260315", "relation": "referenciado_en", "weight": 0.8}
  ]
}
```

### Archivo .md de topic (lo que entra al contexto)

```markdown
# Gallardo, Marcelo

**Tipo:** persona
**Última actividad:** 2026-03-15
**Sesiones:** 5

## Hechos conocidos
- Entrenador de River Plate
- El usuario es hincha de River
- Según el usuario, no jugaba de esa manera [2026-03-15]

## Sub-topics relacionados
- Táctica 4-3-3 (peso: 0.6)
- Partido 2026-03-15 (cacheado)
```

~200-400 tokens por topic. El LLM lo lee directamente sin parsing.

## Detección de Topic Change

Tres niveles en orden de costo ascendente:

**Nivel 1 — Keywords explícitas** (0 costo)
Lista de patrones en español e inglés: "cambiando de tema", "ahora sobre",
"otra cosa", "hablando de otra cosa", etc. Si matchea, cambio inmediato.

**Nivel 2 — Similitud de embeddings** (Ollama, muy rápido)
Embedding del nuevo mensaje vs embedding del topic activo.
Similitud coseno < 0.65 → posible cambio. Puede ser sub-topic nuevo.

**Nivel 3 — Clasificación LLM** (solo si Nivel 2 es ambiguo)
Prompt mínimo al modelo: dado el topic activo y el nuevo mensaje,
es (a) mismo tema, (b) sub-tema nuevo, o (c) tema diferente.
El modelo responde solo a, b o c.

## Routing Pre-LLM

El router decide qué información necesita el modelo antes de llamarlo:

**static** → el modelo responde con su conocimiento base. Sin tools, sin búsqueda.
Para historia, conceptos, código, matemática — cualquier cosa que no cambie.

**search** → web search primero. El resultado entra al contexto como bloque temporal
solo para ese turno. Los tokens del resultado se suman al contexto de esa llamada.
Para eventos actuales, noticias, datos que cambian.

**memory** → traversal del grafo. Se carga el estado del nodo (el .md compacto).
Entra como "contexto recuperado", no como historial de conversación.
Para cuando el topic ya existió en sesiones anteriores.

**ask** → el modelo hace una pregunta corta al usuario sin asumir nada.
"¿De qué issue es?" en lugar de buscar o inventar.
Para cuando falta información y no hay forma de inferirla.

La decisión la toma el router, no el modelo. El modelo solo ve el resultado.

## Background Worker

asyncio.Task separado que nunca bloquea al agente principal.
Opera sobre una Queue de topics cacheados, en orden de prioridad.

Por cada topic en la queue:
1. Llama al LLM para extraer entidades y hechos explícitos
2. Busca en el grafo si el nodo existe
3. Si existe: agrega hechos y aristas nuevas
4. Si no existe: crea el nodo
5. Actualiza el archivo .md del topic
6. Persiste el grafo en disco

## Merge de Topics

Cuando dos nodos son el mismo tema desde ángulos distintos, el worker los mergea si:
- Similitud de embeddings entre nodos > 0.85
- Comparten más de 3 aristas hacia los mismos targets
- Fueron activos en sesiones solapadas

El nodo secundario queda como alias. Todos los hechos y aristas van al nodo principal.

## KV Cache

El system prompt debe ser idéntico entre llamadas para que LM Studio lo cachee.
Todo contenido dinámico va como mensajes separados antes del mensaje del usuario.
Nunca concatenar nada al system prompt en runtime.

## Providers

Interfaz unificada — todos exponen `chat()` y `embed()`:

| Provider | Rol | Endpoint |
|---|---|---|
| LM Studio | Chat, stream, summarización, extracción | localhost:1234 |
| Ollama | Embeddings exclusivamente | localhost:11434 |
| OpenRouter | Fallback si LM Studio supera latencia threshold | api.openrouter.ai |
| Anthropic | Opcional para tareas que superan Qwen 9b | api.anthropic.com |

Reglas del router:
- Embeddings → siempre Ollama, nunca otro provider
- Chat → LM Studio primero
- Latencia LM Studio > 3s → fallback a OpenRouter
- Datos sensibles → forzar local, nunca remoto
- Summarización y extracción → modelo local quantizado
