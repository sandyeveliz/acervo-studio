/** Typed API client for Acervo Studio REST endpoints. */

const BASE = "http://localhost:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Graph ──

/** v0.6.1 source/status/confidence enums shared by nodes, edges, facts. */
export type GraphSource = "llm" | "user" | "system";
export type GraphStatus = "confirmed" | "pending_review";

export interface GraphFact {
  fact: string;
  date?: string;
  session?: string;
  source?: GraphSource;
  // v0.6.1 fields
  id?: string;
  confidence?: number;
  valid_at?: string;
  invalid_at?: string;
  expired_at?: string;
  reference_time?: string;
  dedup_status?: "flagged" | "duplicate" | null;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  description?: string;
  facts: GraphFact[];
  attributes: Record<string, unknown>;
  // v0.6.1: status is now a typed enum (was free-form string)
  status?: GraphStatus | null;
  layer?: string;
  owner?: string;
  confidence_for_owner?: number;
  created_at?: string;
  last_active?: string;
  session_count?: number;
  // v0.6.1 provenance fields
  confidence?: number;
  source?: GraphSource;
  updated_by?: GraphSource | null;
  updated_at?: string;
}

export interface GraphEdge {
  id: string;              // Present in LadybugDB backend; synthesized for old backend
  source: string;          // source NODE ID (predates v0.6.1 — naming collision with provenance)
  target: string;          // target NODE ID
  relation: string;
  weight: number;
  created_at?: string;
  layer?: string;
  // v0.6.1 provenance fields. The backend's "source" enum lives here as `source_type`
  // to avoid collision with the source-node-id field above. graphApi.getEdges() normalizes
  // the wire response into this shape.
  source_type?: GraphSource;
  confidence?: number;
  updated_by?: GraphSource | null;
  updated_at?: string;
  status?: GraphStatus | null;
}

/** Normalized stats shape used by all UI components. */
export interface GraphStats {
  total_nodes: number;
  total_edges: number;
  types_distribution: Record<string, number>;
  relations_distribution: Record<string, number>;
  orphan_count: number;
}

/** Raw shape returned by the current /graph/stats endpoint. */
interface RawGraphStats {
  node_count?: number;
  edge_count?: number;
  type_distribution?: Record<string, number>;
  // New fields (LadybugDB)
  total_nodes?: number;
  total_edges?: number;
  types_distribution?: Record<string, number>;
  relations_distribution?: Record<string, number>;
  orphan_count?: number;
}

function normalizeStats(raw: RawGraphStats): GraphStats {
  return {
    total_nodes: raw.total_nodes ?? raw.node_count ?? 0,
    total_edges: raw.total_edges ?? raw.edge_count ?? 0,
    types_distribution: raw.types_distribution ?? raw.type_distribution ?? {},
    relations_distribution: raw.relations_distribution ?? {},
    orphan_count: raw.orphan_count ?? 0,
  };
}

export interface ValidationLogEntry {
  id: string;
  timestamp: string;
  original_type: string;
  mapped_type: string;
  context: string;
  action?: "approved" | "corrected" | "discarded";
  corrected_type?: string;
  corrected_relation?: string;
}

export interface QualityIssue {
  type: "duplicate" | "leakage" | "orphan" | "unknown_type" | "empty_facts";
  severity: "warning" | "info";
  message: string;
  reason: string;
  node_ids: string[];
  nodes: GraphNode[];
}

export interface ExtractionEvent {
  timestamp: string;
  turn: number;
  user_message_preview: string;
  component: string;
  action: string;
  node_label: string;
  node_type: string | null;
  source: string;
  details?: Record<string, unknown>;
}

export interface GraphAnalysisStats {
  total_nodes: number;
  total_edges: number;
  by_source: Record<string, number>;
  by_type: Record<string, number>;
  by_kind: Record<string, number>;
  by_status: Record<string, number>;
  verified_count: number;
  unverified_count: number;
  placeholder_count: number;
  issue_count: number;
}

export interface GraphAnalysis {
  issues: QualityIssue[];
  stats: GraphAnalysisStats;
  extraction_log: ExtractionEvent[];
  system_prompt_preview: string;
}

// Existing endpoints use /graph/* (current backend).
// New endpoints use /acervo/graph/* (LadybugDB backend, landing soon).
// When the backend migration is complete, find-replace /graph/ → /acervo/graph/.

