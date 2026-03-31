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

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  facts: { fact: string; date?: string; session?: string; source?: string }[];
  attributes: Record<string, unknown>;
  status: string;
  layer?: string;
  owner?: string;
  confidence_for_owner?: number;
  created_at?: string;
  last_active?: string;
  session_count?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  weight: number;
  created_at?: string;
  layer?: string;
  source_type?: string;
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  type_distribution: Record<string, number>;
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

export const graphApi = {
  getNodes: (type?: string) =>
    request<{ nodes: GraphNode[] }>(`/graph/nodes${type ? `?type=${type}` : ""}`),

  getNode: (id: string) =>
    request<GraphNode>(`/graph/nodes/${id}`),

  getEdges: (nodeId?: string) =>
    request<{ edges: GraphEdge[] }>(`/graph/edges${nodeId ? `?node_id=${nodeId}` : ""}`),

  getStats: () =>
    request<GraphStats>("/graph/stats"),

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

  mergeNodes: (keepId: string, absorbId: string, alias?: string) =>
    request<{ merged: boolean }>("/graph/merge", {
      method: "POST",
      body: JSON.stringify({ keep_id: keepId, absorb_id: absorbId, alias }),
    }),

  importGraph: (data: { nodes: GraphNode[]; edges: GraphEdge[] }) =>
    request<{ imported: boolean }>("/graph/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getAnalysis: () =>
    request<GraphAnalysis>("/graph/analysis"),

  createNode: (data: { label: string; type: string; kind?: string; layer?: string; facts?: { fact: string; source?: string }[] }) =>
    request<GraphNode>("/graph/nodes", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateNode: (nodeId: string, data: { label?: string; type?: string; attributes?: Record<string, unknown> }) =>
    request<GraphNode>(`/graph/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  createEdge: (data: { source: string; target: string; relation: string; weight?: number }) =>
    request<{ created: boolean; source: string; target: string; relation: string }>("/graph/edges", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteEdge: (data: { source: string; target: string; relation: string }) =>
    request<{ deleted: boolean }>("/graph/edges", {
      method: "DELETE",
      body: JSON.stringify(data),
    }),
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

export const systemPromptApi = {
  get: () => request<{ prompt: string; default: string }>("/system-prompt"),

  update: (prompt: string) =>
    request<{ saved: boolean }>("/system-prompt", {
      method: "PUT",
      body: JSON.stringify({ content: prompt }),
    }),
};
