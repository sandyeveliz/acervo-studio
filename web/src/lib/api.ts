/** Typed API client for AVS-Agents REST endpoints. */

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

export const graphApi = {
  getNodes: (type?: string) =>
    request<{ nodes: GraphNode[] }>(`/graph/nodes${type ? `?type=${type}` : ""}`),

  getNode: (id: string) =>
    request<GraphNode>(`/graph/nodes/${id}`),

  getNeighbors: (id: string, maxCount = 10) =>
    request<{ neighbors: { node: GraphNode; weight: number }[] }>(
      `/graph/nodes/${id}/neighbors?max_count=${maxCount}`,
    ),

  getEdges: (nodeId?: string) =>
    request<{ edges: GraphEdge[] }>(`/graph/edges${nodeId ? `?node_id=${nodeId}` : ""}`),

  getStats: () =>
    request<GraphStats>("/graph/stats"),

  deleteNode: (id: string) =>
    request<{ removed: boolean }>(`/graph/nodes/${id}`, { method: "DELETE" }),

  deleteFact: (nodeId: string, fact: string) =>
    request<{ removed: boolean }>(`/graph/nodes/${nodeId}/facts`, {
      method: "DELETE",
      body: JSON.stringify({ fact }),
    }),

  updateNode: (id: string, fields: { label?: string; type?: string; attributes?: Record<string, unknown> }) =>
    request<GraphNode>(`/graph/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),

  exportGraph: () =>
    request<{ nodes: GraphNode[]; edges: GraphEdge[] }>("/graph/export"),

  importGraph: (data: { nodes: GraphNode[]; edges: GraphEdge[] }) =>
    request<{ imported: boolean; node_count: number; edge_count: number }>("/graph/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  mergeNodes: (keepId: string, absorbId: string, alias?: string) =>
    request<{ merged: boolean; kept: string; absorbed: string }>("/graph/merge", {
      method: "POST",
      body: JSON.stringify({ keep_id: keepId, absorb_id: absorbId, alias }),
    }),
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
}

export const settingsApi = {
  get: () => request<AppSettings>("/settings"),

  update: (updates: Record<string, unknown>) =>
    request<{ saved: boolean; settings: AppSettings }>("/settings", {
      method: "PUT",
      body: JSON.stringify(updates),
    }),
};

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