export const graphApi = {
  // ── Existing endpoints (/graph/*) ──

  getNodes: (type?: string) =>
    request<{ nodes: GraphNode[] }>(`/graph/nodes${type ? `?type=${type}` : ""}`),

  getNode: (id: string) =>
    request<GraphNode>(`/graph/nodes/${id}`),

  getEdges: async (nodeId?: string): Promise<{ edges: GraphEdge[] }> => {
    const res = await request<{ edges: GraphEdge[] }>(`/graph/edges${nodeId ? `?node_id=${nodeId}` : ""}`);
    // Synthesize id for old backend that doesn't return one
    for (const e of res.edges) {
      if (!e.id) e.id = `${e.source}-${e.target}-${e.relation}`;
    }
    return res;
  },

  getStats: async (): Promise<GraphStats> => {
    const raw = await request<RawGraphStats>("/graph/stats");
    return normalizeStats(raw);
  },

  exportGraph: () =>
    request<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/graph/export"),

  deleteNode: (nodeId: string) =>
    request<{ deleted: boolean; node_id: string }>(`/graph/nodes/${nodeId}`, {
      method: "DELETE",
    }),

  deleteFact: (nodeId: string, fact: string) =>
    request<GraphNode>(`/graph/nodes/${nodeId}/facts?fact=${encodeURIComponent(fact)}`, {
      method: "DELETE",
    }),

  mergeNodes: (sourceId: string, targetId: string) =>
    request<{ merged: boolean }>("/graph/merge", {
      method: "POST",
      body: JSON.stringify({ keep_id: sourceId, absorb_id: targetId }),
    }),

  importGraph: (data: { nodes: GraphNode[]; edges: GraphEdge[] }) =>
    request<{ imported: boolean }>("/graph/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAnalysis: () =>
    request<GraphAnalysis>("/graph/analysis"),

  createNode: (data: { label: string; type: string; description?: string; layer?: string; facts?: { fact: string; source?: string }[] }) =>
    request<GraphNode>("/graph/nodes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateNode: (nodeId: string, data: { label?: string; type?: string; description?: string; layer?: string; attributes?: Record<string, unknown> }) =>
    request<GraphNode>(`/graph/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  createEdge: (data: { source: string; target: string; relation: string; weight?: number }) =>
    request<GraphEdge>("/graph/edges", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── New endpoints (/acervo/graph/*) — will 404 until backend migrates ──

  updateEdge: (edgeId: string, data: { relation?: string }) =>
    request<GraphEdge>(`/acervo/graph/edges/${edgeId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // v0.6.1: confirm a pending_review node — sets status=confirmed, confidence=1.0.
  // Backend stamps updated_by="user" and updated_at automatically based on the request.
  confirmNode: (nodeId: string) =>
    request<GraphNode>(`/acervo/graph/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "confirmed", confidence: 1.0 }),
    }),

  confirmEdge: (edgeId: string) =>
    request<GraphEdge>(`/acervo/graph/edges/${edgeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "confirmed", confidence: 1.0 }),
    }),

  // v0.6.1: dedup pass over fact embeddings. Empty body = check all nodes.
  deduplicateFacts: (body: { node_ids?: string[] } = {}) =>
    request<{ checked: number; removed: number; flagged: number }>(
      "/acervo/graph/deduplicate-facts",
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  // v0.6.1: clear the dedup flag from a fact (the "Keep" action on a flagged duplicate).
  // Uses fact.id when available, otherwise falls back to the fact text as identifier.
  clearDedupFlag: (nodeId: string, factId: string) =>
    request<GraphNode>(
      `/acervo/graph/nodes/${nodeId}/facts/${encodeURIComponent(factId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ dedup_status: null }),
      },
    ),

  deleteEdge: (edgeId: string) => {
    // Old backend: parse synthesized ID "source-target-relation" into body params
    // New backend (LadybugDB): will use DELETE /acervo/graph/edges/{id}
    const parts = edgeId.split("-");
    if (parts.length >= 3) {
      const source = parts[0];
      const target = parts[1];
      const relation = parts.slice(2).join("-");
      return request<{ deleted: boolean }>("/graph/edges", {
        method: "DELETE",
        body: JSON.stringify({ source, target, relation }),
      });
    }
    // Fallback for real UUID-based IDs (new backend)
    return request<{ deleted: boolean }>(`/acervo/graph/edges/${edgeId}`, {
      method: "DELETE",
    });
  },

  getOrphans: () =>
    request<{ nodes: GraphNode[] }>("/acervo/graph/orphans"),

  getValidationLog: () =>
    request<{ entries: ValidationLogEntry[] }>("/acervo/graph/validation-log"),

  approveValidation: (entryId: string) =>
    request<{ updated: boolean }>(`/acervo/graph/validation-log/${entryId}/approve`, {
      method: "POST",
    }),

  correctValidation: (entryId: string, data: { corrected_type: string; corrected_relation?: string }) =>
    request<{ updated: boolean }>(`/acervo/graph/validation-log/${entryId}/correct`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  discardValidation: (entryId: string) =>
    request<{ updated: boolean }>(`/acervo/graph/validation-log/${entryId}/discard`, {
      method: "POST",
    }),

  exportTraining: async () => {
    const res = await fetch(`${BASE}/acervo/graph/export/training`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `HTTP ${res.status}`);
    }
    return res.blob();
  },
};

// ── MCP ──

export interface McpServer {
  name: string;
  status: string;
  error: string;
}

export const mcpApi = {
  getStatus: () => request<{ servers: McpServer[] }>("/mcp/status"),

  getConfig: () => request<{ config: Record<string, unknown> }>("/mcp/config"),

  saveConfig: (config: Record<string, unknown>) =>
    request<{ saved: boolean }>("/mcp/config", {
      method: "PUT",
      body: JSON.stringify({ config }),
    }),

  probe: () =>
    request<{ servers: McpServer[] }>("/mcp/probe", { method: "POST" }),
};

// ── Turn Log ──

import type { TurnLogEntry } from "./types";

export const turnLogApi = {
  getTurns: (session: string, last?: number) =>
    request<{ turns: TurnLogEntry[] }>(
      `/sessions/${session}/turns${last ? `?last=${last}` : ""}`,
    ),
};

// ── Settings ──

export interface AppSettings {
  lmstudio: {
    base_url: string;
    model: string;
    api_key: string;
    context_window: number;
    kv_cache: boolean;
  };
  lmstudio_utility: {
    base_url: string;
    model: string;
    api_key: string;
    context_window: number;
    kv_cache: boolean;
  };
  ollama: {
    base_url: string;
    embed_model: string;
  };
  context: {
    hot_layer_max_messages: number;
    hot_layer_max_tokens: number;
    warm_layer_max_tokens: number;
    topic_change_embed_threshold: number;
    compaction_trigger_tokens: number;
    plan_mode: boolean;
    history_window: number;
  };
  graph: {
    persist_path: string;
    topics_path: string;
    sessions_path: string;
    merge_similarity_threshold: number;
  };
  routing: {
    max_local_latency_ms: number;
    sensitive_data_local_only: boolean;
  };
  pricing: Record<string, number>;
  tui: {
    refresh_rate: number;
    log_max_lines: number;
  };
  web_search: {
    api_key: string;
    max_results: number;
    enabled: boolean;
  };
  plugins: {
    acervo: {
      enabled: boolean;
      proxy_url: string;
      acervo_dir: string;
    };
  };
}

export const settingsApi = {
  get: () => request<AppSettings>("/settings"),

  update: (updates: Record<string, unknown>) =>
    request<{ saved: boolean; settings: AppSettings }>("/settings", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
};

// ── Acervo Plugin ──

export interface AcervoProxyStatus {
  status: "active" | "pass-through" | "disabled" | "disconnected";
  turns?: number;
  changelog_entries?: number;
  target?: string;
  graph?: { node_count: number; edge_count: number };
  error?: string;
}

export interface AcervoGraphInfo {
  node_count: number;
  edge_count: number;
  nodes_by_type: Record<string, number>;
  acervo_dir: string;
  initialized: boolean;
}

export interface AcervoConfigData {
  initialized: boolean;
  model?: { name: string; url: string; api_key: string };
  embeddings?: { url: string; model: string; api_key: string };
  proxy?: { port: number; target: string };
  context?: { max_tokens: number; injection: string };
}

export interface ContextLayerNode {
  id: string;
  label: string;
  type: string;
  kind: string;
  source: string;
  verified: boolean;
  token_count: number;
  last_active: string;
  facts_count: number;
  edges_count: number;
}

export interface ContextLayersResponse {
  by_kind: Record<string, { nodes: ContextLayerNode[]; total_tokens: number }>;
  totals: {
    nodes: number;
    edges: number;
    total_tokens: number;
  };
}

export const acervoApi = {
  getStatus: () =>
    request<AcervoProxyStatus>("/plugins/acervo/status"),

  getChangelog: () =>
    request<{ changelog: { timestamp: string; action: string; tool: string; file: string }[] }>(
      "/plugins/acervo/changelog",
    ),

  testConnection: () =>
    request<{ ok: boolean; message: string; graph?: { node_count: number; edge_count: number } }>(
      "/plugins/acervo/test",
      { method: "POST" },
    ),

  getGraphInfo: () =>
    request<AcervoGraphInfo>("/plugins/acervo/graph-info"),

  getConfig: () =>
    request<AcervoConfigData>("/plugins/acervo/config"),

  updateConfig: (updates: Record<string, Record<string, unknown>>) =>
    request<{ saved: boolean }>("/plugins/acervo/config", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),

  getContextLayers: () =>
    request<ContextLayersResponse>("/plugins/acervo/context-layers"),

  clearData: () =>
    request<{ cleared: boolean; path: string }>("/plugins/acervo/data", {
      method: "DELETE",
    }),
};

// ── Projects ──

export interface Project {
  id: string;
  name: string;
  path: string;
  active: boolean;
  valid: boolean;
  initialized: boolean;
  nodes?: number;
  edges?: number;
  description?: string;
}

export interface ProjectsResponse {
  active: string | null;
  projects: Project[];
}

export interface FileStatusItem {
  path: string;
  status: "indexed" | "modified" | "new" | "deleted" | "unsupported";
  indexed_at: string | null;
  stale_since: string | null;
}

export interface FileStatusSummary {
  total: number;
  indexed: number;
  modified: number;
  new: number;
  deleted: number;
  unsupported: number;
}

export interface FileStatusResponse {
  files: FileStatusItem[];
  summary: FileStatusSummary;
}

export interface ProjectConfig {
  description: string;
  model: { name: string; url: string; api_key: string };
  models: {
    extractor: { name: string; url: string };
    summarizer: { name: string; url: string };
  };
  embeddings: { url: string; model: string; api_key: string };
  indexing: { extensions: string[]; ignore: string[]; content_type: string };
  context: { max_tokens: number; history_window: number };
  proxy: { port: number; target: string };
}

export const projectsApi = {
  list: () => request<ProjectsResponse>("/projects"),

  add: (name: string, path: string) =>
    request<Project & { nodes: number; edges: number }>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, path }),
    }),

  remove: (id: string) =>
    request<{ removed: string; active: string | null }>(`/projects/${id}`, {
      method: "DELETE",
    }),

  select: (id: string) =>
    request<Project & { nodes: number; edges: number }>(
      `/projects/${id}/select`,
      { method: "POST" },
    ),

  getActive: () =>
    request<(Project & { nodes: number; edges: number }) | { active: null }>(
      "/projects/active",
    ),

  browse: () =>
    request<{
      path: string | null;
      name: string;
      cancelled: boolean;
      initialized: boolean;
      nodes?: number;
      edges?: number;
    }>("/projects/browse", { method: "POST" }),

  checkPath: (path: string) =>
    request<{
      path: string;
      name: string;
      exists: boolean;
      initialized: boolean;
      nodes?: number;
      edges?: number;
    }>("/projects/check-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  init: (path: string) =>
    request<Project & { nodes: number; edges: number }>("/projects/init", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),

  checkServices: (projectId: string) =>
    request<{
      llm_available: boolean;
      embedder_available: boolean;
      llm_url: string;
      embedder_url: string;
    }>(`/projects/${projectId}/check-services`, { method: "POST" }),

  getOperations: (projectId: string) =>
    request<{
      indexed_at: string | null;
      curated_at: string | null;
      synthesized_at: string | null;
      node_count: number;
      edge_count: number;
    }>(`/projects/${projectId}/operations`),

  getConfig: (projectId: string) =>
    request<ProjectConfig>(`/projects/${projectId}/config`),

  updateConfig: (projectId: string, config: Partial<ProjectConfig>) =>
    request<{ saved: boolean }>(`/projects/${projectId}/config`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  updateDescription: (id: string, description: string) =>
    request<{ saved: boolean; description: string }>(
      `/projects/${id}/description`,
      {
        method: "PATCH",
        body: JSON.stringify({ description }),
      },
    ),

  getFileStatus: (id: string) =>
    request<FileStatusResponse>(`/projects/${id}/files/status`),

  markStale: (id: string, paths: string[]) =>
    request<{ marked: number }>(`/projects/${id}/files/mark-stale`, {
      method: "POST",
      body: JSON.stringify({ paths }),
    }),
};

/** Start indexing a project via SSE. Returns an AbortController to cancel. */
export function indexProject(
  projectId: string,
  structuralOnly = false,
): { controller: AbortController; response: Promise<Response> } {
  const controller = new AbortController();
  const response = fetch(`${BASE}/projects/${projectId}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structural_only: structuralOnly }),
    signal: controller.signal,
  });
  return { controller, response };
}

/** Start re-indexing stale files via SSE. Returns an AbortController to cancel. */
export function reindexProject(
  projectId: string,
): { controller: AbortController; response: Promise<Response> } {
  const controller = new AbortController();
  const response = fetch(`${BASE}/projects/${projectId}/reindex`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  });
  return { controller, response };
}

/** Start curation of a project via SSE. Returns an AbortController to cancel. */
export function curateProject(
  projectId: string,
): { controller: AbortController; response: Promise<Response> } {
  const controller = new AbortController();
  const response = fetch(`${BASE}/projects/${projectId}/curate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  });
  return { controller, response };
}

/** Start synthesis of a project via SSE. Returns an AbortController to cancel. */
export function synthesizeProject(
  projectId: string,
): { controller: AbortController; response: Promise<Response> } {
  const controller = new AbortController();
  const response = fetch(`${BASE}/projects/${projectId}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
  });
  return { controller, response };
}

// ── Agents ──

export interface AgentSummary {
  name: string;
  description: string;
  file: string;
}

export interface AgentConfig {
  name: string;
  description: string;
  system_prompt: string;
  temperature: number;
}

export const agentsApi = {
  list: () => request<{ agents: AgentSummary[] }>("/agents"),

  get: (name: string) => request<AgentConfig>(`/agents/${name}`),

  save: (name: string, config: AgentConfig) =>
    request<{ saved: boolean; name: string }>(`/agents/${name}`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  delete: (name: string) =>
    request<{ deleted: boolean; name: string }>(`/agents/${name}`, {
      method: "DELETE",
    }),
};

// ── Skills ──

export interface SkillSummary {
  name: string;
  description: string;
  file: string;
  source?: string;
}

export interface SkillConfig {
  name: string;
  description: string;
  content: string;
  source?: string;
  source_path?: string;
}

export interface BrowseSkill {
  name: string;
  description: string;
  path: string;
}

export const skillsApi = {
  list: () => request<{ skills: SkillSummary[] }>("/skills"),

  get: (name: string) => request<SkillConfig>(`/skills/${name}`),

  save: (name: string, config: SkillConfig) =>
    request<{ saved: boolean; name: string }>(`/skills/${name}`, {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  delete: (name: string) =>
    request<{ deleted: boolean; name: string }>(`/skills/${name}`, {
      method: "DELETE",
    }),

  browse: (repo: string) =>
    request<{ repo: string; skills: BrowseSkill[]; error?: string }>("/skills/browse", {
      method: "POST",
      body: JSON.stringify({ repo }),
    }),

  install: (repo: string, skills: string[]) =>
    request<{ installed: string[]; count: number }>("/skills/install", {
      method: "POST",
      body: JSON.stringify({ repo, skills }),
    }),
};

// ── Trace ──

export interface TraceEvent {
  type: string;
  timestamp: string;
  turn: number;
  [key: string]: unknown;
}

export const traceApi = {
  getEvents: () => request<{ events: TraceEvent[] }>("/trace"),

  clear: () =>
    request<{ cleared: boolean }>("/trace", { method: "DELETE" }),
};

// ── Telemetry ──

export interface TelemetryS1 {
  intent: string;
  topic: string;
  confidence: number;
  latency_ms: number;
  ok: boolean;
}

export interface TelemetryS2 {
  source: string;
  nodes_activated: number;
  facts_found: number;
  latency_ms: number;
  ok: boolean;
}

export interface TelemetryS3 {
  warm_tokens: number;
  hot_tokens: number;
  total_tokens: number;
  latency_ms: number;
  ok: boolean;
}

export interface TelemetryS15 {
  entities_created: number;
  facts_created: number;
  facts_filtered: { entity: string; fact: string; reason: string }[];
  latency_ms: number;
}

export interface TelemetryLLM {
  model: string;
  provider: string;
  latency_ms: number;
  ttft_ms: number;
  tokens_input: number;
  tokens_output: number;
  think_tokens: number;
  tokens_per_sec: number;
}

export interface TelemetryGraph {
  node_count: number;
  edge_count: number;
  node_delta: number;
  edge_delta: number;
}

export interface HardwareInfo {
  vram_used_mb: number;
  vram_total_mb: number;
  gpu_util_pct: number;
  model_loaded: boolean;
}

export interface TelemetrySpan {
  turn_id: number;
  session_id: string;
  project: string | null;
  timestamp: string;
  user_msg: string;
  s1: TelemetryS1;
  s2: TelemetryS2;
  s3: TelemetryS3;
  s15: TelemetryS15;
  llm: TelemetryLLM;
  graph: TelemetryGraph;
  failures: string[];
  hardware?: HardwareInfo;
}

export interface TelemetryResponse {
  spans: TelemetrySpan[];
  session: string;
  hardware: HardwareInfo | null;
}

export const telemetryApi = {
  get: (last?: number) =>
    request<TelemetryResponse>(`/acervo/telemetry${last ? `?last=${last}` : ""}`),
};

// ── Annotations ──

export interface AnnotationS1Expected {
  intent?: string;
  topic?: { action: string; label?: string };
  entities: { id: string; label: string; type: string; layer: string }[];
  relations: { source: string; relation: string; target: string }[];
  facts: { entity: string; fact: string; speaker: string }[];
}

export interface AnnotationS2Expected {
  nodes_should_activate: string[];
  notes: string;
}

export interface AnnotationS3Expected {
  context_adequate: boolean;
  notes: string;
}

export interface AnnotationLLMExpected {
  response_quality: number; // 1-5
  used_context_correctly: boolean;
  notes: string;
}

export interface AnnotationS15Expected {
  entities: { id: string; label: string; type: string; layer: string }[];
  relations: { source: string; relation: string; target: string }[];
  merges: { from_id: string; into_id: string }[];
  notes: string;
}

export interface Annotation {
  turn_id: number;
  status: "pending" | "editing" | "annotated";
  observations: string;
  s1_expected?: AnnotationS1Expected;
  s2_expected?: AnnotationS2Expected;
  s3_expected?: AnnotationS3Expected;
  llm_expected?: AnnotationLLMExpected;
  s15_expected?: AnnotationS15Expected;
}

export const annotationApi = {
  getAll: () =>
    request<{ annotations: Record<string, Annotation> }>("/annotations"),

  get: (turnId: number) =>
    request<Annotation>(`/annotations/${turnId}`),

  save: (turnId: number, annotation: Partial<Annotation>) =>
    request<{ saved: boolean }>(`/annotations/${turnId}`, {
      method: "PUT",
      body: JSON.stringify(annotation),
    }),

  delete: (turnId: number) =>
    request<{ deleted: boolean }>(`/annotations/${turnId}`, { method: "DELETE" }),

  exportJsonl: () =>
    request<{ format: string; count: number; examples: Record<string, unknown>[] }>(
      "/annotations/export/batch?format=jsonl",
    ),

  exportJson: () =>
    request<{ format: string; annotations: Record<string, Annotation>; spans: TelemetrySpan[] }>(
      "/annotations/export/batch?format=json",
    ),

  exportTurn: (turnId: number, format: "json" | "jsonl" = "json") =>
    request<{ format: string; span?: TelemetrySpan; annotation?: Annotation; examples?: Record<string, unknown>[]; count?: number }>(
      `/annotations/export/turn/${turnId}?format=${format}`,
    ),
};

export const systemPromptApi = {
  get: () => request<{ prompt: string; default: string }>("/system-prompt"),

  update: (prompt: string) =>
    request<{ saved: boolean }>("/system-prompt", {
      method: "PUT",
      body: JSON.stringify({ content: prompt }),
    }),
};

// ── Ollama Monitor ──

export interface OllamaModel {
  name: string;
  size_mb: number;
  vram_mb: number;
  parameter_size: string;
  quantization: string;
  family: string;
  expires_at?: string;
}

export interface OllamaAvailableModel {
  name: string;
  size_mb: number;
  parameter_size: string;
  quantization: string;
  family: string;
}

export interface OllamaStatus {
  ollama: {
    running: boolean;
    models_loaded: OllamaModel[];
    models_available: OllamaAvailableModel[];
  };
  gpu: {
    vram_used_mb: number;
    vram_total_mb: number;
    gpu_util_pct: number;
    gpu_name: string;
  };
  ram: {
    used_mb: number;
    total_mb: number;
  };
}

export const ollamaApi = {
  getStatus: () => request<OllamaStatus>("/ollama/status"),
};
